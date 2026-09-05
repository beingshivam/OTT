import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Absolute asset URLs. This used to default to './' so one build worked at a
// domain root, under /<repo>/ on GitHub Pages, or straight off disk — and that
// held for exactly as long as the site was a single page.
//
// It stopped the moment there were nested ones. A relative base makes every
// asset URL relative to the page requesting it, so /theatres asked for
// /theatres/assets/index-*.js and /w/2026-09-04 asked for one directory deeper
// again. Both 404. The page then rendered the SEO fallback — unstyled serif
// text on white — to real visitors, because the stylesheet and the bundle that
// would have replaced it never arrived.
//
// BASE_PATH still pins a different base for a subpath host; it just cannot be
// relative any more.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
});
