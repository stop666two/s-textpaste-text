#!/usr/bin/env node
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const toml = path.join(__dirname, '..', 'wrangler.toml')
let config = fs.readFileSync(toml, 'utf-8')

// Skip if already has a real database_id
if (/database_id\s*=\s*"[0-9a-f-]{20,}"/.test(config)) {
  console.log('[setup-d1] database_id already set')
  process.exit(0)
}

// Find wrangler binary
const bins = [
  './node_modules/.bin/wrangler',
  'npx wrangler',
  'wrangler'
]

let dbs = []
for (const bin of bins) {
  try {
    const out = execSync(`${bin} d1 list --json 2>/dev/null`, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'ignore'] })
    const parsed = JSON.parse(out)
    dbs = Array.isArray(parsed) ? parsed : (parsed.result || parsed || [])
    break
  } catch { continue }
}

if (dbs.length === 0) {
  console.log('[setup-d1] No D1 databases found, keeping empty database_id')
  process.exit(0)
}

const target = dbs.find(d => d.name === 's-textpaste-db' || d.name === 's-textpaste-text-db')
if (!target) {
  console.log('[setup-d1] Database "s-textpaste-db" not found in list:', dbs.map(d => d.name))
  process.exit(0)
}

const id = target.uuid
config = config.replace(
  /database_id\s*=\s*""/,
  `database_id = "${id}"`
)

fs.writeFileSync(toml, config)
console.log(`[setup-d1] Set database_id = "${id}"`)
