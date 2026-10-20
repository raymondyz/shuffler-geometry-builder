import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The generator worker imports HiGHS; pre-bundle it at startup so the dev server doesn't
  // discover it mid-run and reload the page
  optimizeDeps: { include: ['highs'] },
  worker: { format: 'es' },
})
