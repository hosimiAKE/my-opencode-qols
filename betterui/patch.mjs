#!/usr/bin/env node
/* ============================================================================
 * betterUI — OpenCode Desktop 注入器
 * ----------------------------------------------------------------------------
 * 桌面端没有界面插件接口，因此把插件代码写进已安装应用的 app.asar：
 *   1. out/renderer/index.html 末尾插入一行
 *      <script src=./oc-theme-preload.js></script>
 *      （等长改写，占用文件本身的空白填充，必要时才删除无用的图标标签腾空间）；
 *   2. out/renderer/oc-theme-preload.js（桌面端从不加载的构建残留文件）承载引导代码；
 *   3. 其余 8 个桌面端从不读取的图标 / 清单文件承载插件代码段，每个文件容量固定。
 *
 * 引导代码会依次 fetch 各代码段、拼接后执行；所有写入都是「等长原地覆盖」，
 * 不改变 asar 头部、目录表与任何文件偏移，卸载时可逐字节还原。
 * 官方更新覆盖 app.asar 后，重跑本脚本即可恢复。
 *
 * 用法：
 *   node patch.mjs --status           查看状态（JSON，退出码 0=已注入）
 *   node patch.mjs --plan             只打印分段方案（不写入）
 *   node patch.mjs --apply            注入 / 更新（自动备份原始字节）
 *   node patch.mjs --unpatch          还原为原始字节
 *   node patch.mjs --apply --quiet    静默模式（供守护进程调用）
 *   node patch.mjs --asar <path>      指定 app.asar 路径
 * ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(HERE, "state");
const BACKUP_DIR = path.join(HERE, "backup");
const LOG_FILE = path.join(HERE, "betterui.log");
const PAYLOAD_SRC = path.join(HERE, "betterui.js");

const MARK = "oc-betterui";
const HTML_REL = ["out", "renderer", "index.html"];
const BOOT_REL = ["out", "renderer", "oc-theme-preload.js"];
const LOADER = `<script src=./oc-theme-preload.js></script>`;

/* 桌面端从不读取的文件（按优先级），用于承载插件代码段 */
const SEGMENT_CANDIDATES = [
  ["out", "renderer", "favicon.ico"],
  ["out", "renderer", "apple-touch-icon.png"],
  ["out", "renderer", "apple-touch-icon-v3.png"],
  ["out", "renderer", "web-app-manifest-192x192.png"],
  ["out", "renderer", "web-app-manifest-512x512.png"],
  ["out", "renderer", "assets", "64x64-D8-3fHil.png"],
  ["out", "renderer", "favicon-96x96.png"],
  ["out", "renderer", "favicon.svg"],
  /* 以下文件仅被 index.html 的图标标签引用；只在空间不够时才会用到 */
  ["out", "renderer", "favicon-v3.ico"],
  ["out", "renderer", "favicon-v3.svg"],
  ["out", "renderer", "favicon-96x96-v3.png"],
];

/* 图标文件被用作代码段时（或 index.html 空间不够时）删除的对应标签 */
const REMOVABLE = [
  { file: "favicon-96x96-v3.png", re: /[ \t]*<link rel="icon" type="image\/png" href="\.\/favicon-96x96-v3\.png"[^\r\n]*\r?\n/ },
  { file: "favicon-v3.svg", re: /[ \t]*<link rel="icon" type="image\/svg\+xml" href="\.\/favicon-v3\.svg"[^\r\n]*\r?\n/ },
  { file: "favicon-v3.ico", re: /[ \t]*<link rel="shortcut icon" href="\.\/favicon-v3\.ico"[^\r\n]*\r?\n/ },
];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);
const QUIET = flag("--quiet");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (!QUIET) console.log(line);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n");
    if (fs.statSync(LOG_FILE).size > 512 * 1024) {
      const keep = fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-400).join("\n");
      fs.writeFileSync(LOG_FILE, keep + "\n");
    }
  } catch {}
}

/* ---------------------------------------------------------------- asar io */
function defaultAsar() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "@opencodedesktop", "resources", "app.asar"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "opencode", "resources", "app.asar"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "OpenCode", "resources", "app.asar"),
    path.join(process.env.PROGRAMFILES || "", "OpenCode", "resources", "app.asar"),
    "/Applications/OpenCode.app/Contents/Resources/app.asar",
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

function readHeader(asarPath, writable) {
  const fd = fs.openSync(asarPath, writable ? "r+" : "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const pickleSize = head.readUInt32LE(4);
  const strLen = head.readUInt32LE(12);
  if (strLen <= 0 || strLen > 64 * 1024 * 1024) throw new Error("无法识别的 asar 头部");
  const jsonBuf = Buffer.alloc(strLen);
  fs.readSync(fd, jsonBuf, 0, strLen, 16);
  let header;
  try {
    header = JSON.parse(jsonBuf.toString("utf8"));
  } catch (e) {
    throw new Error("解析 asar 头部失败: " + e.message);
  }
  if (!header || !header.files) throw new Error("asar 头部缺少 files");
  return { fd, header, dataBase: 8 + pickleSize, fileSize: fs.fstatSync(fd).size };
}

function entryOf(header, rel) {
  let node = header;
  for (const part of rel) {
    if (!node || !node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node && node.offset !== undefined ? node : null;
}

function readEntry(fd, dataBase, entry) {
  const buf = Buffer.alloc(Number(entry.size));
  fs.readSync(fd, buf, 0, buf.length, dataBase + Number(entry.offset));
  return buf;
}

function writeEntry(fd, dataBase, entry, buf) {
  if (buf.length !== Number(entry.size)) throw new Error("写入长度必须与文件表一致");
  fs.writeSync(fd, buf, 0, buf.length, dataBase + Number(entry.offset));
}

/* ------------------------------------------------------------ 代码分段 */
function loadCode() {
  return fs.readFileSync(PAYLOAD_SRC);
}

/* 相对 out/renderer 的路径（引导脚本 fetch 时使用） */
function relPath(rel) {
  return rel.slice(2).join("/");
}

/* 按「行边界」切分：每个分段尾部用空格补齐，空格只能出现在换行之后，
 * 避免把空白插进字符串 / 标识符中间。 */
function splitCode(buf, caps) {
  const parts = [];
  let off = 0;
  for (const cap of caps) {
    if (off >= buf.length) break;
    let end = Math.min(buf.length, off + cap);
    if (end < buf.length) {
      let cut = -1;
      for (let i = end - 1; i > off; i--) {
        if (buf[i] === 0x0a) { cut = i + 1; break; }
      }
      if (cut > off) end = cut;
    }
    parts.push(buf.subarray(off, end));
    off = end;
  }
  if (off < buf.length) parts.push(buf.subarray(off));
  return parts;
}

function fitParts(code, slotSizes) {
  if (slotSizes.some((c) => c <= 0)) return null;
  const parts = splitCode(code, slotSizes);
  const total = parts.reduce((a, b) => a + b.length, 0);
  return total === code.length && parts.length <= slotSizes.length ? parts : null;
}

function buildBoot(names) {
  return (
    `/*${MARK}:v1-boot*/(function(){var f=[` +
    names.map((n) => JSON.stringify("./" + n)).join(",") +
    `];Promise.all(f.map(function(p){return fetch(p,{cache:"no-store"}).then(function(r){return r.text()})}))` +
    `.then(function(a){Function(a.join(""))()})` +
    `.catch(function(e){console.error("[betterui] boot",e)})})();\n`
  );
}

function slotsOf(header) {
  const bootEntry = entryOf(header, BOOT_REL);
  if (!bootEntry) throw new Error("app.asar 中找不到 out/renderer/oc-theme-preload.js");
  const payload = [];
  for (const rel of SEGMENT_CANDIDATES) {
    const e = entryOf(header, rel);
    if (!e) continue;
    payload.push({ rel, size: Number(e.size) });
  }
  return { bootSlot: { rel: BOOT_REL, size: Number(bootEntry.size) }, payload };
}

/* 引导文件只放引导代码；插件代码全部放进后续文件。
 * （若把代码放进引导文件自身，引导脚本将无法在不重复执行自身的情况下取回它。） */
function pickLayout(header, code) {
  const { bootSlot, payload } = slotsOf(header);
  const used = [];
  for (const slot of payload) {
    used.push(slot);
    const boot = buildBoot(used.map((u) => relPath(u.rel))).length;
    if (boot > bootSlot.size) throw new Error("引导代码过长");
    if (fitParts(code, used.map((u) => u.size))) {
      return { bootSlot, used, bootBytes: boot };
    }
  }
  const capacity = used.reduce((a, u) => a + u.size, 0);
  throw new Error(
    `插件代码 ${code.length} 字节，超出可用空间 ${capacity} 字节；请精简 betterui.js`,
  );
}

function buildSegments(header, code) {
  const { bootSlot, used, bootBytes } = pickLayout(header, code);
  const boot = Buffer.from(buildBoot(used.map((u) => relPath(u.rel))), "utf8");
  if (boot.length !== bootBytes) throw new Error("引导代码长度计算不一致");
  const parts = fitParts(code, used.map((u) => u.size));
  if (!parts) throw new Error("插件代码无法装入可用空间；请精简 betterui.js");
  const out = [];
  out.push({
    rel: bootSlot.rel,
    entry: entryOf(header, bootSlot.rel),
    buf: Buffer.concat([boot, Buffer.alloc(bootSlot.size - boot.length, 0x20)]),
  });
  used.forEach((u, i) => {
    const data = parts[i] || Buffer.alloc(0);
    if (data.length > u.size) throw new Error("代码段超出容量: " + u.rel.join("/"));
    out.push({
      rel: u.rel,
      entry: entryOf(header, u.rel),
      buf: Buffer.concat([data, Buffer.alloc(u.size - data.length, 0x20)]),
    });
  });
  return out;
}

/* ------------------------------------------------------------ index.html */
/* 删除已插入的 loader（返回更短的缓冲，供重新插入时复用空间） */
function stripLoader(buf) {
  const s = buf.toString("utf8");
  const i = s.indexOf(LOADER);
  if (i < 0) return null;
  return Buffer.from(s.slice(0, i) + s.slice(i + LOADER.length), "utf8");
}

/* 删除 loader 并在文件末尾补空格保持等长（无备份时还原用） */
function maskLoader(buf) {
  const stripped = stripLoader(buf);
  if (!stripped) return null;
  const size = stripped.length;
  if (size > buf.length) return null;
  return Buffer.concat([stripped, Buffer.alloc(buf.length - size, 0x20)]);
}

function insertLoader(buf, targetSize, usedFiles) {
  let s = buf.toString("utf8");
  if (s.includes(LOADER)) return buf;
  /* 末尾空白统一由本函数重新补齐，避免历史填充占着位置 */
  s = s.replace(/[ \t\r\n]+$/, "");
  const put = (src) => {
    if (src.includes("</body>")) return src.replace("</body>", LOADER + "\r\n</body>");
    if (src.includes("</html>")) return src.replace("</html>", LOADER + "\r\n</html>");
    return src + "\r\n" + LOADER;
  };
  let next = put(s);
  let size = Buffer.byteLength(next, "utf8");
  for (const item of REMOVABLE) {
    const mustGo = usedFiles.has(item.file);
    if (!mustGo && size <= targetSize) break;
    const stripped = next.replace(item.re, "");
    if (stripped !== next) {
      next = stripped;
      size = Buffer.byteLength(next, "utf8");
    }
  }
  if (size > targetSize) {
    throw new Error(`index.html 可压缩空间不足（还差 ${size - targetSize} 字节）`);
  }
  return Buffer.from(next + " ".repeat(targetSize - size), "utf8");
}

/* ---------------------------------------------------------------- 备份 */
function backupFile(rel) {
  return path.join(BACKUP_DIR, rel.join("__") + ".bin");
}
function sha(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function saveBackup(asarPath, appVersion, items) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const meta = { asar: asarPath, savedAt: new Date().toISOString(), appVersion, files: [] };
  for (const it of items) {
    fs.writeFileSync(backupFile(it.rel), it.buf);
    meta.files.push({ rel: it.rel, size: it.buf.length, sha: sha(it.buf) });
  }
  fs.writeFileSync(path.join(BACKUP_DIR, "meta.json"), JSON.stringify(meta, null, 2));
}
function loadBackup() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "meta.json"), "utf8"));
    if (!meta || !Array.isArray(meta.files)) return null;
    for (const f of meta.files) {
      if (!fs.existsSync(backupFile(f.rel))) return null;
    }
    return meta;
  } catch {
    return null;
  }
}
function readAppVersion(fd, dataBase, header) {
  try {
    const e = entryOf(header, ["package.json"]);
    if (!e) return "";
    const buf = readEntry(fd, dataBase, e);
    const m = buf.toString("utf8").match(/"version"\s*:\s*"([^"]+)"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

/* ---------------------------------------------------------------- 动作 */
function plan(header, code) {
  const htmlEntry = entryOf(header, HTML_REL);
  if (!htmlEntry) throw new Error("app.asar 中找不到 out/renderer/index.html");
  const segments = buildSegments(header, code);
  return { htmlEntry, segments };
}

function status(asarPath) {
  const { fd, header, dataBase } = readHeader(asarPath);
  try {
    const code = loadCode();
    let planInfo;
    try {
      planInfo = plan(header, code);
    } catch (e) {
      return { ok: false, asar: asarPath, applied: false, uptodate: false, error: e.message };
    }
    const html = readEntry(fd, dataBase, planInfo.htmlEntry);
    const htmlApplied = html.toString("utf8").includes(LOADER);
    const boot = readEntry(fd, dataBase, entryOf(header, BOOT_REL));
    const bootOk = boot.toString("utf8").includes(`${MARK}:v1-boot`);
    let segmentsOk = true;
    for (const seg of planInfo.segments) {
      const cur = readEntry(fd, dataBase, seg.entry);
      if (!cur.equals(seg.buf)) { segmentsOk = false; break; }
    }
    const applied = htmlApplied && bootOk && segmentsOk;
    return {
      ok: true,
      asar: asarPath,
      applied,
      uptodate: applied,
      htmlPatched: htmlApplied,
      bootOk,
      segmentsOk,
      codeBytes: code.length,
      files: planInfo.segments.map((s) => s.rel.join("/")),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function apply(asarPath) {
  const { fd, header, dataBase } = readHeader(asarPath, true);
  try {
    const code = loadCode();
    const planInfo = plan(header, code);
    const appVersion = readAppVersion(fd, dataBase, header);
    const html = readEntry(fd, dataBase, planInfo.htmlEntry);

    /* 已是最新？ */
    const htmlApplied = html.toString("utf8").includes(LOADER);
    let current = htmlApplied;
    for (const seg of planInfo.segments) {
      if (!current) break;
      const cur = readEntry(fd, dataBase, seg.entry);
      if (!cur.equals(seg.buf)) current = false;
    }
    if (current) return { changed: false };

    /* 备份原始字节（仅在尚未备份时） */
    const meta = loadBackup();
    const expected = [HTML_REL.join("/"), ...planInfo.segments.map((s) => s.rel.join("/"))];
    const backupCovers = meta &&
      meta.appVersion === appVersion &&
      expected.every((r) => meta.files.some((f) => f.rel.join("/") === r));
    if (!backupCovers) {
      const items = planInfo.segments.map((s) => ({ rel: s.rel, buf: readEntry(fd, dataBase, s.entry) }));
      items.push({ rel: HTML_REL, buf: html });
      saveBackup(asarPath, appVersion, items);
    }

    /* 写代码段 */
    for (const seg of planInfo.segments) {
      const cur = readEntry(fd, dataBase, seg.entry);
      if (!cur.equals(seg.buf)) writeEntry(fd, dataBase, seg.entry, seg.buf);
    }
    /* 写 index.html */
    const masked = htmlApplied ? stripLoader(html) || html : html;
    const usedFiles = new Set(planInfo.segments.map((s) => s.rel[s.rel.length - 1]));
    const next = insertLoader(masked, html.length, usedFiles);
    if (!next.equals(html)) writeEntry(fd, dataBase, planInfo.htmlEntry, next);

    fs.fsyncSync(fd);
    log(
      `已注入 betterUI（代码 ${code.length} 字节；引导文件 ${BOOT_REL.join("/")}）` +
        (htmlApplied ? "，插件代码已更新" : "，重启 OpenCode 桌面端后生效"),
    );
    return { changed: true };
  } finally {
    fs.closeSync(fd);
  }
}

function unpatch(asarPath) {
  const { fd, header, dataBase } = readHeader(asarPath, true);
  try {
    let changed = false;
    const appVersion = readAppVersion(fd, dataBase, header);
    const meta = loadBackup();
    const htmlKey = HTML_REL.join("/");
    const restored = new Set();
    const versionOk = meta && (!meta.appVersion || meta.appVersion === appVersion);
    if (versionOk) {
      for (const f of meta.files) {
        const e = entryOf(header, f.rel);
        if (!e || Number(e.size) !== Number(f.size)) continue;
        const cur = readEntry(fd, dataBase, e);
        /* index.html 只有插入过 loader 才还原；其余文件按备份尺寸直接还原
         * （备份里就是该文件的原始字节，尺寸一致时还原是安全的）。 */
        if (f.rel.join("/") === htmlKey && !cur.toString("utf8").includes(LOADER)) continue;
        writeEntry(fd, dataBase, e, fs.readFileSync(backupFile(f.rel)));
        restored.add(f.rel.join("/"));
        changed = true;
      }
    }
    /* 没有可用备份（或版本已变）时，至少把 loader 抹掉 */
    if (!restored.has(htmlKey)) {
      const htmlEntry = entryOf(header, HTML_REL);
      if (htmlEntry) {
        const html = readEntry(fd, dataBase, htmlEntry);
        if (html.toString("utf8").includes(LOADER)) {
          const masked = maskLoader(html);
          if (masked) { writeEntry(fd, dataBase, htmlEntry, masked); changed = true; }
        }
      }
    }
    if (changed) fs.fsyncSync(fd);
    log(changed ? "已还原为原始文件（重启后恢复为无插件状态）" : "没有检测到需要还原的内容");
    return { changed };
  } finally {
    fs.closeSync(fd);
  }
}

/* ------------------------------------------------------------------- main */
const asarPath = opt("--asar", process.env.BETTERUI_ASAR || defaultAsar());
if (!asarPath || !fs.existsSync(asarPath)) {
  console.error("找不到 app.asar，请用 --asar 指定路径");
  process.exit(2);
}

try {
  if (flag("--plan")) {
    const { fd, header, dataBase } = readHeader(asarPath);
    try {
      const code = loadCode();
      const p = plan(header, code);
      console.log(JSON.stringify({
        asar: asarPath,
        appVersion: readAppVersion(fd, dataBase, header),
        codeBytes: code.length,
        segments: p.segments.map((s) => ({
          file: s.rel.join("/"),
          size: Number(s.entry.size),
          head: s.buf.slice(0, 32).toString("utf8").replace(/[^\x20-\x7e]/g, "."),
          tail: s.buf.slice(-24).toString("utf8").replace(/[^\x20-\x7e]/g, "."),
        })),
      }, null, 2));
    } finally {
      fs.closeSync(fd);
    }
  } else if (flag("--status")) {
    const st = status(asarPath);
    if (!QUIET) console.log(JSON.stringify(st, null, 2));
    process.exit(st.applied ? 0 : 1);
  } else if (flag("--unpatch")) {
    unpatch(asarPath);
  } else {
    const r = apply(asarPath);
    log(r.changed ? "注入完成" : "已是最新，无需处理");
  }
} catch (err) {
  log("错误：" + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
