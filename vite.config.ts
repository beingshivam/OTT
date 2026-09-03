import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is overridable so the same build works on a custom domain,
// on GitHub Pages under /<repo>/, or on Vercel/Netlify at the root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
});
