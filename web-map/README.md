# Myanmar Power Grid Web Map

A high-fidelity, mobile-first GIS application for visualizing and managing Myanmar's power infrastructure. Built with **React**, **MapLibre GL**, and **Deck.gl**, this platform provides a unified interface for grid data analysis, infrastructure inspection, and personal geospatial workspaces.

![Project Status](https://img.shields.io/badge/status-active-success)
![Tech Stack](https://img.shields.io/badge/stack-React%20%7C%20MapLibre%20%7C%20Deck.gl-blue)
![PWA](https://img.shields.io/badge/PWA-ready-orange)

## ⚡ Core Features

### 🗺️ Infrastructure Visualization
- **Multi-Source Integration**: Standardized GeoJSON datasets merged from OSM and authoritative user-provided sources.
- **Dynamic Layer Control**: Toggle and filter transmission lines (230kV, 132kV, 66kV), substations, and generation assets (Solar, Gas, Coal, Wind).
- **Progressive Data Loading**: Optimized startup sequence with deferred loading for heavy datasets like admin boundaries and hydro dams.

### 🛠️ Advanced GIS Tools
- **Proximity Scanning**: Analyze infrastructure density and distances within a specified radius.
- **Distance Measurement**: High-precision line-of-sight measurement tools.
- **Asset Inspection**: Detailed property panels for every grid element, including voltage, capacity, and source metadata.

### 📁 User Workspace
- **PocketBase Integration**: Secure, authenticated workspace for syncing data across devices.
- **KML/KMZ Import**: High-performance KML parsing using Web Workers and normalization to WGS84.
- **Offline First**: IndexedDB caching ensures the map and user data remain accessible even with intermittent connectivity.
- **Custom Points**: Save and label specific grid locations or potential project sites.

### 📱 Mobile-First Experience
- **PWA Support**: Installable on iOS and Android with offline shell fallbacks.
- **Responsive UI**: Intuitive drawers, bottom sheets, and touch-optimized map interactions.

## 🛠️ Tech Stack

- **Frontend**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Mapping**: [MapLibre GL JS](https://maplibre.org/)
- **Data Layers**: [Deck.gl](https://deck.gl/) (Geo-layers)
- **Backend/Auth**: [PocketBase](https://pocketbase.io/)
- **Spatial Logic**: [Turf.js](https://turfjs.org/)
- **UI Icons**: [Lucide React](https://lucide.dev/)

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- PocketBase instance (optional, for workspace sync)

### Installation
```bash
# Clone the repository
cd web-map

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local

# Run development server
npm run dev
```

### Build & Production
```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## 📂 Project Structure

- `src/features/map`: MapLibre integration and Deck.gl layer configurations.
- `src/features/workspace`: KML import workers and PocketBase synchronization logic.
- `src/features/panels`: Bottom sheets and sidebars for asset details.
- `src/hooks`: Custom hooks for spatial queries and workspace state.
- `public/data`: Static GeoJSON assets for grid infrastructure.

## 📄 License & Attribution

Data derived from OpenStreetMap, MIMU, and proprietary grid surveys. Please refer to `AGENTS.md` for data harmonization methodologies.
