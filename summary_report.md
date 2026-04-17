# Myanmar Grid GIS Processing Report

## Attribute Improvements Applied
1. **Voltage standardised** → integer `voltage_kv` (highest level) + `voltage_all` list  
2. **Names cleaned** → voltage prefixes stripped from substation names; `name_original` preserved for audit trail  
3. **Placeholder names flagged** → power-plant names wrapped in `[ ]` tagged `name_quality: placeholder`  
4. **Auto-generated IDs** → null IDs replaced with `GEN_<md5[:8]>` hash  
5. **Schema enriched** per layer: `commission_year`, `capacity_mva`, `status`, `transformer_count` (substations); `fuel_type`, `generation_type`, `operational_status` (plants/hydro); `circuits`, `length_km`, `conductor_type` (lines)  
6. **Floating-point cleanup** → capacity rounded to 2 dp  
7. **Line topology** → endpoints snapped to nearest substation within 200 m before deduplication  
8. **Line deduplication** → endpoint proximity + intersection ratio (no parallel-circuit false-merges)  

## Statistics

| Entity | Raw Features | Final Unique | Removed |
|--------|-------------|-------------|---------|
| Transmission Lines | 3421 | 3383 | 38 |
| Substations | 811 | 730 | 81 |
| Power Plants | 156 | 135 | 21 |
| Hydrodams | — | 34 | — |

*All outputs in EPSG:4326 (WGS84). Spatial processing done in EPSG:32647 (UTM Zone 47N).*
