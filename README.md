# S-TextPaste

> 绝密级 · 零信任 · 端到端加密文本分享  
> Triple-Envelope Post-Quantum Encryption

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/stop666two/S-TextPaste)

---

## 目录

- [一键部署](#一键部署)
- [D1 数据库持久化](#d1-数据库持久化)
- [本地开发](#本地开发)
- [服务器部署](#服务器部署)
- [加密架构](#加密架构)
- [安全特性](#安全特性)
- [API 文档](#api-文档)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 一键部署

点击上方按钮，Cloudflare 自动完成全部流程。部署后可立即使用（内存模式）。

## D1 数据库持久化

部署后添加 D1 以获得持久化存储：

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → `s-textpaste-text`
2. Settings → **D1 Database Bindings** → Add binding
3. Variable: `DB`，选择或创建 `s-textpaste-db`
4. 无需重新部署，Worker 自动检测并切换到 D1

## 本地开发

```bash
# 终端 1 — 后端
cd worker && node server.js          # http://localhost:8787

# 终端 2 — 前端
cd frontend && npm install && npm run dev  # http://localhost:3000
```

## 服务器部署

### Cloudflare Workers (推荐)
```bash
git clone https://github.com/stop666two/S-TextPaste
cd S-TextPaste
npx wrangler d1 create s-textpaste-db    # 创建 D1
# 编辑 wrangler.toml，填入 database_id
npm install && npm run build && npx wrangler deploy
```

### 自建服务器
```bash
# 使用 Node.js 运行 worker/server.js
node worker/server.js                    # API 在 :8787

# 前端使用 Nginx 或直接 serve
cd frontend && npm run build             # 输出到 dist/
# 将 dist/ 部署到 Nginx，代理 /api 到 :8787
```

---

## 加密架构

### 密钥派生 (KDF)

```
密码 + 随机盐
    │
    ├─→ derive512     [ SHA-256⊕MD5 链式 12 轮 ] = 512-bit  基础密钥
    ├─→ derive1024A   [ SHA→MD5 链式 24 轮 ]     = 1024-bit PQ 密钥 A
    ├─→ derive1024B   [ MD5→SHA 链式 24 轮 ]     = 1024-bit PQ 密钥 B
    └─→ deriveHMAC    [ 独立链式 7 轮 ]           = 256-bit  HMAC 密钥
```

**每一轮同时使用 SHA-256 和 MD5**，XOR 交织，链式迭代。三个密钥**完全不同的推导路径**。

### 加密流程

```
明文
  │
  ├─ [Layer 1] DEK(随机32字节) ──AES-256-GCM──→ ciphertext_L1
  │
  ├─ [Layer 2] PQ密钥A(1024bit) ──AES-256-GCM──→ ciphertext_L2
  │
  ├─ [Layer 3] PQ密钥B(1024bit) ──AES-256-GCM──→ ciphertext_L3
  │
  └─ HMAC-SHA-256(integrityKey, 全载荷字段) ────→ 防篡改标签
```

### 解密流程

```
encrypted_payload
  │
  ├─ 验证 HMAC (任何篡改 → 立即拒绝)
  │
  ├─ PQ密钥B 解密 → ciphertext_L2
  ├─ PQ密钥A 解密 → DEK
  └─ DEK 解密 → 明文
```

**错误密码 → HMAC 或 AES-GCM 认证失败 → 解密中止**

---

## 安全特性

| 特性 | 实现 |
|------|------|
| 加密算法 | AES-256-GCM (认证加密) |
| 完整性 | HMAC-SHA-256 全载荷校验 |
| 密钥长度 | 512-bit 基础 + 1024-bit×2 PQ |
| KDF 轮数 | 12 + 24 + 24 + 7 = 67 轮链式迭代 |
| 传输安全 | HTTPS 强制 (Cloudflare) |
| 内容安全策略 | `default-src 'self'` |
| 链接爆破防护 | 32 字符随机 ID (64^32 组合空间) |
| 速率限制 | 30 次/分钟/IP |
| 删除令牌 | SHA-256 哈希存储，不可逆 |
| 密码锁定 | 连续 5 次错误后拒绝 |
| 内容泄露 | React Router state 内存传递，不出现在 URL |
| 载荷元数据 | salt/mode/hint 全部嵌入密文 |

---

## API 文档

Base: `https://<your-domain>`

### POST `/api/paste` — 创建粘贴

**请求**:
```json
{
  "mode": "password",
  "encrypted_payload": "base64...",
  "hint": "提示文字(可选)",
  "expires_in": 3600000,
  "max_views": 5,
  "burn_after_read": 1,
  "custom_id": "my-note"
}
```

**返回** `201`:
```json
{
  "id": "abc123...",
  "delete_token": "hex...",
  "storage": "memory"
}
```

### GET `/api/paste/:id` — 获取粘贴

**返回**:
```json
{
  "encrypted_payload": "base64...",
  "expires_at": null,
  "view_count": 0,
  "max_views": -1,
  "burn_after_read": 0,
  "storage": "d1"
}
```

> 仅返回加密载荷和生命周期字段。salt、mode、hint、algorithm 全部嵌入 `encrypted_payload` 内。

### POST `/api/paste/:id/view` — 记录查看

触发计数和阅后即焚逻辑。

### DELETE `/api/paste/:id` — 删除粘贴

**Headers**: `X-Delete-Token: <创建时返回的 token>`

---

## 项目结构

```
├── src/                         # Cloudflare Worker 源码
│   ├── index.ts                 # Hono 入口 (API + SPA)
│   └── routes/api.ts            # REST API (D1 双模存储)
├── frontend/                    # React 18 前端
│   ├── src/
│   │   ├── crypto.ts            # 全部加密解密逻辑 (客户端)
│   │   ├── pages/CreatePage.tsx # 创建页面
│   │   ├── pages/ReadPage.tsx   # 解密页面
│   │   ├── pages/ViewPage.tsx   # 查看页面
│   │   ├── components/          # 编辑器、仪表盘、免责声明
│   │   ├── i18n/                # 中/英文翻译
│   │   └── api.ts               # API 客户端
│   └── vite.config.ts
├── worker/
│   └── server.js                # 本地开发 API 模拟
├── scripts/                     # 构建工具
├── wrangler.toml                # Workers 配置
└── package.json
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 编辑器 | CodeMirror 6 |
| Markdown | marked + highlight.js + Mermaid + KaTeX |
| 安全过滤 | DOMPurify |
| 加密 | Web Crypto API (浏览器原生) |
| 后端运行时 | Cloudflare Workers |
| 后端框架 | Hono 4 |
| 数据库 | Cloudflare D1 |
| 部署 | Wrangler CLI |

---

## 许可证

MIT
