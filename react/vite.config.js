import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

// The React app consumes the exact same /core and /client modules as the vanilla app.
export default defineConfig({
  base: '/react/',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': root('../core'),
      '@client': root('../client'),
      '@styles': root('../vanilla/styles'),
    },
  },
  define: {
    __KF_CONFIG__: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
      apiBase: process.env.KF_API_BASE ? process.env.KF_API_BASE.replace(/\/$/, '') : process.env.KF_SAME_ORIGIN_API ? '' : null,
      ...(process.env.NODE_ENV === 'production' || process.argv.includes('build') ? { localApi: false } : {}),
    }),
  },
  server: {
    fs: { allow: [root('..')] },
    port: Number(process.env.KF_REACT_PORT || 5173),
    proxy: { '/api': process.env.KF_API_PROXY || 'http://localhost:8080' },
  },
  worker: { format: 'es' },
  build: {
    outDir: root('../dist/react'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
