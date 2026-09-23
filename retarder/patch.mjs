#!/usr/bin/env node
/* ============================================================================
 * retarder — OpenCode Desktop 自愈补丁工具
 * ----------------------------------------------------------------------------
 * 向已安装的 OpenCode Desktop 的 app.asar 中注入 retarder.js：
 *   1. 在 out/renderer/index.html 中插入一行极小的 loader（等长改写，
 *      不改变 asar 头部、目录表与任何文件偏移）；
 *   2. 将 retarder.js 的代码写入 out/renderer/social-share-zen.png
 *      （该文件只是网页分享预览图，桌面端不会读取；等长覆盖）。
 *
 * 所有写入都是「等长原地覆盖」，对 asar 结构零改动。
 * 官方更新后重新执行本脚本即可恢复插件（watch.mjs 会自动完成）。
 *
 * 用法：
 *   node patch.mjs --status           查看状态（JSON，退出码 0=已注入）
 *   node patch.mjs --apply            注入（自动备份原始字节）
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
const LOG_FILE = path.join(HERE, "retarder.log");
const PAYLOAD_SRC = path.join(HERE, "retarder.js");

const MARK = "opencode-retarder";
const HTML_REL = ["out", "renderer", "index.html"];
const PAYLOAD_CANDIDATES = [
  ["out", "renderer", "social-share-zen.png"],
  ["out", "renderer", "social-share.png"],
  ["out", "renderer", "web-app-manifest-512x512.png"],
  ["out", "renderer", "web-app-manifest-192x192.png"],
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
function buildLoader(payloadBase) {
  return (
    `    <script>/*${MARK}*/fetch("./${payloadBase}",{cache:"no-store"})` +
    `.then(function(r){return r.text()}).then(function(t){Function(t)()})` +
    `.catch(function(e){console.error("[retarder]",e)})</script>\r\n`
  );
}

const REMOVABLE = [
  /[ \t]*<link rel="apple-touch-icon"[^\r\n]*\r?\n/,
  /[ \t]*<meta property="og:image"[^\r\n]*\r?\n/,
  /[ \t]*<meta property="twitter:image"[^\r\n]*\r?\n/,
  /[ \t]*<meta name="theme-color"[^\r\n]*\r?\n/,
  /[ \t]*<noscript>[^\r\n]*<\/noscript>\r?\n/,
];

function insertLoader(original, payloadBase) {
  let s = original.toString("utf8");
  if (s.includes(MARK)) return original;
  const loader = buildLoader(payloadBase);
  for (const re of REMOVABLE) {
    if (Buffer.byteLength(s, "utf8") + loader.length <= original.length) break;
    const next = s.replace(re, "");
    if (next !== s) s = next;
  }
  if (s.includes("</body>")) s = s.replace("</body>", loader + "  </body>");
  else if (s.includes("</html>")) s = s.replace("</html>", loader + "</html>");
  else s += "\r\n" + loader;
  const size = Buffer.byteLength(s, "utf8");
  if (size > original.length) {
    throw new Error(
      `index.html 可压缩空间不足（还差 ${size - original.length} 字节），请更新 retarder 插件版本`,
    );
  }
  return Buffer.from(s + " ".repeat(original.length - size), "utf8");
}

function maskLoader(buf) {
  const s = buf.toString("utf8");
  const start = s.indexOf(`<script>/*${MARK}*/`);
  if (start < 0) return null;
  const end = s.indexOf("</script>", start);
  if (end < 0) return null;
  return Buffer.from(s.slice(0, start) + " ".repeat(end + 9 - start) + s.slice(end + 9), "utf8");
}

function padCode(code, size) {
  if (code.length > size) throw new Error(`插件代码 ${code.length} 字节，超过占位文件容量 ${size} 字节`);
  return Buffer.concat([code, Buffer.alloc(size - code.length, 0x20)]);
}

/* ---------------------------------------------------------------- actions */
function loadPayload() {
  return fs.readFileSync(PAYLOAD_SRC);
}

function pickPayloadEntry(header, code) {
  for (const rel of PAYLOAD_CANDIDATES) {
    const e = entryOf(header, rel);
    if (e && Number(e.size) >= code.length) return { rel, entry: e };
  }
  return null;
}

function status(asarPath) {
  const { fd, header, dataBase } = readHeader(asarPath);
  try {
    const code = loadPayload();
    const htmlEntry = entryOf(header, HTML_REL);
    const html = htmlEntry ? readEntry(fd, dataBase, htmlEntry) : null;
    const htmlApplied = !!html && html.toString("utf8").includes(MARK);
    const picked = pickPayloadEntry(header, code);
    let payloadOk = false;
    if (picked) {
      const buf = readEntry(fd, dataBase, picked.entry);
      payloadOk = buf.equals(padCode(code, buf.length));
    }
    const applied = htmlApplied && payloadOk;
    return {
      ok: true,
      asar: asarPath,
      applied,
      uptodate: applied,
      htmlPatched: htmlApplied,
      payloadFile: picked ? picked.rel.join("/") : null,
      payloadOk,
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

function saveBackup(asarPath, html, payloadEntry, payloadBuf, payloadRel, appVersion) {
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
    const htmlEntry = entryOf(header, HTML_REL);
    if (!htmlEntry) throw new Error("app.asar 中找不到 out/renderer/index.html");
    let html = readEntry(fd, dataBase, htmlEntry);
    const picked = pickPayloadEntry(header, code);
    if (!picked) throw new Error("找不到足够大的占位文件来存放插件代码");

    const alreadyPatched = html.toString("utf8").includes(MARK);
    const payloadCurrent = readEntry(fd, dataBase, picked.entry);
    const payloadOk = payloadCurrent.equals(padCode(code, payloadCurrent.length));
    const loaderRefsPicked = html.toString("utf8").includes(`fetch("./${path.basename(picked.rel.join("/"))}"`);

    if (alreadyPatched && payloadOk && loaderRefsPicked) return { changed: false };

    if (!alreadyPatched) {
      // 首次注入（或官方更新后重新注入）：备份当前原始字节
      const appVersion = readAppVersion(fd, dataBase, header);
      const metaPath = path.join(BACKUP_DIR, "meta.json");
      const info = {
        appVersion,
        payloadRel: picked.rel.join("/"),
        payloadSize: Number(picked.entry.size),
        htmlSize: html.length,
      };
      if (!backupMatches(metaPath, info)) {
        saveBackup(asarPath, html, picked.entry, payloadCurrent, info.payloadRel, appVersion);
      }
      html = insertLoader(html, path.basename(picked.rel.join("/")));
      writeEntry(fd, dataBase, htmlEntry, html);
    } else if (!loaderRefsPicked) {
      // 占位文件改名了：清除旧 loader 后重新生成
      const masked = maskLoader(html);
      if (masked) {
        html = insertLoader(masked, path.basename(picked.rel.join("/")));
        writeEntry(fd, dataBase, htmlEntry, html);
      }
    }

    if (!payloadOk) {
      writeEntry(fd, dataBase, picked.entry, padCode(code, Number(picked.entry.size)));
    }
    fs.fsyncSync(fd);
    log(
      `已注入 retarder（代码 ${code.length} 字节；占位文件 ${picked.rel.join("/")}）` +
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
      if (html.toString("utf8").includes(MARK)) {
        const backupHtml = path.join(BACKUP_DIR, "index.html.bin");
        let restored = false;
        if (fs.existsSync(backupHtml)) {
          const orig = fs.readFileSync(backupHtml);
          if (orig.length === html.length) {
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
    if (fs.existsSync(metaPath) && fs.existsSync(backupPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const rel = meta.payloadRel ? meta.payloadRel.split("/") : [];
      const e = rel.length ? entryOf(header, rel) : null;
      if (e) {
        const cur = readEntry(fd, dataBase, e);
        if (cur.includes(Buffer.from(MARK)) && Number(e.size) === Number(meta.payloadSize)) {
          writeEntry(fd, dataBase, e, fs.readFileSync(backupPath));
          changed = true;
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
const asarPath = opt("--asar", process.env.RETARDER_ASAR || defaultAsar());
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
