#!/usr/bin/env node
/* ============================================================================
 * homelander — OpenCode Desktop 自愈补丁工具
 * ----------------------------------------------------------------------------
 * 把 homelander.js 注入已安装的 OpenCode Desktop 的 app.asar：
 *   1. 在 out/renderer/index.html 中插入一行极小的 loader（等长改写，
 *      不改变 asar 头部、目录表与任何文件偏移）；
 *   2. 把插件代码写入 out/renderer/social-share.png（社交分享预览图，桌面端
 *      不会读取；等长覆盖）。
 *
 * 所有写入都是「等长原地覆盖」，对 asar 结构零改动。与 retarder 互不干扰：
 * 自动跳过已被占用的占位图片。
 * 官方更新后重新执行本脚本即可恢复插件（watch.mjs 会自动完成）。
 *
 * 用法：
 *   node patch.mjs --status           查看状态（JSON，退出码 0=已注入）
 *   node patch.mjs --apply            注入（自动备份原始字节）
 *   node patch.mjs --unpatch          移除 loader 并还原占位图片
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
const LOG_FILE = path.join(HERE, "homelander.log");
const PAYLOAD_SRC = path.join(HERE, "homelander.js");

const MARK = "oc-homelander";
const RETARDER_MARK = "opencode-retarder";
const HTML_REL = ["out", "renderer", "index.html"];
const PAYLOAD_CANDIDATES = [
  ["out", "renderer", "social-share.png"],
  ["out", "renderer", "web-app-manifest-512x512.png"],
  ["out", "renderer", "web-app-manifest-192x192.png"],
  ["out", "renderer", "social-share-zen.png"],
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

/* ------------------------------------------------------------- transform */
function buildLoader(payloadBase, hash) {
  return (
    `    <script src="./${payloadBase}?h=${hash}" data-hl=${MARK} ` +
    `onerror="fetch(this.src,{cache:'no-store'}).then(r=>r.text()).then(t=>Function(t)())"></script>\r\n`
  );
}

const REMOVABLE = [
  /[ \t]*<link rel="modulepreload"[^\r\n]*\r?\n/,
  /[ \t]*<meta name="theme-color"[^\r\n]*\r?\n/,
  /[ \t]*<noscript>[^\r\n]*<\/noscript>\r?\n/,
  /[ \t]*<link rel="apple-touch-icon"[^\r\n]*\r?\n/,
  /[ \t]*<meta property="og:image"[^\r\n]*\r?\n/,
  /[ \t]*<meta property="twitter:image"[^\r\n]*\r?\n/,
  /[ \t]*<link rel="shortcut icon"[^\r\n]*\r?\n/,
  /[ \t]*<link rel="icon"[^\r\n]*\r?\n/,
];

function insertLoader(original, payloadBase, hash) {
  let s = original.toString("utf8");
  if (s.includes(MARK)) return original;
  const loader = buildLoader(payloadBase, hash);
  // 回收上一次补丁留下的尾部填充空格
  s = s.replace(/[ ]+$/, "");
  for (const re of REMOVABLE) {
    if (Buffer.byteLength(s, "utf8") + Buffer.byteLength(loader, "utf8") <= original.length) break;
    const next = s.replace(re, "");
    if (next !== s) s = next;
  }
  if (s.includes("</body>")) s = s.replace("</body>", loader + "  </body>");
  else if (s.includes("</html>")) s = s.replace("</html>", loader + "</html>");
  else s += "\r\n" + loader;
  const size = Buffer.byteLength(s, "utf8");
  if (size > original.length) {
    throw new Error(`index.html 可用空间不足（还差 ${size - original.length} 字节），请更新 homelander 插件版本`);
  }
  return Buffer.from(s + " ".repeat(original.length - size), "utf8");
}

function loaderSpan(buf) {
  const s = buf.toString("utf8");
  const at = s.indexOf(`data-hl=${MARK}`);
  if (at < 0) return null;
  const start = s.lastIndexOf("<script", at);
  if (start < 0) return null;
  const end = s.indexOf("</script>", at);
  if (end < 0) return null;
  return { s, start, stop: end + "</script>".length };
}

function replaceLoader(buf, loader) {
  const span = loaderSpan(buf);
  if (!span) return null;
  const body = loader.trim();
  const room = span.stop - span.start;
  if (Buffer.byteLength(body, "utf8") > room) return null;
  const s = span.s.slice(0, span.start) + body + " ".repeat(room - Buffer.byteLength(body, "utf8")) + span.s.slice(span.stop);
  return Buffer.from(s, "utf8");
}

function maskLoader(buf) {
  const span = loaderSpan(buf);
  if (!span) return null;
  return Buffer.from(
    span.s.slice(0, span.start) + " ".repeat(span.stop - span.start) + span.s.slice(span.stop),
    "utf8",
  );
}

function padCode(code, size) {
  if (code.length > size) throw new Error(`插件代码 ${code.length} 字节，超过占位文件容量 ${size} 字节`);
  return Buffer.concat([code, Buffer.alloc(size - code.length, 0x20)]);
}

function isPng(buf) {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/* ---------------------------------------------------------------- actions */
function loadPayload() {
  return fs.readFileSync(PAYLOAD_SRC);
}
function payloadHash(code) {
  return crypto.createHash("sha1").update(code).digest("hex").slice(0, 8);
}

function pickPayloadEntry(fd, dataBase, header, code) {
  for (const rel of PAYLOAD_CANDIDATES) {
    const e = entryOf(header, rel);
    if (!e || Number(e.size) < code.length) continue;
    const cur = readEntry(fd, dataBase, e);
    if (cur.equals(padCode(code, cur.length))) return { rel, entry: e, current: true, ours: true };
    if (cur.includes(Buffer.from(MARK))) return { rel, entry: e, current: false, ours: true };
    if (isPng(cur)) return { rel, entry: e, current: false, ours: false };
  }
  return null;
}

function status(asarPath) {
  const { fd, header, dataBase } = readHeader(asarPath);
  try {
    const code = loadPayload();
    const hash = payloadHash(code);
    const htmlEntry = entryOf(header, HTML_REL);
    const html = htmlEntry ? readEntry(fd, dataBase, htmlEntry) : null;
    const htmlApplied = !!html && html.toString("utf8").includes(MARK);
    const picked = pickPayloadEntry(fd, dataBase, header, code);
    let payloadOk = false;
    let loaderOk = false;
    if (picked && html) {
      payloadOk = picked.current;
      const base = path.basename(picked.rel.join("/"));
      loaderOk = html.toString("utf8").includes(buildLoader(base, hash).trim());
    }
    const applied = htmlApplied && payloadOk && loaderOk;
    return {
      ok: true,
      asar: asarPath,
      applied,
      uptodate: applied,
      htmlPatched: htmlApplied,
      payloadFile: picked ? picked.rel.join("/") : null,
      payloadOk,
      loaderOk,
      codeBytes: code.length,
    };
  } finally {
    fs.closeSync(fd);
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

function backupMatches(metaPath, info) {
  try {
    if (!fs.existsSync(metaPath)) return false;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return (
      meta.appVersion === info.appVersion &&
      meta.payloadRel === info.payloadRel &&
      Number(meta.payloadSize) === info.payloadSize &&
      Number(meta.htmlSize) === info.htmlSize
    );
  } catch {
    return false;
  }
}

function saveBackup(asarPath, html, payloadBuf, payloadRel, appVersion) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, "index.html.bin"), html);
  fs.writeFileSync(path.join(BACKUP_DIR, "payload.bin"), payloadBuf);
  fs.writeFileSync(
    path.join(BACKUP_DIR, "meta.json"),
    JSON.stringify(
      {
        asar: asarPath,
        savedAt: new Date().toISOString(),
        appVersion,
        payloadRel,
        payloadSize: payloadBuf.length,
        htmlSize: html.length,
        htmlSha: crypto.createHash("sha256").update(html).digest("hex"),
      },
      null,
      2,
    ),
  );
}

function apply(asarPath) {
  const { fd, header, dataBase } = readHeader(asarPath, true);
  try {
    const code = loadPayload();
    const hash = payloadHash(code);
    const htmlEntry = entryOf(header, HTML_REL);
    if (!htmlEntry) throw new Error("app.asar 中找不到 out/renderer/index.html");
    let html = readEntry(fd, dataBase, htmlEntry);
    const picked = pickPayloadEntry(fd, dataBase, header, code);
    if (!picked) throw new Error("找不到可用的占位文件来存放插件代码（也许都被其他插件占用）");

    const base = path.basename(picked.rel.join("/"));
    const loader = buildLoader(base, hash);
    const alreadyPatched = html.toString("utf8").includes(MARK);
    const loaderCurrent = html.toString("utf8").includes(loader.trim());

    if (alreadyPatched && picked.current && loaderCurrent) return { changed: false };

    if (!alreadyPatched) {
      // 首次注入（或官方更新后重新注入）：备份当前原始字节
      const appVersion = readAppVersion(fd, dataBase, header);
      const metaPath = path.join(BACKUP_DIR, "meta.json");
      const info = { appVersion, payloadRel: picked.rel.join("/"), payloadSize: Number(picked.entry.size), htmlSize: html.length };
      if (picked.ours && !fs.existsSync(path.join(BACKUP_DIR, "payload.bin"))) {
        log("警告：占位文件已是 homelander 代码且缺少原始备份，本次不覆盖备份（建议重装 OpenCode 以彻底还原）");
      } else if (!backupMatches(metaPath, info)) {
        saveBackup(asarPath, html, readEntry(fd, dataBase, picked.entry), info.payloadRel, appVersion);
      }
    }
    if (!loaderCurrent) {
      // 首次注入或 loader 过期：优先原地等长替换，空间不足时压缩后重新插入
      html = replaceLoader(html, loader) || insertLoader(maskLoader(html) || html, base, hash);
      writeEntry(fd, dataBase, htmlEntry, html);
    }
    if (!picked.current) {
      writeEntry(fd, dataBase, picked.entry, padCode(code, Number(picked.entry.size)));
    }
    fs.fsyncSync(fd);
    log(
      `已注入 homelander（代码 ${code.length} 字节；占位文件 ${picked.rel.join("/")}）` +
        (alreadyPatched ? "，插件代码已更新" : "，重启 OpenCode 桌面端后生效"),
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
    const htmlEntry = entryOf(header, HTML_REL);
    if (htmlEntry) {
      const html = readEntry(fd, dataBase, htmlEntry);
      const text = html.toString("utf8");
      if (text.includes(MARK)) {
        const backupHtml = path.join(BACKUP_DIR, "index.html.bin");
        let restored = false;
        if (fs.existsSync(backupHtml)) {
          const orig = fs.readFileSync(backupHtml);
          const safe =
            orig.length === html.length &&
            !(text.includes(RETARDER_MARK) && !orig.toString("utf8").includes(RETARDER_MARK));
          if (safe) {
            writeEntry(fd, dataBase, htmlEntry, orig);
            restored = true;
          }
        }
        if (!restored) {
          const masked = maskLoader(html);
          if (masked) writeEntry(fd, dataBase, htmlEntry, masked);
        }
        changed = true;
      }
    }
    const metaPath = path.join(BACKUP_DIR, "meta.json");
    const backupPath = path.join(BACKUP_DIR, "payload.bin");
    let payloadRestored = false;
    let oursLeft = false;
    if (fs.existsSync(metaPath) && fs.existsSync(backupPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const rel = meta.payloadRel ? meta.payloadRel.split("/") : [];
      const e = rel.length ? entryOf(header, rel) : null;
      if (e) {
        const cur = readEntry(fd, dataBase, e);
        if (cur.includes(Buffer.from(MARK)) && Number(e.size) === Number(meta.payloadSize)) {
          writeEntry(fd, dataBase, e, fs.readFileSync(backupPath));
          payloadRestored = true;
          changed = true;
        } else {
          oursLeft = cur.includes(Buffer.from(MARK));
        }
      }
    } else {
      for (const rel of PAYLOAD_CANDIDATES) {
        const e = entryOf(header, rel);
        if (!e) continue;
        if (readEntry(fd, dataBase, e).includes(Buffer.from(MARK))) { oursLeft = true; break; }
      }
    }
    if (oursLeft && !payloadRestored) {
      log("警告：找不到原始备份（backup/payload.bin），占位图片未能还原；重装 OpenCode 可恢复官方文件");
    }
    if (changed) fs.fsyncSync(fd);
    log(changed ? "已移除 loader 并还原占位图片（重启后恢复为无插件状态）" : "没有检测到需要还原的内容");
    return { changed };
  } finally {
    fs.closeSync(fd);
  }
}

/* ------------------------------------------------------------------- main */
const asarPath = opt("--asar", process.env.HOMELANDER_ASAR || defaultAsar());
if (!asarPath || !fs.existsSync(asarPath)) {
  console.error("找不到 app.asar，请用 --asar 指定路径");
  process.exit(2);
}

try {
  if (flag("--status")) {
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
