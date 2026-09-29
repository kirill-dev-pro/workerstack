import viteReact from '@vitejs/plugin-react'
import { workerstack } from 'workerstack/vite'
import { defineConfig } from 'vite'

// SSR by default: workerstack() adds TanStack Start and the Cloudflare plugin.
export default defineConfig({ plugins: [workerstack(), viteReact()] })
