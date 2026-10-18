import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      //    `.X.tsx.<pid>.<uuid>.tmpdir/` 是原子写入留下的临时目录，watcher 会在
      //    Windows 上因 EBUSY 直接崩掉，因此一并忽略
      ignored: ['**/src-tauri/**', '**/*.tmpdir/**', '**/*.tmp'],
    },
    proxy: {
      '/proxy-login': {
        target: 'https://login-user.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-login/, ''),
        headers: {
          Referer: 'https://www.kugou.com/',
          Origin: 'https://www.kugou.com',
        },
      },
      '/proxy-gateway': {
        target: 'https://gateway.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-gateway/, ''),
        headers: {
          Referer: 'https://www.kugou.com/',
          Origin: 'https://www.kugou.com',
        },
      },
      '/proxy-search': {
        target: 'http://songsearch.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-search/, ''),
        headers: {
          Referer: 'https://www.kugou.com/',
        },
      },
      '/proxy-trackercdn': {
        target: 'https://trackercdn.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-trackercdn/, ''),
      },
      '/proxy-krcs': {
        target: 'http://krcs.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-krcs/, ''),
      },
      '/proxy-t1': {
        target: 'https://t1.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-t1/, ''),
      },
      '/proxy-m': {
        target: 'https://m.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-m/, ''),
      },
      '/proxy-www': {
        target: 'https://www.kugou.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-www/, ''),
      },
    },
  },
}));
