// Local stand-in for the Bunderhost telemetry endpoint: counts batches, returns 204.
let batches = 0
Bun.serve({
  port: Number(process.argv[2] ?? 18081),
  async fetch(req) {
    await req.text()
    batches++
    if (batches % 50 === 0) console.log('batches', batches)
    return new Response(null, { status: 204 })
  },
})
