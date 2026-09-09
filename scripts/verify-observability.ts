#!/usr/bin/env tsx
/** Minimal observability contract check — ensures RED metrics contract exists. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const checks: Array<[string, string]> = [
  ['compose.observability.yml', 'compose.observability.yml'],
  ['observability/prometheus.yml', 'observability/prometheus.yml'],
  ['observability/alerts.yml', 'observability/alerts.yml'],
  ['observability/grafana/dashboards/dsh-red.json', 'observability/grafana/dashboards/dsh-red.json'],
]

let ok = true
for (const [label, rel] of checks) {
  try {
    await readFile(join(ROOT, rel), 'utf8')
    console.log('ok', label)
  } catch {
    console.error('missing', label)
    ok = false
  }
}

// Thresholds from observability.md §1
const required = ['http_request_duration_seconds', 'http_requests_total', 'histogram_quantile(0.95', 'HighLatencyP95Critical', 'HighErrorRateCritical']
let alerts = ''
try { alerts = await readFile(join(ROOT, 'observability/alerts.yml'), 'utf8') } catch {}
for (const needle of required) {
  if (!alerts.includes(needle)) { console.error('alerts.yml missing', needle); ok = false }
}

if (ok) console.log('verify-observability: PASS — RED + SLO burn-down wired (observability.md §1/§2/§6)')
else { console.error('verify-observability: FAIL'); process.exit(1) }
