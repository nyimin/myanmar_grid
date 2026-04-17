# Conceptual Analysis Tool — Feature Specification

## Overview

The **Conceptual Analysis Tool** (redesigned from the original Viability Scorer) is a robust, two-stage evaluation engine for utility-scale renewable energy projects in Myanmar. It allows users to assess site suitability for Solar PV or Onshore Wind based on proximity to authoritative infrastructure data, local terrain, and meteorological resource quality.

Unlike the previous tool, this is a **state-machine driven experience** that separates site selection from project configuration and analysis execution to deliver bankable-grade insights.

---

## Tool Workflow (State Machine)

The tool operates in four distinct phases:

1.  **IDLE**: 
    - The tool is activated from the sidebar. 
    - The map cursor changes to a crosshair.
    - Analysis panel shows a hint to "Place a pin on the map."
2.  **CONFIGURING**:
    - Triggered by clicking a location on the map.
    - A marker is dropped at the coordinates.
    - The user selects **Technology** (Solar/Wind) and **Capacity** (10-300 MW).
    - Solar-specific options (Fixed/Tracking) appear if solar is selected.
    - Grid voltage requirements are previewed based on the chosen capacity.
3.  **ANALYZING**:
    - Triggered by clicking "Run Analysis".
    - The system executes a sequence of high-performance spatial queries using **Turf.js** against local GeoJSON datasets.
    - Concurrent API calls fetch meteorological data (solar/wind) and 3x3 grid elevation data.
    - Loading stages are displayed to the user.
4.  **RESULTS**:
    - Analysis completes and transitions to a comprehensive dashboard.
    - If the user clicks a new location while in `RESULTS`, it returns to `CONFIGURING` for the new location.

---

## Scoring Methodology (100 Points)

The suitability of a site is calculated using a composite score across three modules:

### 1. Grid Integration — Max 40 pts
Evaluates the physical and technical difficulty of connecting to the national grid.

| Component | Weight | Logic |
| :--- | :--- | :--- |
| **Substation Distance** | 20 pts | 20 pts for <5km, decaying to 0 pts at 30km. |
| **Line Distance** | 10 pts | 10 pts for <2km, decaying to 0 pts at 25km. |
| **Voltage Match** | 10 pts | Checks substation voltage against capacity requirements: <br> • <30MW: ≥66kV <br> • 30-100MW: ≥132kV <br> • >100MW: ≥230kV <br> **Penalty**: -5 pts if voltage is below threshold. |

### 2. Resource Quality — Max 30 pts
Evaluates the fuel source availability (solar yield or wind speed).

- **Solar PV**: Based on PVWatts V8 specific yield (kWh/kWp/yr).
  - High (30 pts) if ≥1700, Standard (20 pts) if ≥1500, Low if <1300.
- **Onshore Wind**: Based on ERA5 mean wind speed at 100m hub height (m/s).
  - High (30 pts) if ≥8.0 m/s, Standard (20 pts) if ≥6.5 m/s, Low if <5.0 m/s.

### 3. Site Feasibility — Max 30 pts
Evaluates civil engineering constraints.

- **Slope (20 pts)**: Max slope measured across a 3x3 grid (~110m resolution).
  - Solar: 20 pts if ≤5%, decay to 0 at 12%.
  - Wind: 20 pts if ≤10%, decay to 0 at 20%.
- **Road Access (10 pts)**: Proximity to MIMU authoritative road dataset (Main/Secondary only).
  - 10 pts for <2km, decay to 3 pts at >10km.

---

## Data Fetch Pipeline

### Local Spatial Queries (@turf/turf)
The tool relies on local GeoJSON files loaded into the browser memory for instant proximity analysis:
- **Transmission Lines**: `myanmar_transmission_lines_final.geojson`
- **Substations**: `myanmar_substations_final.geojson`
- **Road Network**: `myanmar_roads_final.geojson` (MIMU authoritative data)

### External APIs
- **PVWatts V8 (NLV)**: Solar specific yield and monthly AC profiles.
- **Open-Meteo Archive (ERA5)**: 12-month mean wind speed at 100m.
- **Open-Meteo Elevation**: 3x3 grid elevation (9 points) for directional slope analysis.

---

## UI Components

### ⚙️ Config Panel (Stage 1)
- **Technology Buttons**: Exclusive selection with active highlights.
- **Capacity Slider**: Dynamic MW range with visual feedback.
- **Status Badges**: Real-time required voltage indicator.

### 📈 Analysis Dashboard (Stage 2)
- **Overall Grade**: Large colored ring (🟢 High, 🟡 Moderate, 🟠 Low, 🔴 Not Viable).
- **Module Cards**: 3 cards showing score, max points, and confidence (Green/Yellow).
- **Flag System**: Summary of specific risks (e.g., "Slope 22% — exceeds earthworks threshold").
- **Key Metrics Grid**: Tabular view of physical numbers (GWh/yr, ha land, max slope %).
- **Monthly Generation Chart**: Dual-input bar chart for seasonal profiles.

---

## Computed Formulas

### Solar Yield
```javascript
solarGWhYr  = (capMW * 1000 * solarYield) / 1e6
solarLandHa = capMW * 1.5
```

### Wind Production
```javascript
cf = windCF(ws100) // Generic Class II/III power curve proxy
windGWhYr = capMW * 8760 * cf * 0.85 / 1000
```

### Slope Analysis (3x3 Grid)
Maximum gradient calculated from 8 directional comparisons (N, S, E, W, NE, NW, SE, SW) using diagonal spacing correction (`spacing * √2`).

---

## Implementation Details

- **File**: `src/App.jsx` (Controls state, fetches data, and renders Dashboard)
- **CSS**: `src/index.css` (Contains all `.config-*` and `.dash-*` classes)
- **State Key**: `analysisPhase`, `viabilityPoint`, `viabilityConfig`
- **Known Issues Resolved**: Monthly bar charts now use local state and version keys to force remount, resolving the zero-height render bug.