#!/usr/bin/env node
// End-to-end smoke test for vatnode-mcp.
// Spawns the built server over stdio, exchanges JSON-RPC, asserts results.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { strict as assert } from 'node:assert'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = join(__dirname, '..', 'dist', 'index.js')

function startServer(env = {}) {
  const proc = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  })
  let stderr = ''
  proc.stderr.on('data', (b) => (stderr += b.toString()))
  let buffer = ''
  const pending = new Map()
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id)
        pending.delete(msg.id)
        resolve(msg)
      }
    }
  })
  let nextId = 1
  function rpc(method, params) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  function notify(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }
  function close() {
    proc.stdin.end()
    return new Promise((res) => proc.on('close', res))
  }
  return { rpc, notify, close, getStderr: () => stderr }
}

const cases = []
function test(name, fn) {
  cases.push({ name, fn })
}

test('initialize + tools/list returns 5 tools', async () => {
  const s = startServer()
  const init = await s.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  })
  assert.equal(init.result.serverInfo.name, 'vatnode')
  s.notify('notifications/initialized')
  const list = await s.rpc('tools/list')
  const names = list.result.tools.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'check_vat_format',
    'get_country_vat_rates',
    'list_eu_vat_rates',
    'list_supported_countries',
    'validate_vat_number',
  ])
  // Every tool has non-trivial description (LLM tool selection quality)
  for (const t of list.result.tools) {
    assert.ok(t.description && t.description.length > 60, `${t.name} description too short`)
  }
  await s.close()
})

async function callTool(server, name, args) {
  await server.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  })
  server.notify('notifications/initialized')
  return server.rpc('tools/call', { name, arguments: args })
}

test('get_country_vat_rates DE returns Germany 19%', async () => {
  const s = startServer()
  const r = await callTool(s, 'get_country_vat_rates', { countryCode: 'DE' })
  const data = r.result.structuredContent
  assert.equal(data.countryCode, 'DE')
  assert.equal(data.countryName, 'Germany')
  assert.equal(data.standardRate, 19)
  assert.deepEqual(data.reducedRates, [7])
  assert.ok(data.vatNumberPattern)
  await s.close()
})

test('get_country_vat_rates FI returns 25.5% (verifies fresh data)', async () => {
  const s = startServer()
  const r = await callTool(s, 'get_country_vat_rates', { countryCode: 'FI' })
  assert.equal(r.result.structuredContent.standardRate, 25.5)
  await s.close()
})

test('get_country_vat_rates accepts lowercase', async () => {
  const s = startServer()
  const r = await callTool(s, 'get_country_vat_rates', { countryCode: 'fr' })
  assert.equal(r.result.structuredContent.countryCode, 'FR')
  await s.close()
})

test('get_country_vat_rates unknown returns error', async () => {
  const s = startServer()
  const r = await callTool(s, 'get_country_vat_rates', { countryCode: 'ZZ' })
  assert.equal(r.result.isError, true)
  await s.close()
})

test('get_country_vat_rates supports non-EU (NO)', async () => {
  const s = startServer()
  const r = await callTool(s, 'get_country_vat_rates', { countryCode: 'NO' })
  assert.equal(r.result.structuredContent.countryCode, 'NO')
  assert.equal(r.result.structuredContent.countryName, 'Norway')
  await s.close()
})

test('list_eu_vat_rates returns 28 EU+XI rates', async () => {
  const s = startServer()
  const r = await callTool(s, 'list_eu_vat_rates', {})
  assert.equal(r.result.structuredContent.count, 28)
  assert.ok(r.result.structuredContent.rates.some((x) => x.countryCode === 'XI'))
  await s.close()
})

test('list_supported_countries returns 45 countries, 28 EU members', async () => {
  const s = startServer()
  const r = await callTool(s, 'list_supported_countries', {})
  const { count, euCount, countries } = r.result.structuredContent
  assert.equal(count, 45)
  assert.equal(euCount, 28)
  assert.ok(countries.find((c) => c.countryCode === 'DE').isEUMember)
  assert.equal(countries.find((c) => c.countryCode === 'NO').isEUMember, false)
  await s.close()
})

test('check_vat_format accepts valid DE with spaces', async () => {
  const s = startServer()
  const r = await callTool(s, 'check_vat_format', { vatId: 'DE 123 456 789' })
  const d = r.result.structuredContent
  assert.equal(d.normalized, 'DE123456789')
  assert.equal(d.countryCode, 'DE')
  assert.equal(d.validFormat, true)
  await s.close()
})

test('check_vat_format rejects malformed VAT', async () => {
  const s = startServer()
  const r = await callTool(s, 'check_vat_format', { vatId: 'DE12' })
  assert.equal(r.result.structuredContent.validFormat, false)
  await s.close()
})

test('check_vat_format handles unknown country prefix', async () => {
  const s = startServer()
  const r = await callTool(s, 'check_vat_format', { vatId: 'ZZ12345' })
  assert.equal(r.result.structuredContent.validFormat, false)
  await s.close()
})

test('validate_vat_number without API key returns helpful error', async () => {
  const s = startServer({ VATNODE_API_KEY: '' })
  const r = await callTool(s, 'validate_vat_number', { vatId: 'IE6388047V' })
  assert.equal(r.result.isError, true)
  const text = r.result.content[0].text
  assert.ok(/VATNODE_API_KEY/.test(text), 'error must mention env var')
  assert.ok(/vatnode\.dev/.test(text), 'error must point to vatnode.dev')
  await s.close()
})

test('validate_vat_number with bogus key reaches API and returns error', async () => {
  const s = startServer({ VATNODE_API_KEY: 'vn_invalid_test_xxxxxxxxxxxx' })
  const r = await callTool(s, 'validate_vat_number', { vatId: 'IE6388047V' })
  // We can't assert specific code without network, but call should complete without crashing
  assert.ok(r.result, 'must return a result')
  await s.close()
})

// ---------------------------------------------------------------------------
let passed = 0
let failed = 0
for (const { name, fn } of cases) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL ${name}`)
    console.log(`       ${e.message}`)
    failed++
  }
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
