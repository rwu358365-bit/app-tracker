import express from "express";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "ruirui2026";

// ── 内存存储 ──
let logs = [];

function addLog(appName) {
  const now = new Date(Date.now() + 8 * 3600000).toISOString().replace("T", " ").slice(0, 19);
  logs.push({ app_name: appName, opened_at: now });
  if (logs.length > 5000) logs.splice(0, logs.length - 5000);
}

// ── MCP 工具 ──
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
    const recent = logs.slice(-limit).reverse();
    return recent.length === 0 ? "还没有记录呢。" : JSON.stringify(recent, null, 2);
  }
  if (name === "get_app_stats") {
    const d = args?.date || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const filtered = logs.filter((l) => l.opened_at.startsWith(d));
    const counts = {};
    for (const l of filtered) counts[l.app_name] = (counts[l.app_name] || 0) + 1;
    const apps = Object.entries(counts).map(([app_name, open_count]) => ({ app_name, open_count })).sort((a, b) => b.open_count - a.open_count);
    return JSON.stringify({ date: d, total_opens: filtered.length, apps }, null, 2);
  }
  if (name === "get_current_app") {
    if (logs.length === 0) return "还没有记录。";
    const last = logs[logs.length - 1];
    return "最后打开的是「" + last.app_name + "」，时间：" + last.opened_at;
  }
  return "未知工具";
}

// ── Express ──
const app = express();
app.use(express.json());
app.use(express.text());
app.use(express.urlencoded({ extended: true }));

function authCheck(req, res, next) {
  const token = req.headers["x-token"] || req.query.token;
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ── OAuth 2.0 (给Claude连接器用) ──
const oauthCodes = new Map();
const oauthTokens = new Set();

// 动态获取 base URL
function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return proto + "://" + host;
}

// OAuth 元数据发现
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = getBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: base + "/oauth/authorize",
    token_endpoint: base + "/oauth/token",
    registration_endpoint: base + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    code_challenge_methods_supported: ["S256", "plain"],
  });
});

// 动态客户端注册
app.post("/oauth/register", (req, res) => {
  const clientId = "client_" + crypto.randomUUID();
  const clientSecret = "secret_" + crypto.randomUUID();
  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: req.body.redirect_uris || [],
    client_name: req.body.client_name || "Claude",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: req.body.token_endpoint_auth_method || "client_secret_post",
  });
});

// 授权端点 - 自动批准并重定向
app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method, client_id } = req.query;
  const code = "code_" + crypto.randomUUID();
  oauthCodes.set(code, {
    redirect_uri,
    client_id,
    code_challenge,
    code_challenge_method,
    created: Date.now(),
  });
  // 自动批准，直接重定向
  const url = redirect_uri + "?code=" + encodeURIComponent(code) + (state ? "&state=" + encodeURIComponent(state) : "");
  res.redirect(302, url);
});

// Token 端点
app.post("/oauth/token", (req, res) => {
  const grantType = req.body.grant_type;

  if (grantType === "authorization_code") {
    const code = req.body.code;
    const stored = oauthCodes.get(code);
    if (!stored) {
      return res.status(400).json({ error: "invalid_grant" });
    }
    oauthCodes.delete(code);

    // PKCE 验证
    if (stored.code_challenge && req.body.code_verifier) {
      let computed;
      if (stored.code_challenge_method === "S256") {
        computed = crypto.createHash("sha256").update(req.body.code_verifier).digest("base64url");
      } else {
        computed = req.body.code_verifier;
      }
      if (computed !== stored.code_challenge) {
        return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      }
    }

    const accessToken = "at_" + crypto.randomUUID();
    const refreshToken = "rt_" + crypto.randomUUID();
    oauthTokens.add(accessToken);

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: refreshToken,
    });
  } else if (grantType === "refresh_token") {
    const accessToken = "at_" + crypto.randomUUID();
    oauthTokens.add(accessToken);
    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: req.body.refresh_token,
    });
  } else {
    res.status(400).json({ error: "unsupported_grant_type" });
  }
});

// ── iOS 快捷指令 ──
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

// ── MCP SSE ──
const sessions = new Map();

app.get("/mcp", (req, res) => {
  const sessionId = crypto.randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  function send(event, data) {
    res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  }
  send("endpoint", "/mcp/message?sessionId=" + sessionId);
  sessions.set(sessionId, { send, res });
  var keepAlive = setInterval(function () { res.write(": ping\n\n"); }, 25000);
  res.on("close", function () {
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
});

app.post("/mcp/message", (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "session not found" });
  const msg = req.body;
  var response = null;
  if (msg.method === "initialize") {
    response = { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "app-tracker", version: "1.0.0" } } };
  } else if (msg.method === "notifications/initialized") {
    res.status(202).end();
    return;
  } else if (msg.method === "tools/list") {
    response = { jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } };
  } else if (msg.method === "tools/call") {
    var text = handleTool(msg.params?.name, msg.params?.arguments);
    response = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: text }] } };
  } else if (msg.method === "ping") {
    response = { jsonrpc: "2.0", id: msg.id, result: {} };
  } else {
    response = { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
  }
  if (response) session.send("message", response);
  res.status(202).end();
});

app.listen(PORT, function () {
  console.log("App Tracker running on port " + PORT);
});
