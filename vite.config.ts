import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset URLs by default, so one build works unchanged at a domain
// root, under /<repo>/ on GitHub Pages, behind a custom domain, or opened
// straight off disk. BASE_PATH can still pin an absolute base if a host needs one.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
});
