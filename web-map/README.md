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
| Distance to nearest substation | 50 pts | < 5 km = full marks; scaled to 0 pts at > 30 km |
| Distance to nearest transmission line | 30 pts | < 2 km = full marks; scaled to 0 pts at > 25 km |
| Voltage class of nearest infrastructure | 20 pts | 33–132 kV = 20 pts; 230 kV = 10 pts; 500 kV = 0 pts |

**Live satellite data** is fetched automatically on each pin drop:

- ☀️ **Solar Yield (PVGIS)** — Annual specific yield in `kWh/kWp/yr` from the EU JRC PVGIS ERA5 dataset (2005–2020 climatology), with Solar Class rating (Excellent / Good / Marginal).
- 🌬️ **Wind Speed (NASA POWER × Power Law)** — Annual mean wind speeds at **50 m**, **100 m**, and **150 m** hub heights. The 50 m reference is pulled from NASA MERRA-2 climatology via the NASA POWER API; 100 m and 150 m are extrapolated using the site-specific **Wind Profile Power Law** with a calculated shear exponent (α).

---

## Data Sources

| Dataset | Source |
|---|---|
| Transmission Lines | MOEP/MEPE + manual digitisation, topologically enriched |
| Substations | MOEP engineering records, spatially joined |
| Power Plants | Global Power Plant Database + MOEP tender records |
| Hydro Dams | MOEP hydro portfolio |
| Admin Boundaries | MIMU Myanmar Admin Level 1 |
| Solar Irradiation | EU JRC PVGIS (ERA5, 2005–2020) |
| Wind Climatology | NASA POWER API (MERRA-2, 2001–2020) |

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
| Solar API | EU JRC PVGIS REST API v5.2 |
| Wind API | NASA POWER Climatology API v2.8 |
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

> **Note:** The dev server runs Vite proxy routes for `/api/pvgis` → PVGIS and `/api/nasa` → NASA POWER. This bypasses browser CORS restrictions without any third-party proxy service.

### Build for Production

```bash
npm run build
# Output is in dist/
```

> For production deployment, configure your reverse proxy (nginx / Caddy) to forward `/api/pvgis/*` to `https://re.jrc.ec.europa.eu/api/v5_2/*` and `/api/nasa/*` to `https://power.larc.nasa.gov/api/*`.

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
├── vite.config.js       # Dev proxy config for PVGIS + NASA POWER
└── package.json
```

---

## Wind Extrapolation Methodology

The 100 m and 150 m hub-height wind speeds are derived using the **Wind Profile Power Law**:

```
v(z) = v_ref × (z / z_ref)^α
```

Where the **shear exponent α** is calculated empirically from NASA MERRA-2 data at two reference heights (10 m and 50 m):

```
α = ln(WS₅₀ / WS₁₀) / ln(50 / 10)
```

This is the same methodology used by the Global Wind Atlas and is accepted by IEC 61400 for preliminary wind resource assessment.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Esc` | Cancel any active tool mode |

---

## API Notes

### PVGIS
- **Endpoint:** `re.jrc.ec.europa.eu/api/v5_2/PVcalc`
- **Parameters:** Fixed-tilt (0°), `peakpower=1 kWp`, standard `loss=14%`
- **Coverage:** Myanmar is fully within the PVGIS-ERA5 dataset
- **Rate limit:** Free, no API key required. Reasonable usage only.

### NASA POWER
- **Endpoint:** `power.larc.nasa.gov/api/temporal/climatology/point`
- **Parameters:** `WS10M`, `WS50M` — 20-year annual mean (2001–2020)
- **Coverage:** Global
- **Rate limit:** Free, no API key required.

---

## Licence

Internal use. Data sourced from public domain / open government sources.
