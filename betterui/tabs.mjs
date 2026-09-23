#!/usr/bin/env node
/* ============================================================================
 * betterUI — 安装时把「Tabs 模式」自动改为竖排（vertical）
 * ----------------------------------------------------------------------------
 * OpenCode 桌面端把界面设置保存在用户数据目录的 SQLite 数据库里：
 *   %APPDATA%\ai.opencode.desktop\drafts.sqlite
 * 其中 state 表以 key = 'settings.v3' 保存整份设置 JSON（name 一般是
 * default.dat）。本脚本把 appearance.tabLayout 合并为 "vertical"，其余
 * 设置原样保留。
 *
 * 说明：
 *   - 桌面端正在运行时也可以写入（SQLite WAL），重启后生效；
 *   - 若桌面端之后又用内存中的设置覆盖了它，betterui.js 会在下次启动时
 *     通过应用自身的 IPC 再设置一次（仅一次，不干预用户后续的手动修改）；
 *   - Node.js 低于 22.5（没有 node:sqlite）时自动跳过，不影响安装。
 *
 * 用法：
 *   node tabs.mjs [--quiet]
 *   node tabs.mjs --db <drafts.sqlite 路径>   指定数据库（调试用）
 * ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const QUIET = process.argv.includes("--quiet");
const DB_OPT = process.argv.indexOf("--db");
const log = (msg) => { if (!QUIET) console.log("[betterUI] " + msg); };

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}

/* 桌面端可能的用户数据目录（正式 / beta / dev） */
function databases() {
  if (DB_OPT >= 0 && process.argv[DB_OPT + 1]) {
    return [{ app: "指定路径", db: path.resolve(process.argv[DB_OPT + 1]) }];
  }
  const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const out = [];
  for (const name of ["ai.opencode.desktop", "ai.opencode.desktop.beta", "ai.opencode.desktop.dev"]) {
    const db = path.join(base, name, "drafts.sqlite");
    if (fs.existsSync(db)) out.push({ app: name, db });
  }
  return out;
}

const found = databases();
if (!found.length) {
  log("没有找到桌面端设置数据库（应用可能还没运行过），跳过；插件启动时会自动设置。");
  process.exit(0);
}
if (!DatabaseSync) {
  log("当前 Node.js 不支持 node:sqlite（需要 22.5+），跳过；插件启动时会自动设置。");
  process.exit(0);
}

for (const { app, db } of found) {
  let conn = null;
  try {
    conn = new DatabaseSync(db, { timeout: 3000 });
    conn.exec("PRAGMA busy_timeout = 3000");
    const table = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'state'")
      .get();
    const rows = table
      ? conn.prepare("SELECT name, key, value FROM state WHERE key LIKE 'settings.v%'").all()
      : [];
    /* 每个 store 只处理版本号最高的设置键（settings.v3 / 未来可能的 v4…） */
    const latest = new Map();
    for (const row of rows) {
      const m = /^settings\.v(\d+)$/.exec(row.key);
      if (!m) continue;
      const n = Number(m[1]);
      const prev = latest.get(row.name);
      if (!prev || n > prev.n) latest.set(row.name, { n, key: row.key, value: row.value });
    }
    if (!latest.size) {
      log(`[${app}] 还没有可用的设置数据，跳过；插件启动时会自动设置。`);
      continue;
    }
    const update = conn.prepare(
      "UPDATE state SET value = ?, updated_at = ? WHERE name = ? AND key = ?",
    );
    let changed = 0;
    for (const [name, row] of latest) {
      let settings;
      try {
        settings = JSON.parse(row.value) || {};
      } catch {
        settings = {};
      }
      if (!settings.appearance || typeof settings.appearance !== "object") settings.appearance = {};
      if (settings.appearance.tabLayout === "vertical") continue;
      settings.appearance.tabLayout = "vertical";
      update.run(JSON.stringify(settings), Date.now(), name, row.key);
      changed++;
    }
    log(changed
      ? `[${app}] 已把 Tabs 模式设为竖排（vertical），重启 OpenCode 桌面端后生效。`
      : `[${app}] Tabs 已经是竖排（vertical），无需修改。`);
  } catch (err) {
    log(`[${app}] 写入设置失败：${(err && err.message) || err}（不影响安装，插件启动时会自动补上）`);
  } finally {
    try { if (conn) conn.close(); } catch {}
  }
}
