import { defineConfig } from 'vite'
import { workerstack } from 'workerstack/vite'

export default defineConfig({ plugins: [workerstack()] })
