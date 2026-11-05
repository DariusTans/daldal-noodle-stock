import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  // main chunk = react + router + query + domain rules (~150 KB gzip); backends are lazy chunks
  build: { chunkSizeWarningLimit: 600 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
