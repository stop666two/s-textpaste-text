import { Hono } from 'hono'

const app = new Hono()

// ============ Crypto (async, Workers-compatible) ============
async function sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function randId(len = 32): string {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
  const b = crypto.getRandomValues(new Uint8Array(len * 2))
  let id = ''
  for (let i = 0; i < b.length && id.length < len; i++) { const r = b[i] & 63; if (r < c.length) id += c[r] }
  return id
}
async function genToken() {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')
  return { token, hash: await sha256(token) }
}

// ============ D1 Init ============
async function ensureTable(db: any) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS pastes (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    salt TEXT,
    encrypted_payload TEXT NOT NULL,
    hint TEXT DEFAULT '',
    delete_token_hash TEXT NOT NULL,
    expires_at INTEGER,
    max_views INTEGER DEFAULT -1,
    view_count INTEGER DEFAULT 0,
    burn_after_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    pubkey_fingerprint TEXT
  )`).run()
}

// ============ CORS ============
app.use('/api/*', async (c, next) => {
  await next()
  c.header('Access-Control-Allow-Origin', c.req.header('Origin') || '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Delete-Token')
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
  c.header('Cache-Control', 'no-store')
})

// ============ POST /api/paste ============
app.post('/api/paste', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'Database not configured' }, 500)

  await ensureTable(db)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { mode, salt, encrypted_payload, hint = '', expires_in, max_views = -1, burn_after_read = 0, custom_id } = body
  if (!mode || !encrypted_payload) return c.json({ error: 'Missing required fields' }, 400)
  if (!['password', 'symmetric', 'asymmetric'].includes(mode)) return c.json({ error: 'Invalid mode' }, 400)
  if (custom_id && (custom_id.length > 64 || custom_id.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(custom_id))) return c.json({ error: 'Invalid custom_id (8-64 chars)' }, 400)

  const id = custom_id || randId()
  const existing = await db.prepare('SELECT id FROM pastes WHERE id = ?').bind(id).first()
  if (existing) return c.json({ error: 'ID already exists' }, 409)

  const { token, hash } = await genToken()
  const now = Date.now()
  let expires_at: number | null = null
  if (expires_in) {
    const ms = parseInt(String(expires_in), 10)
    if (ms > 0 && ms <= 365 * 24 * 60 * 60 * 1000) expires_at = now + ms
  }

  await db.prepare(
    `INSERT INTO pastes (id, mode, salt, encrypted_payload, hint, delete_token_hash, expires_at, max_views, view_count, burn_after_read, created_at, pubkey_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).bind(id, mode, salt || null, encrypted_payload, hint || '', hash, expires_at, max_views, burn_after_read ? 1 : 0, now, body.pubkey_fingerprint || null).run()

  return c.json({ id, delete_token: token, expires_at }, 201)
})

// ============ GET /api/paste/:id ============
app.get('/api/paste/:id', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'Database not configured' }, 500)

  const id = c.req.param('id')
  const paste = await db.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first()
  if (!paste) return c.json({ error: 'Not found' }, 404)

  if (paste.expires_at && Date.now() > paste.expires_at) {
    await db.prepare('DELETE FROM pastes WHERE id = ?').bind(id).run()
    return c.json({ error: 'Expired' }, 410)
  }
  if (paste.max_views >= 0 && paste.view_count >= paste.max_views) {
    await db.prepare('DELETE FROM pastes WHERE id = ?').bind(id).run()
    return c.json({ error: 'Max views reached' }, 410)
  }

  return c.json({
    encrypted_payload: paste.encrypted_payload,
    expires_at: paste.expires_at,
    view_count: paste.view_count,
    max_views: paste.max_views,
    burn_after_read: paste.burn_after_read,
    created_at: paste.created_at
  })
})

// ============ POST /api/paste/:id/view ============
app.post('/api/paste/:id/view', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'Database not configured' }, 500)

  const id = c.req.param('id')
  const paste = await db.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first()
  if (!paste) return c.json({ error: 'Not found' }, 404)

  if (paste.expires_at && Date.now() > paste.expires_at) {
    await db.prepare('DELETE FROM pastes WHERE id = ?').bind(id).run()
    return c.json({ error: 'Expired' }, 410)
  }

  await db.prepare('UPDATE pastes SET view_count = view_count + 1 WHERE id = ?').bind(id).run()

  if (paste.burn_after_read === 1) {
    await db.prepare('DELETE FROM pastes WHERE id = ?').bind(id).run()
  }

  return c.json({
    success: true,
    view_count: paste.view_count + 1,
    burn_after_read: paste.burn_after_read,
    max_views: paste.max_views
  })
})

// ============ DELETE /api/paste/:id ============
app.delete('/api/paste/:id', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'Database not configured' }, 500)

  const id = c.req.param('id')
  const token = c.req.header('X-Delete-Token')
  if (!token) return c.json({ error: 'Delete token required' }, 401)

  const paste = await db.prepare('SELECT delete_token_hash FROM pastes WHERE id = ?').bind(id).first()
  if (!paste) return c.json({ error: 'Not found' }, 404)

  const hash = await sha256(token)
  if (paste.delete_token_hash !== hash) return c.json({ error: 'Invalid delete token' }, 401)

  await db.prepare('DELETE FROM pastes WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

app.options('/api/*', (c) => c.text(''))

export default app
