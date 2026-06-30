import { Hono } from 'hono'

type D1 = any

const app = new Hono()
let d1ok = false

async function sha256(s: string) {
  const d = new TextEncoder().encode(s)
  const h = await crypto.subtle.digest('SHA-256', d)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function rid(n = 32) {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
  const b = crypto.getRandomValues(new Uint8Array(n * 2)); let r = ''
  for (let i = 0; i < b.length && r.length < n; i++) { const x = b[i] & 63; if (x < c.length) r += c[x] }
  return r
}

async function tok() {
  const t = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')
  return { token: t, hash: await sha256(t) }
}

async function init(db: D1) {
  if (d1ok) return
  await db.prepare(`CREATE TABLE IF NOT EXISTS pastes (id TEXT PRIMARY KEY, mode TEXT NOT NULL, salt TEXT, encrypted_payload TEXT NOT NULL, hint TEXT DEFAULT '', delete_token_hash TEXT NOT NULL, expires_at INTEGER, max_views INTEGER DEFAULT -1, view_count INTEGER DEFAULT 0, burn_after_read INTEGER DEFAULT 0, created_at INTEGER NOT NULL, pubkey_fingerprint TEXT)`).run()
  d1ok = true
}

app.use('/api/*', async (c, next) => { await next(); c.header('Access-Control-Allow-Origin', c.req.header('Origin') || '*'); c.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS'); c.header('Access-Control-Allow-Headers', 'Content-Type,X-Delete-Token'); c.header('Cache-Control', 'no-store') })

app.post('/api/paste', async (c) => {
  const db: D1 = (c.env as any)?.DB
  if (!db) return c.json({ error: 'DB not bound' }, 500)
  await init(db)

  let b: any; try { b = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { mode, salt, encrypted_payload, hint = '', expires_in, max_views = -1, burn_after_read = 0, custom_id } = b
  if (!mode || !encrypted_payload) return c.json({ error: 'Missing fields' }, 400)
  if (!['password','symmetric','asymmetric'].includes(mode)) return c.json({ error: 'Invalid mode' }, 400)
  if (custom_id && (custom_id.length > 64 || custom_id.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(custom_id))) return c.json({ error: 'Invalid custom_id' }, 400)

  const id = custom_id || rid()
  if (await db.prepare('SELECT id FROM pastes WHERE id=?').bind(id).first()) return c.json({ error: 'ID exists' }, 409)

  const { token, hash } = await tok()
  const now = Date.now(); let ea: number | null = null
  if (expires_in) { const ms = parseInt(String(expires_in), 10); if (ms > 0 && ms <= 365*24*60*60*1000) ea = now + ms }

  await db.prepare('INSERT OR REPLACE INTO pastes(id,mode,salt,encrypted_payload,hint,delete_token_hash,expires_at,max_views,view_count,burn_after_read,created_at,pubkey_fingerprint) VALUES (?,?,?,?,?,?,?,?,0,?,?,?)')
    .bind(id, mode, salt || null, encrypted_payload, hint || '', hash, ea, max_views, burn_after_read ? 1 : 0, now, b.pubkey_fingerprint || null).run()

  return c.json({ id, delete_token: token, expires_at: ea }, 201)
})

app.get('/api/paste/:id', async (c) => {
  const db: D1 = (c.env as any)?.DB
  if (!db) return c.json({ error: 'DB not bound' }, 500)

  const id = c.req.param('id')
  const p: any = await db.prepare('SELECT * FROM pastes WHERE id=?').bind(id).first()
  if (!p) return c.json({ error: 'Not found' }, 404)

  if (p.expires_at && Date.now() > p.expires_at) { await db.prepare('DELETE FROM pastes WHERE id=?').bind(id).run(); return c.json({ error: 'Expired' }, 410) }
  if (p.max_views >= 0 && p.view_count >= p.max_views) { await db.prepare('DELETE FROM pastes WHERE id=?').bind(id).run(); return c.json({ error: 'Max views' }, 410) }

  return c.json({ encrypted_payload: p.encrypted_payload, expires_at: p.expires_at, view_count: p.view_count, max_views: p.max_views, burn_after_read: p.burn_after_read, created_at: p.created_at })
})

app.post('/api/paste/:id/view', async (c) => {
  const db: D1 = (c.env as any)?.DB
  if (!db) return c.json({ error: 'DB not bound' }, 500)

  const id = c.req.param('id')
  const p: any = await db.prepare('SELECT * FROM pastes WHERE id=?').bind(id).first()
  if (!p) return c.json({ error: 'Not found' }, 404)
  if (p.expires_at && Date.now() > p.expires_at) { await db.prepare('DELETE FROM pastes WHERE id=?').bind(id).run(); return c.json({ error: 'Expired' }, 410) }

  await db.prepare('UPDATE pastes SET view_count=view_count+1 WHERE id=?').bind(id).run()
  if (p.burn_after_read === 1) await db.prepare('DELETE FROM pastes WHERE id=?').bind(id).run()

  return c.json({ success: true, view_count: p.view_count + 1, burn_after_read: p.burn_after_read, max_views: p.max_views })
})

app.delete('/api/paste/:id', async (c) => {
  const db: D1 = (c.env as any)?.DB
  if (!db) return c.json({ error: 'DB not bound' }, 500)

  const id = c.req.param('id')
  const token = c.req.header('X-Delete-Token')
  if (!token) return c.json({ error: 'Token required' }, 401)

  const p: any = await db.prepare('SELECT delete_token_hash FROM pastes WHERE id=?').bind(id).first()
  if (!p) return c.json({ error: 'Not found' }, 404)
  if ((await sha256(token)) !== p.delete_token_hash) return c.json({ error: 'Invalid token' }, 401)

  await db.prepare('DELETE FROM pastes WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

app.options('/api/*', c => c.text(''))

export default app
