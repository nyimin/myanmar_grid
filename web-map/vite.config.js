import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['developer.nlr.gov'],
    proxy: {
      '/api/pvwatts': {
        target: 'https://developer.nlr.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pvwatts\/v8\.json$/, '/api/pvwatts/v8'),
        secure: true,
      },
      '/api/nasa': {
        target: 'https://power.larc.nasa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nasa/, '/api'),
        secure: true,
      },
      '/api/openmeteo': {
        target: 'https://api.open-meteo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openmeteo/, ''),
        secure: true,
      },
      '/api/meteo-archive': {
        target: 'https://archive-api.open-meteo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/meteo-archive/, ''),
        secure: true,
      },
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass/, '/api'),
        secure: true,
      },
    },
  },
  preview: {
    allowedHosts: ['grid.triunemyanmar.com'],
  },
})

