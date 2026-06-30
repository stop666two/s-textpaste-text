import { Hono } from 'hono'
import api from './routes/api'

const app = new Hono()

app.route('/', api)

// Global error handler — always return JSON, never HTML
app.onError((err, c) => {
  console.error('Worker error:', err.message)
  return c.json({ error: err.message || 'Internal error' }, 500)
})

export default app
