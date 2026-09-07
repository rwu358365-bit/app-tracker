import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { z } from "zod";

// ── 配置 ──
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "ruirui2026";

// ── 数据库 ──
const dbDir = "/data";
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
const db = new Database(`${dbDir}/apps.db`);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL,
    opened_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )
`);

// ── Express ──
const app = express();
app.use(express.json());
app.use(express.text());

// 简单鉴权中间件（给 POST 接口用）
function authCheck(req, res, next) {
  const token = req.headers["x-token"] || req.query.token;
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ── iOS 快捷指令 POST 接口 ──
app.post("/api/log", authCheck, (req, res) => {
  let appName;
  if (typeof req.body === "string") {
    appName = req.body.trim();
  } else {
    appName = req.body?.app?.trim();
  }
  if (!appName) return res.status(400).json({ error: "missing app name" });

  db.prepare("INSERT INTO app_logs (app_name) VALUES (?)").run(appName);
  res.json({ ok: true, app: appName });
});

// 健康检查
app.get("/", (req, res) => {
  res.json({ status: "running", name: "瑞瑞的App记录器 🐷" });
});

// ── MCP (SSE) ──
const sessions = new Map();

app.get("/mcp", (req, res) => {
  const transport = new SSEServerTransport("/mcp/message", res);
  const server = new McpServer({
    name: "app-tracker",
    version: "1.0.0",
  });

  // 工具1：最近打开的App
  server.tool(
    "get_recent_apps",
    "查看瑞瑞最近打开的App记录",
    { limit: z.number().optional().default(20).describe("返回条数，默认20") },
    ({ limit }) => {
      const rows = db
        .prepare("SELECT app_name, opened_at FROM app_logs ORDER BY id DESC LIMIT ?")
        .all(limit);
      if (rows.length === 0) {
        return { content: [{ type: "text", text: "还没有记录呢，快捷指令还没触发过。" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // 工具2：某天的App统计
  server.tool(
    "get_app_stats",
    "统计瑞瑞某一天的App使用次数",
    { date: z.string().optional().describe("日期 YYYY-MM-DD，不填默认今天") },
    ({ date }) => {
      const d = date || new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const rows = db
        .prepare(
          "SELECT app_name, COUNT(*) as open_count FROM app_logs WHERE date(opened_at) = ? GROUP BY app_name ORDER BY open_count DESC"
        )
        .all(d);
      const total = rows.reduce((s, r) => s + r.open_count, 0);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ date: d, total_opens: total, apps: rows }, null, 2),
          },
        ],
      };
    }
  );

  // 工具3：当前正在用什么（最后一条记录）
  server.tool("get_current_app", "看看瑞瑞现在/刚才在用什么App", {}, () => {
    const row = db
      .prepare("SELECT app_name, opened_at FROM app_logs ORDER BY id DESC LIMIT 1")
      .get();
    if (!row) return { content: [{ type: "text", text: "还没有记录。" }] };
    return {
      content: [{ type: "text", text: `最后打开的是「${row.app_name}」，时间：${row.opened_at}` }],
    };
  });

  server.connect(transport);
  sessions.set(transport.sessionId, { transport, server });

  res.on("close", () => {
    sessions.delete(transport.sessionId);
  });
});

app.post("/mcp/message", (req, res) => {
  const sessionId = req.query.sessionId;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: "session not found" });
  s.transport.handlePostMessage(req, res);
});

// ── 启动 ──
app.listen(PORT, () => {
  console.log(`🐷 App Tracker running on port ${PORT}`);
});
