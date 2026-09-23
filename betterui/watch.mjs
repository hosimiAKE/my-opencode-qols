#!/usr/bin/env node
/* ============================================================================
 * betterUI — 守护进程
 * ----------------------------------------------------------------------------
 * 每隔 20 秒检查一次 OpenCode 桌面端的 app.asar：
 *   - 如果插件仍在，什么都不做；
 *   - 如果检测到官方更新导致插件丢失，则自动重新注入。
 * 由计划任务在登录时启动，无需手动运行。
 * ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK = path.join(HERE, "state", "watch.lock");
const PATCH = path.join(HERE, "patch.mjs");
const LOG = path.join(HERE, "betterui.log");
const INTERVAL_MS = Number(process.env.BETTERUI_INTERVAL_MS || 20000);

function log(msg) {
  const line = `[${new Date().toISOString()}] [watch] ${msg}`;
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line + "\n");
  } catch {}
  if (!process.env.BETTERUI_QUIET) console.log(line);
}

/* 单实例 */
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
try {
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        process.exit(0); // 已有守护进程在运行
      } catch {}
    }
  }
} catch {}
fs.writeFileSync(LOCK, String(process.pid));
process.on("exit", () => {
  try {
    if (fs.readFileSync(LOCK, "utf8").trim() === String(process.pid)) fs.unlinkSync(LOCK);
  } catch {}
});

function runPatch(args) {
  return spawnSync(process.execPath, [PATCH, ...args, "--quiet"], { encoding: "utf8", windowsHide: true });
}

let failures = 0;
let lastFailureLog = 0;

function tick() {
  const st = runPatch(["--status"]);
  if (st.status === 0) {
    failures = 0;
  } else {
    const ap = runPatch(["--apply"]);
    if (ap.status === 0) {
      log("检测到插件缺失（可能刚完成更新），已自动重新注入");
      failures = 0;
    } else {
      failures++;
      const now = Date.now();
      if (failures === 1 || now - lastFailureLog > 3600000) {
        lastFailureLog = now;
        log(`注入失败（第 ${failures} 次）：${(ap.stderr || ap.stdout || "").trim() || "未知错误"}`);
      }
    }
  }
  const wait = failures > 5 ? 300000 : INTERVAL_MS;
  setTimeout(tick, wait);
}

log("守护进程已启动，持续监控 app.asar");
tick();
