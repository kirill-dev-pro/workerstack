import solid from '@solidjs/vite-plugin'
import { workerstack } from 'workerstack/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // The app runs as a Worker in dev and in the build; see workerstack().
  plugins: [workerstack(), solid()],
})
