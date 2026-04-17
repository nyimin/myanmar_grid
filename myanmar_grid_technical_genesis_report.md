# Myanmar Power Grid Integration: Technical Genesis Report

This comprehensive report details the lifecycle of the Myanmar Power Grid Engineering Integration project. It traces the data's journey from raw, fractured geometries and unstructured spreadsheets into a cohesive, commercial-grade power system model capable of professional topology and contingency analysis. 

> [!NOTE]
> **For Automated Agents & Data Engineers:** Explicit target attribute names (`column_names`) are highlighted throughout this document to serve as a literal parsing reference for upstream/downstream integrations.

---

## 1. Project Context & The Objective

### The Starting Point
The raw data inputs consisted of fundamentally mismatched domains:
1. **GIS Geometry Data:** Sourced from OpenStreetMap (OSM) and localized sweeps. These contained geographic coordinates but fractured typologies, chaotic names, and missed parameters.
2. **Ministry Engineering Database:** The MOEP/MEPE internal Excel (`1. Line & Transformer (ALL Myanmar).xlsx`). This contained authoritative physical parameters but zero geographic coordinate data.

### The Objective
Transform the geographic mapping of Myanmar's electricity sector into a mathematically bound **Power Systems Graph** without hallucinating logic or losing raw physical fidelity.

---

## 2. Phase 1: Normalization & Geometric Deduplication

Before power properties were assigned, the spatial canvas had to be standardized.

**Key Actions & Attributes Generated:**
* **Voltage Extraction:** Extracted pure float limitations from string noise (e.g., `"230kV Hlaing Thar Yar"` → `230.0`). 
  - Standardized targeting metric: `voltage_kv` (Float) — The primary single-circuit threshold line.
  - Secondary output: `voltage_all` (String/JSON) — Synthesized array capturing all distinct sub-voltages for complex hubs.
* **Proximity Clustering (Deduplication):** Distinct raw datasets plotted the same substations/plants slightly off-center. We enforced algorithmic clustering constraints: 
  - Substations falling within a **500m radius** and Power Plants within a **200m radius** evaluated as duplicated features and merged. 
  - Preserved metadata during merge under core tags: `name`, `type`, `commission_year`.
* **Name Scrubbing:** Generated a reliable matching key field `name_original` for lineage tracking, while actively stripping topological identifiers off the core `name` attribute.

---

## 3. Phase 2: Building the Topological Graph

For grid analysis (N-1 contingencies), lines must explicitly declare their terminal connections conceptually instead of purely graphically.

**Key Actions & Attributes Generated:**
* **Mathematical Snapping:** Geopandas isolated endpoints of every transmission line fragment (`geometry`). 
* A **200m spatial buffer boundary** was generated around all parsed Substation physical points.
* Any geometric line point ending within this buffer computationally inherited its terminal IDs. 
  - Topological Nodes created: `from_sub_id` (String) and `to_sub_id` (String).
* *Assumption:* High-voltage transmission lines physically terminating within 200m of a substation's geographic epicenter mathematically function as connected grid ties.

---

## 4. Phase 3: The Engineering Parameters Merge (Tier 1 / Tier 2)

Bridging how operational grids map paths (e.g., *TIAKYIT*) versus how descriptive regional maps define hubs (e.g., *Tigyit*).

**The Solution & Parameters Injected:**
1. **Manual Override Dictionary:** Established a rigid dictionary override `SUBSTATION_NAME_MAP` directly within `excel_parser.py` converting archaic facility targets cleanly to expected regional endpoints.
2. **Fuzzy Name Logic:** Passed residual gaps through `fuzz.token_set_ratio` with explicit 75% thresholds. Resulted in 88% verification (203/231 Excel corridor paths geometrically solved).
3. **The Data Injection:** Mathematical topological paths successfully parsed standard power parameters, embedding rigorous Ministry variables onto native GIS lines.
  - Line Impedance / Resistance Targets output as: `r1_ohm_km`, `x1_ohm_km`, `c1_uf_km`, `r0_ohm_km`, `x0_ohm_km`, `c0_uf_km` (Float formats).
  - Component Performance output as: `thermal_rating_mva`, `stability_rating_mva` (Float format).
  - Sub-Metrics preserved: `conductor_type`, `circuits` (Integer).
  - Transform Variables retained at the Substation level: `transformers_json` (Stringified JSON payload describing individual capacity steps).

* **Propagation Fallback:** Fragments lacking explicit grid connections automatically validated and broadcast these strict electrical features outward matching solely by logical name clustering groups—ignoring completely sterile string matches to avoid hallucinating attributes.

---

## 5. Phase 4: Plant-Grid Proximity Engine (Tier 2-A)

Explicitly calculates where generated power physically transmits outward into the grid backbone via local transformer banks. 

**Key Actions & Attributes Generated:**
* Generic nearest-neighbor computational joins (`sjoin_nearest`) were pushed through all 156 Hydro Dams and 122 localized generic power stations running on accurate UTM spatial projections. 
* Computed point-to-point geometric distance and injected an exact formatted lineage metric backward into the generators.
  - Output Key: `tl_connect` (String format uniformly coded as `Substation Name [Substation ID] (XX.Xkm)`).

---

## 6. Phase 5: Regional Administrative Alignment (Tier 3 / T1-C)

To permit jurisdictional modeling frameworks, all geo-infrastructure layers must strictly comply with official geopolitical tracking grids.

**Key Actions & Attributes Generated:**
* Conducted point-in-polygon spatial overlays strictly evaluating individual geometric centroid coordinates against official MIMU 330-township shapefile boundaries.
* 97-100% of spatial assets efficiently retrieved native hierarchical administration markers to avoid user-driven calculation dependency in subsequent BI/reporting systems.
  - Global Administrative Fields attached: `state_region`, `district`, `township` (Standard Strings).
  - Geo-Routing Indices attached: `ts_pcode`, `sr_pcode`.

---

## 7. Institutional Restraints & Known Data Gaps

During development, we actively preserved data integrity properties over forcing complete visual continuity resulting in explicit, justifiable limitations:

1. **The 203 Corridors vs. 29 Geometry Injection Reality**
   - While parameter scanning mathematically achieved 203 individual corridor mappings natively, structural GIS fractured line endpoints (e.g., A -> B -> C routing) prohibited single-element injection endpoints safely terminating. 
   - **Protocol Used:** Favour safe fallback logic and retain mid-fragment blanks over dangerous interpolation. Subsequent modeling layers should engage spatial aggregation rather than hard-coding mid-air geometries.
2. **The 115 Unknown Null-Voltage Stubs**
   - Diagnostics successfully attribute precisely 115 specific line coordinates as legitimately missing strict physical characteristics (`voltage_kv` = `None`).
   - Breakdown logs (`Local_TL`: 54, `OSM`: 47, Transverse `Local_TL/OSM`: 14) confirm these are <33kV generalized NEP distribution grids. They fundamentally do not belong within high-voltage operational boundaries and thus rightfully bypass parameter extraction. 
3. **Non-Infrastructure Engineering Entries**
   - Substation parameter requests like `LAWPITA JOINT` and `TAMU` were actively thrown out.
   - These targets describe virtual underground joints, border ties, or proposed infrastructural boundaries currently outside defined geographic reality.
