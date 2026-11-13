import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The .ehpk is loaded from a local folder by the Even App, so asset paths must be relative.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
