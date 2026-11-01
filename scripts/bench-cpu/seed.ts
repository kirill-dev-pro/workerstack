// Synthetic seed data for the local CPU benchmark (no production data).
const url = process.argv[2] ?? 'http://127.0.0.1:18080'
const cities = ['lisbon', 'porto', 'faro', 'madrid', 'malaga', 'new-york']
const countries = [
  'Portugal',
  'Portugal',
  'Portugal',
  'Spain',
  'Spain',
  'United States',
]
const stmts: { sql: string; args: { type: string; value: string }[] }[] = []
const now = Date.now()
for (let i = 0; i < 300; i++) {
  const c = i % cities.length
  const vals = [
    `agt_${i}`,
    `bench-agent-${i}-${cities[c]}`,
    `First${i}`,
    `Last${i}`,
    'Realtor',
    `Bench Realty ${i % 20}`,
    countries[c]!,
    cities[c]!,
    `About agent ${i}. `.repeat(20),
    String(now - i * 1000),
    String(now),
  ]
  stmts.push({
    sql: `insert or ignore into agents (id, slug, first_name, last_name, title, company_name, country, city, about_text, is_public, is_indexed_eligible, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,1,1,?,?)`,
    args: vals.map((value) => ({ type: 'text', value })),
  })
}
const body = { requests: stmts.map((stmt) => ({ type: 'execute', stmt })) }
const res = await fetch(`${url}/v2/pipeline`, {
  method: 'POST',
  body: JSON.stringify(body),
})
const json: any = await res.json()
const errors = json.results.filter((r: any) => r.type !== 'ok')
console.log(
  'seeded',
  stmts.length - errors.length,
  'errors',
  errors.length,
  errors[0]?.error?.message ?? '',
)
