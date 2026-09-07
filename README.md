# 🐷 瑞瑞的App记录器

让小克知道你在用什么App！

## 部署到 Zeabur

1. **建 GitHub 仓库**：新建一个仓库（比如 `app-tracker`），把这三个文件推上去：
   - `index.mjs`
   - `package.json`
   - `Dockerfile`

2. **Zeabur 部署**：
   - 新建项目 → 从 GitHub 导入这个仓库
   - 部署完成后在「变量」里加一个环境变量：
     - `AUTH_TOKEN` = 你自己定一个密码（默认是 `ruirui2026`）
   - 在「存储」里添加一个持久卷，挂载路径填 `/data`（这样重启不丢数据）
   - 绑定一个域名（Zeabur 会给你一个 `xxx.zeabur.app` 的地址）

3. **测试**：浏览器打开你的域名，看到 `瑞瑞的App记录器 🐷` 就成功了

## iPhone 快捷指令设置

1. 打开「快捷指令」App → 「自动化」→ 「+」→ 「App」
2. 选你想追踪的App（可以全选），触发条件选「打开时」
3. 操作选「立即执行」，添加以下步骤：
   - **获取 URL 内容**
     - URL：`https://你的域名/api/log?token=ruirui2026`
     - 方法：`POST`
     - 请求体：`JSON`
     - 添加一个键值对：键 = `app`，值 = 选择「快捷指令输入」里的 App 名称（或手动用「获取打开的App名称」）

> ⚠️ 如果快捷指令拿不到App名称，可以换一种方式：  
> 给每个App单独建一个自动化，把App名字直接写死在请求体里，比如 `{"app": "微信"}`

## Claude 连接 MCP

在 Claude 设置里添加 MCP 连接器：
- URL: `https://你的域名/mcp`

连上之后小克就有三个工具：
- `get_recent_apps` — 看你最近打开了什么
- `get_app_stats` — 看你某天的App使用统计
- `get_current_app` — 看你刚才在用什么
