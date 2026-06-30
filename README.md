# S-TextPaste

绝密级零信任端到端加密文本分享 — Zero-trust E2E encrypted text sharing with triple-envelope post-quantum encryption.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/stop666two/S-TextPaste)

---

## 一键部署

点击上方按钮，Cloudflare 自动完成全部配置，包括 D1 数据库创建。

---

## 特性

- **极限加密**：所有加解密在浏览器完成，服务器只收发密文
- **强制密码**：创建粘贴必须设置密码，SHA-256 + MD5 复杂链式 KDF
- **后量子加密**：三重包络 AES-256-GCM，两个 1024-bit 独立派生密钥
- **HMAC 完整性校验**：全载荷 HMAC-SHA-256，防篡改
- **阅后即焚**：解密成功后服务器立即删除
- **密码锁定**：连续 5 次错误后拒绝访问
- **过期时间**：1h / 24h / 7d / 30d / 永久
- **暗黑模式**：自动检测系统主题
- **中英双语**：界面完整翻译
- **Markdown 全功能**：CodeMirror 6 + 实时预览 + GFM + Mermaid + KaTeX + 代码高亮
- **安全性仪表盘**：解密页展示加密算法、密钥强度、量子安全状态
- **32 字符随机 ID**：64^32 组合空间，防暴力破解
- **速率限制**：每 IP 30 次/分钟，HTTP 429

---

## 本地开发

```bash
# 终端 1 — 后端 API
cd worker && node server.js     # http://localhost:8787

# 终端 2 — 前端
cd frontend && npm install && npm run dev   # http://localhost:3000
```

---

## 加密架构

```
密码 ──→ derive512(12轮链式SHA-256⊕MD5)    → 512-bit 基础密钥
     ──→ derive1024A(24轮链式SHA→MD5)      → 1024-bit PQ密钥A
     ──→ derive1024B(24轮链式MD5→SHA)      → 1024-bit PQ密钥B
     ──→ deriveHMAC(7轮独立链式迭代)        → HMAC 完整性密钥

明文 → DEK随机 → AES-GCM → KeyA → AES-GCM → KeyB → AES-GCM → encrypted_payload
                                                     ↓
                                          HMAC-SHA-256(全部字段) → 防篡改
```

每一轮 KDF 同时使用 SHA-256 和 MD5，链式迭代，不同密钥完全不同的推导路径。

---

## 数据流

```
浏览器                          Cloudflare Workers            D1
  │                                    │                      │
  ├─ 加密(Web Crypto API) ────────────►│                      │
  │  POST /api/paste {encrypted_payload}├─────────────────────►│
  │                                    │                      │
  │◄─────── {id, delete_token} ────────┤                      │
  │                                    │                      │
  │  GET /api/paste/:id ──────────────►│                      │
  │                                    ├─── SELECT ──────────►│
  │◄────── {encrypted_payload} ────────┤                      │
  │                                    │                      │
  ├─ 解密(Web Crypto API) ─────────────┤                      │
  │                                    │                      │
```

---

## 项目结构

```
├── src/                    # Worker 源码
│   ├── index.ts            # Hono 入口 (API + 静态文件 + SPA)
│   ├── routes/api.ts       # REST API (/paste CRUD)
│   ├── db/pastes.ts        # D1 数据库操作
│   └── utils/crypto.ts     # 服务端工具
├── frontend/               # React 前端
│   ├── src/
│   │   ├── crypto.ts       # 全部加密解密逻辑
│   │   ├── pages/          # CreatePage / ReadPage / ViewPage
│   │   ├── components/     # MarkdownEditor / SecurityDashboard / Layout
│   │   ├── i18n/           # 中英文翻译
│   │   └── api.ts          # API 客户端
│   └── vite.config.ts
├── worker/
│   └── server.js           # 本地开发 API 模拟
├── scripts/                # 构建工具
├── wrangler.toml           # Cloudflare Workers 配置
└── package.json
```

---

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/paste` | 创建粘贴 |
| GET | `/api/paste/:id` | 获取粘贴 |
| POST | `/api/paste/:id/view` | 记录查看 |
| DELETE | `/api/paste/:id` | 删除 (需 `X-Delete-Token`) |

---

## 安全

- AES-256-GCM 认证加密，防篡改
- HMAC-SHA-256 全载荷校验
- CSP `default-src 'self'`
- HTTPS 强制 (Cloudflare)
- 32 字符随机 ID (64^32)
- 速率限制 30/min/IP
- 删除令牌 SHA-256 哈希存储

---

## 技术栈

React 18 · TypeScript · Vite · CodeMirror 6 · marked · Mermaid · KaTeX · highlight.js · DOMPurify · Hono · Cloudflare Workers · D1
