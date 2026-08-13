import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    vue(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'src/preload/chat-preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'src/preload/overlay-preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  // 固定监听 IPv4：Windows 下 Electron 解析 localhost 常落到 127.0.0.1，
  // 默认监听 localhost 可能只绑定 [::1]，主窗口 loadURL 会 ERR_EMPTY_RESPONSE 导致白屏
  server: {
    host: '127.0.0.1',
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(dirname, 'index.html'),
        overlay: resolve(dirname, 'overlay.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(dirname, 'src/renderer'),
      '@main': resolve(dirname, 'src/main'),
      '@preload': resolve(dirname, 'src/preload'),
      '@renderer': resolve(dirname, 'src/renderer'),
    },
  },
})
