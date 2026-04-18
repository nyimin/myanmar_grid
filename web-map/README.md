# Myanmar Power Grid — Interactive Infrastructure Map

A professional-grade, GPU-accelerated web GIS application for exploring and analysing Myanmar's national power infrastructure. Built for power engineers, project developers, and renewable energy investors who need fast, data-rich spatial insights directly in the browser.

---

## Screenshot

> *Interactive infrastructure map with dark-mode basemap, fuel-specific plant icons, and the Site Viability Scorer panel.*

---

## Features

### 🗺️ Map & Visualisation
| Feature | Description |
|---|---|
| **Transmission Lines** | Colour-coded by voltage (500 kV pink → 33 kV grey), width-scaled by kV class |
| **Substations** | Voltage-coloured triangle icons, click for full attribute detail |
| **Power Plants** | Fuel-specific circular icons — Hydro 💧, Solar ☀️, Gas 🔥, Coal ⚫, Wind 🌬️ |
| **Hydro Dams** | Separate hydro dam layer with capacity-scaled icons |
| **Admin Boundaries** | Optional State/Region polygon overlay (MIMU) |
| **Dark / Light Basemap** | Toggle between Carto Positron and Carto Dark Matter with one click |

### 🔎 Filtering & Search
| Feature | Description |
|---|---|
| **Jurisdiction Filter** | Filter all layers to a specific State or Region |
| **Voltage Filter** | Multi-select chips to show/hide specific kV classes (500 / 230 / 132 / 66 / 33 kV) |
| **Fuel Filter** | Filter power plants by fuel type |
| **Status Filter** | Operational / Planned / Under Construction |
| **Asset Search** | Free-text search across all assets with fly-to result selection |

### 🛠️ Analysis Tools

#### 📐 Measure Distance
Click-to-click geodesic distance measurement. Supports multi-segment routes with live preview as the cursor moves. Shows per-segment distances and a running total.

#### 🟣 Proximity Catchment
Drop a centre point and sweep a 2–100 km radius slider. The tool instantly lists every substation, power plant, and hydro dam within the circle, sorted by distance.

#### 🔗 Connectivity Trace
Click any substation to trace its topological connections through the grid. Connected lines are highlighted in gold and all directly-linked substations are flagged.

#### 📍 Site Viability Scorer
The flagship origination tool. Drop a pin anywhere on the map to get an instant **0–100 commercial feasibility score** for a new Solar or Wind project, composed of:

| Component | Weight | Logic |
|---|---|---|
| Distance to nearest substation | 50 pts | Uses terrain-adjusted indicative route distance, with preferred substation candidate ranking by voltage fit and distance |
| Distance to nearest transmission line | 30 pts | Uses terrain-adjusted indicative route distance, with fallback if no eligible high-voltage asset exists |
| Voltage class of nearest infrastructure | 20 pts | Capacity-based voltage screening with penalties for fallback to lower-voltage assets |

**Live screening data** is fetched automatically on each pin drop:

- ☀️ **Solar Yield (PVWatts V8)** — Annual specific yield in `kWh/kWp/yr`, normalized to `1 kW`, with latitude-based tilt defaults and conservative regional losses for indicative Year-1 output.
- 🌬️ **Wind Yield (Open-Meteo ERA5 × Generic Turbine Proxy)** — Recent-period hourly wind speeds at **10 m** and **100 m**, extrapolated to hub height, air-density corrected using temperature and elevation, then blended with trailing baseline windows before mapping to a generic power curve.
- ⛰️ **Terrain Screen (Open-Meteo Elevation)** — A `5x5` elevation sample is used to estimate max slope, slope variability, elevation range, and usable terrain share.
- 🧭 **Degraded-Data Awareness** — The dashboard now shows whether solar, wind, terrain, and road inputs are fully available, partial, or unavailable.

---

## Data Sources

| Dataset | Source |
|---|---|
| Transmission Lines | MOEP/MEPE + manual digitisation, topologically enriched |
| Substations | MOEP engineering records, spatially joined |
| Power Plants | Global Power Plant Database + MOEP tender records |
| Hydro Dams | MOEP hydro portfolio |
| Admin Boundaries | MIMU Myanmar Admin Level 1 |
| Solar Irradiation | NREL PVWatts V8 |
| Wind / Temperature | Open-Meteo ERA5 archive |
| Terrain Elevation | Open-Meteo elevation API |

All GeoJSON datasets are stored in `public/data/`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite 8 |
| Map Engine | MapLibre GL JS via `react-map-gl` |
| GPU Rendering | Deck.gl 9 (`GeoJsonLayer`, `ScatterplotLayer`) |
| Basemaps | Carto Positron / Dark Matter (free, no token required) |
| Icons | Lucide React |
| Solar API | NREL PVWatts V8 |
| Wind / Terrain API | Open-Meteo Archive + Elevation |
| Styling | Vanilla CSS (glassmorphism design system) |

---

## Getting Started

### Prerequisites
- Node.js ≥ 18 (tested on v22)
- npm ≥ 9

### Install & Run

```bash
# Clone / navigate to the project
cd web-map

# Install dependencies
npm install

# Start the development server (includes API proxies)
npm run dev
```

Open **http://localhost:5173** in your browser.

> **Note:** The dev server runs Vite proxy routes for the upstream energy and weather APIs so the browser can call them without CORS issues.

### Build for Production

```bash
npm run build
# Output is in dist/
```

> For production deployment, configure your reverse proxy (nginx / Caddy) to forward the local `/api/*` routes to the upstream PVWatts and Open-Meteo endpoints used by the app.

---

## Project Structure

```
web-map/
├── public/
│   └── data/
│       ├── myanmar_transmission_lines_final.geojson
│       ├── myanmar_substations_final.geojson
│       ├── myanmar_powerplants_final.geojson
│       ├── myanmar_hydrodams_final.geojson
│       └── myanmar_admin1_boundaries.geojson
├── src/
│   ├── App.jsx          # Main application, all layers & tool logic
│   └── index.css        # Glassmorphism design system
├── vite.config.js       # Dev proxy config for PVWatts + Open-Meteo
└── package.json
```

---

## Wind Screening Methodology

Hub-height wind speeds are derived using the **Wind Profile Power Law**:

```
v(z) = v_ref × (z / z_ref)^α
```

Where the **shear exponent α** is calculated empirically from ERA5 data at two reference heights (10 m and 100 m):

```
α = ln(WS₁₀₀ / WS₁₀) / ln(100 / 10)
```

Those hub-height speeds are then density-corrected using temperature and elevation, mapped to a generic turbine power curve, and reduced by a fixed net loss factor to produce an indicative capacity factor. The recent-year result is then blended with trailing yearly baseline windows when available so a single anomalous year does not dominate the screening output. If upstream data is incomplete, the UI now exposes that degraded state instead of silently implying full coverage.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Esc` | Cancel any active tool mode |

---

## API Notes

### PVWatts
- **Endpoint:** `developer.nrel.gov/api/pvwatts/v8.json`
- **Parameters:** `system_capacity=1 kW`, latitude-based default tilt, `azimuth=180`, conservative regional loss defaults
- **Coverage:** Global
- **Rate limit:** API key required

### Open-Meteo Archive
- **Endpoint:** `archive-api.open-meteo.com/v1/archive`
- **Parameters:** hourly `wind_speed_10m`, `wind_speed_100m`, `wind_direction_100m`, `temperature_2m`
- **Coverage:** Global
- **Rate limit:** Free, no API key required.

---

## Licence

Internal use. Data sourced from public domain / open government sources.
