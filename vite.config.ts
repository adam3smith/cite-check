import { defineConfig } from 'vite'

export default defineConfig({
  base: '/cite-check/',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('@citation-js')) return 'citation-js'
        },
      },
    },
  },
})
