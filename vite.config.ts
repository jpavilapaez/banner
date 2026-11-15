import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages sub-paths, Vercel, Netlify, etc.
export default defineConfig({ base: './' });
