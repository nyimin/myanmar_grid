import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor';
          if (id.includes('maplibre-gl') || id.includes('react-map-gl')) return 'map-core';
          if (id.includes('@deck.gl')) return 'deck';
          if (id.includes('pocketbase')) return 'workspace';
          return undefined;
        },
      },
    },
  },
  preview: {
    allowedHosts: ['grid.triunemyanmar.com'],
  },
})
