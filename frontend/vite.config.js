import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 15_000,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
    pool: 'forks',
    // Shared runners report more CPUs than their memory budget can support.
    // Bound isolated jsdom workers so coverage cannot exhaust the runner.
    maxWorkers: 2,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/main.jsx'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
})
