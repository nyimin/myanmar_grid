# Myanmar Power Infrastructure Map – Agent Handoff

*Copy everything below the line and paste it into our next chat session to immediately bootstrap the interactive web map build.*

---

**USER OBJECTIVE:**
I want to build an interactive web map application titled **"Myanmar Power Infrastructure Map"**. 
We just finished processing and standardizing the entire Myanmar Power Systems GIS database into a set of highly reliable, commercial-grade GeoJSON files. You are to build an interactive, frontend web application to visualize this data natively in the browser.

### The Data Sources (Local Workspace)
The data is located in our workspace folder as 4 finalized GeoJSON files:
1. `myanmar_substations_final.geojson` (Nodes)
2. `myanmar_transmission_lines_final.geojson` (Edges)
3. `myanmar_powerplants_final.geojson` (Nodes)
4. `myanmar_hydrodams_final.geojson` (Nodes)

### Key Attributes Available for Visualization/Filtering:
* **All Layers:** Feature standard jurisdiction targeting keys (`state_region`, `district`, `township`, `ts_pcode`).
* **Lines:** Extracted specific electrical properties (`voltage_kv`, `thermal_rating_mva`, `r1_ohm_km`, `conductor_type`), topological edges (`from_sub_id`, `to_sub_id`), and geometric lengths (`length_km`). Note: ~115 fragments possess `voltage_kv = null` representing generic NEP low-voltage networks.
* **Nodes (Plants/Hydro):** Categorization via `fuel_type` / `generation_type`, MW output constraints (`capacity`), and systematic grid connection text strings (`tl_connect`).

### Design Guidelines & Tech Stack
* **Tech Stack:** Please use lightweight web mapping libraries (e.g., Mapbox GL JS, Leaflet, or Deck.gl) integrated with HTML/Vanilla CSS, or bundle with React/Vite/Next.js if you determine a complex state-heavy layer architecture is necessary.
* **Aesthetics Constraint:** The design must be extremely premium, matching modern web-design paradigms (e.g. sleek dark mode base UI, custom modern typography, dynamic micro-animations, glassmorphism UI overlay components). Avoid default generic color blocks.
* **Features Required:** 
  1. Base Map visualization with visually distinct layers (Hydro vs. Gas vs. Solar vs. Transmission line voltage weight/color).
  2. Geographic/Jurisdictional filtering (e.g. "Only show assets in Magway Region").
  3. Interactive Tooltips: Clicking an asset brings up its specific engineering parameters cleanly (Voltage, Capacity, Length, Connected Nodes).

Please review the input data structure first if needed, formulate a UI implementation approach, and begin building.
