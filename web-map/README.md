# Myanmar Power Grid Web Map

Mobile-first React + Vite map for exploring Myanmar power infrastructure with staged GeoJSON loading, PWA support, and authenticated user workspaces for KML uploads and saved locations.

## What Changed
- Removed the legacy `Conceptual Analysis` / viability workflow and all meteo-scoring dependencies.
- Replaced the monolithic app with feature modules for the map, panels, sidebar, static data loading, and user workspace management.
- Added progressive data loading:
  - startup: transmission lines, substations, power plants
  - deferred: hydro dams, admin boundaries
  - removed from startup: roads dataset
- Added PocketBase-backed workspace flows with local IndexedDB caching and KML import in a Web Worker.
- Added PWA assets:
  - `public/manifest.json`
  - `public/sw.js`
  - offline shell fallback
- Reworked the UI for mobile drawers, bottom sheets, and larger touch targets.

## Core Features
- Search, filter, inspect, and toggle grid infrastructure layers
- Measure distance
- Proximity scan
- Upload KML files into a user workspace
- Save selected map points or asset locations
- Rename and toggle workspace datasets
- Install as a PWA

## Dev
```bash
cd web-map
npm install
npm run dev
```

## Build
```bash
npm run build
npm run lint
```

## Data Notes
- Static infrastructure GeoJSON is served from `public/data/`
- User workspace data is cached locally in IndexedDB and synced to PocketBase when available
- KML imports are normalized to WGS84 GeoJSON before storage/rendering
