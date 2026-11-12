import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:5000', '/uploads': 'http://localhost:5000' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-redux': ['react-redux', '@reduxjs/toolkit'],
          'vendor-antd': ['antd'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
  esbuild: { drop: ['debugger'] },
})
