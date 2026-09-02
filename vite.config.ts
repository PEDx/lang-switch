import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  if (mode === 'content') {
    return {
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/content/index.ts'),
          formats: ['iife'],
          name: 'AiReaderContent',
          fileName: () => 'content.js',
        },
        minify: false,
      },
    }
  }

  if (mode === 'background') {
    return {
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/background/service-worker.ts'),
          formats: ['es'],
          fileName: () => 'service-worker.js',
        },
        minify: false,
      },
    }
  }

  return {
    plugins: [react()],
    build: {
      emptyOutDir: mode !== 'ui-watch',
      rollupOptions: {
        input: {
          sidepanel: resolve(__dirname, 'sidepanel.html'),
          options: resolve(__dirname, 'options.html'),
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      exclude: ['src/**/*.integration.test.ts'],
    },
  }
})
