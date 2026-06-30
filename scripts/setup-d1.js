#!/usr/bin/env node
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const toml = path.join(__dirname, '..', 'wrangler.toml')
if (!fs.existsSync(toml)) { console.log('No wrangler.toml'); process.exit(0) }

let config = fs.readFileSync(toml, 'utf-8')

// If database_id is already set (not empty placeholder), skip
if (config.includes('database_id = "') && !config.includes('database_id = ""')) {
  console.log('database_id already set')
  process.exit(0)
}

// Try to get database_id from wrangler d1 list
try {
  const out = execSync('npx wrangler d1 list --json', { encoding: 'utf-8', timeout: 15000 })
  const dbs = JSON.parse(out)
  const target = (Array.isArray(dbs) ? dbs : dbs.result || []).find(
    d => d.name === 's-textpaste-db' || d.name === 's-textpaste-text-db'
  )
  if (target && target.uuid) {
    config = config.replace(/database_id = ""/, `database_id = "${target.uuid}"`)
    fs.writeFileSync(toml, config)
    console.log(`Set database_id = "${target.uuid}"`)
  } else {
    console.log('No D1 database found, keeping placeholder')
  }
} catch (e) {
  console.log('Could not detect D1:', e.message)
}
