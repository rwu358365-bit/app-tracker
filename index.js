import express from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import crypto from "crypto";

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "ruirui2026";

// ── JSON 存储 ──
const DATA_DIR = existsSync("/data") ? "/data" : "./data";
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = `${DATA_DIR}/apps.json`;

function readLogs() {
  if (!existsSync(DB_FILE)) return [];
  try { return JSON.parse(readFileSync(DB_FILE, "utf-8")); } catch { return []; }
}
function writeLogs(logs) {
  writeFileSync(DB_FILE, JSON.stringify(logs));
}
function addLog(appName) {
  const logs = readLogs();
  const now = new Date(Date.now() + 8 * 3600000).toISOString().replace("T", " ").slice(0, 19);
  logs.push({ app_name: appName, opened_at: now });
  if (logs.length > 5000) logs.splice(0, logs.length - 5000);
  writeLogs(logs);
}

// ── MCP 工具定义 ──
const TOOLS = [
  {
    name: "get_recent_apps",
    description: "查看瑞瑞最近打开的App记录",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "返回条数，默认20", default: 20 } },
    },
  },
  {
    name: "get_app_stats",
    description: "统计瑞瑞某一天的App使用次数",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "日期 YYYY-MM-DD，不填默认今天" } },
    },
  },
  {
    name: "get_current_app",
    description: "看看瑞瑞现在/刚才在用什么App",
    inputSchema: { type: "object", properties: {} },
  },
];

function handleTool(name, args) {
  if (name === "get_recent_apps") {
    const limit = args?.limit || 20;
    const logs = readLogs();
    const recent = logs.slice(-limit).reverse();
    return recent.length === 0 ? "还没有记录呢。" : JSON.stringify(recent, null, 2);
  }
  if (name === "get_app_stats") {
    const d = args?.date || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const logs = readLogs().filter((l) => l.opened_at.startsWith(d));
    const counts = {};
    for (const l of logs) counts[l.app_name] = (counts[l.app_name] || 0) + 1;
    const apps = Object.entries(counts).map(([app_name, open_count]) => ({ app_name, open_count })).sort((a, b) => b.open_count - a.open_count);
    return JSON.stringify({ date: d, total_opens: logs.length, apps }, null, 2);
  }
  if (name === "get_current_app") {
    const logs = readLogs();
    if (logs.length === 0) return "还没有记录。";
    const last = logs[logs.length - 1];
    return `最后打开的是「${last.app_name}」，时间：${last.opened_at}`;
  }
  return "未知工具";
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

// iOS 快捷指令
app.post("/api/log", authCheck, (req, res) => {
  let appName;
  if (typeof req.body === "string") appName = req.body.trim();
  else appName = req.body?.app?.trim();
  if (!appName) return res.status(400).json({ error: "missing app name" });
  addLog(appName);
  res.json({ ok: true, app: appName });
});

app.get("/", (req, res) => {
  res.json({ status: "running", name: "瑞瑞的App记录器 🐷" });
});

// ── 手写 MCP SSE ──
const sessions = new Map();

// SSE 连接
app.get("/mcp", (req, res) => {
  const sessionId = crypto.randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  send("endpoint", `/mcp/message?sessionId=${sessionId}`);
  sessions.set(sessionId, { send, res });

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
  res.on("close", () => {
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
});

// JSON-RPC 消息处理
app.post("/mcp/message", (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "session not found" });

  const msg = req.body;
  let response = null;

  if (msg.method === "initialize") {
    response = {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "app-tracker", version: "1.0.0" },
      },
    };
  } else if (msg.method === "notifications/initialized") {
    res.status(202).end();
    return;
  } else if (msg.method === "tools/list") {
    response = {
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: TOOLS },
    };
  } else if (msg.method === "tools/call") {
    const text = handleTool(msg.params?.name, msg.params?.arguments);
    response = {
      jsonrpc: "2.0",
      id: msg.id,
      result: { content: [{ type: "text", text }] },
    };
  } else if (msg.method === "ping") {
    response = { jsonrpc: "2.0", id: msg.id, result: {} };
  } else {
    response = {
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: "Method not found" },
    };
  }

  if (response) {
    session.send("message", response);
  }
  res.status(202).end();
});

app.listen(PORT, () => {
  console.log(`🐷 App Tracker running on port ${PORT}`);
});
