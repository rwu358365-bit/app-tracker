import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { z } from "zod";

// ── 配置 ──
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "ruirui2026";

// ── JSON 文件存储 ──
const DATA_DIR = existsSync("/data") ? "/data" : "./data";
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = `${DATA_DIR}/apps.json`;

function readLogs() {
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DB_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeLogs(logs) {
  writeFileSync(DB_FILE, JSON.stringify(logs, null, 2));
}

function addLog(appName) {
  const logs = readLogs();
  const now = new Date(Date.now() + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  logs.push({ app_name: appName, opened_at: now });
  // 只保留最近5000条
  if (logs.length > 5000) logs.splice(0, logs.length - 5000);
  writeLogs(logs);
}

// ── Express ──
const app = express();
app.use(express.json());
app.use(express.text());

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
  addLog(appName);
  res.json({ ok: true, app: appName });
});

app.get("/", (req, res) => {
  res.json({ status: "running", name: "瑞瑞的App记录器 🐷" });
});

// ── MCP (SSE) ──
const sessions = new Map();

app.get("/mcp", (req, res) => {
  const transport = new SSEServerTransport("/mcp/message", res);
  const server = new McpServer({ name: "app-tracker", version: "1.0.0" });

  server.tool(
    "get_recent_apps",
    "查看瑞瑞最近打开的App记录",
    { limit: z.number().optional().default(20).describe("返回条数，默认20") },
    ({ limit }) => {
      const logs = readLogs();
      const recent = logs.slice(-limit).reverse();
      if (recent.length === 0) {
        return { content: [{ type: "text", text: "还没有记录呢。" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(recent, null, 2) }] };
    }
  );

  server.tool(
    "get_app_stats",
    "统计瑞瑞某一天的App使用次数",
    { date: z.string().optional().describe("日期 YYYY-MM-DD，不填默认今天") },
    ({ date }) => {
      const d = date || new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const logs = readLogs().filter((l) => l.opened_at.startsWith(d));
      const counts = {};
      for (const l of logs) counts[l.app_name] = (counts[l.app_name] || 0) + 1;
      const apps = Object.entries(counts)
        .map(([app_name, open_count]) => ({ app_name, open_count }))
        .sort((a, b) => b.open_count - a.open_count);
      return {
        content: [
          { type: "text", text: JSON.stringify({ date: d, total_opens: logs.length, apps }, null, 2) },
        ],
      };
    }
  );

  server.tool("get_current_app", "看看瑞瑞现在/刚才在用什么App", {}, () => {
    const logs = readLogs();
    if (logs.length === 0) return { content: [{ type: "text", text: "还没有记录。" }] };
    const last = logs[logs.length - 1];
    return {
      content: [{ type: "text", text: `最后打开的是「${last.app_name}」，时间：${last.opened_at}` }],
    };
  });

  server.connect(transport);
  sessions.set(transport.sessionId, { transport, server });
  res.on("close", () => sessions.delete(transport.sessionId));
});

app.post("/mcp/message", (req, res) => {
  const sessionId = req.query.sessionId;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: "session not found" });
  s.transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`🐷 App Tracker running on port ${PORT}`);
});
