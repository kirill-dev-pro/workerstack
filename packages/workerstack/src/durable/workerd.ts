// workerstack/durable in the Worker: Cloudflare's DurableObject itself, which
// the runtime requires for RPC and the hibernation handlers. index.ts is the
// stand-in with the same shape for everywhere else.
export { DurableObject } from 'cloudflare:workers'
