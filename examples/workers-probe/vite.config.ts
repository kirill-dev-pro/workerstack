import { workerstack } from 'workerstack/vite'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [workerstack()] })
