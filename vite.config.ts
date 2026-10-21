/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The generator worker imports HiGHS; pre-bundle it at startup so the dev server doesn't
  // discover it mid-run and reload the page
  optimizeDeps: { include: ['highs'] },
  worker: { format: 'es' },
  // The brute-force checks and the generator search take a few seconds on CI runners, which are
  // several times slower than a laptop. The timeout only guards against hangs.
  test: { testTimeout: 30_000 },
})
