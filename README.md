# Liuxian Lab v3

Liuxian Lab 是一个需要登录才能访问的私有工具工作台。当前架构采用 Node.js + Express，账号由管理员在终端创建；主界面负责集中展示工具入口，每个工具可以在独立目录中继续开发。

## 本地运行

```bash
npm install
npm run dev
```

访问：`http://127.0.0.1:8080`

## 账号管理

```bash
npm run user:create -- liuxian
npm run user:list
```

## 工具配置

工具列表集中在：

```text
config/tools.json
```

新增一个仅用于展示的工具，只需要先在 `tools.json` 增加配置。此时点击卡片会进入统一的“开发中”页面。

## 单独开发某个工具

例如要实现 `json-formatter`：

```text
private/tools/json-formatter/
├── index.html
├── tool.css
└── tool.js
```

服务器会自动检测 `private/tools/json-formatter/index.html`。文件存在时，访问 `/tools/json-formatter` 会直接加载真实工具；不存在时展示统一占位页。

可以复制：

```text
private/tools/_template/
```

作为新工具起点。

## 目录

```text
liuxianlab-ui/
├── config/
│   └── tools.json
├── data/
│   ├── users.example.json
│   └── users.json
├── private/
│   ├── index.html
│   ├── styles.css
│   ├── script.js
│   ├── tool.html
│   ├── tool.css
│   ├── tool.js
│   └── tools/
│       └── _template/
├── public/
│   ├── login.html
│   ├── login.css
│   └── login.js
├── sessions/
├── server.js
├── create-user.js
├── list-users.js
├── package.json
├── .env
└── .env.example
```

## 腾讯云部署方向

正式上线时建议：腾讯云 CVM / 轻量应用服务器 → Nginx → Node.js `127.0.0.1:8080`。公网只开放 80/443，Node.js 端口不直接暴露；HTTPS 与域名完成后再将 `NODE_ENV` 设置为 `production`。

不要上传 `.env`、`data/users.json` 或 `sessions/` 中的会话文件。
