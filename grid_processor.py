"""
grid_processor.py
Myanmar Power Grid GIS Consolidation Pipeline
"""

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional, Tuple, List

import geopandas as gpd
import pandas as pd
import requests
from rapidfuzz import fuzz
from shapely.geometry import LineString, Point
from shapely.ops import snap
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ─── CRS ──────────────────────────────────────────────────────────────────────
EPSG_WGS84 = 4326
EPSG_UTM   = 32647   # UTM Zone 47N

# ─── I/O ──────────────────────────────────────────────────────────────────────
INPUT_DIR   = Path('input')
RAW_OSM_DIR = INPUT_DIR / 'osm_raw'
RAW_OSM_DIR.mkdir(exist_ok=True, parents=True)

MYANMAR_BBOXES = [
    (9.6,  96.0, 16.0, 99.5),
    (16.0, 92.5, 20.0, 98.0),
    (20.0, 92.0, 28.5, 101.5),
]

# ─── Mappings ─────────────────────────────────────────────────────────────────
MM_STATUS_MAP = {
    'လက်ရှိ':            'operational',
    'လျာထားချက်':        'planned',
    'ရေအားလျှပ်စစ်':     'operational',
    'မြို့/ကျေးရွာ':     'operational',
    'သဘာဝဓာတ်ငွေ့သုံး': 'operational',
    'Gas Turbine':       'operational',
    'Solar Power Station': 'operational',
    'defunct':           'decommissioned',
    'active':            'operational',
    'under construction': 'planned',
}

HYDRO_STATUS_MAP = {
    'Built':       'operational',
    'Construction':'planned',
    'LocMoU':      'planned',
    'MOU':         'planned',
    'MOA':         'planned',
    'JVA':         'planned',
    'Covenant':    'planned',
    'GOM Plan':    'planned',
    'Identified':  'identified',
    'Suspended':   'suspended',
}

WIND_PV_STATUS_MAP = {
    'Operation':   'operational',
    'Opeation':    'operational',
    'Planned':     'planned',
    'Plan':        'planned',
    'PLan':        'planned',
    'MOA':         'planned',
    'MOU':         'planned',
    'preMOU':      'planned',
    'Unclear':     'unknown',
}

AGREEMENT_STAGE_MAP = {
    'MOU': 'MOU',
    'MOA': 'MOA',
    'JVA': 'JVA',
    'preMOU': 'preMOU',
    'Unclear': None
}

FUEL_KEYWORDS = [
    ('hydro',       ['hydro', 'dam', 'weir', 'reservoir', 'intake', 'ywama', 'yeywa', 'baluchaung', 'shweli', 'paunglaung']),
    ('gas',         ['gas turbine', 'gas', 'combined cycle', 'ccgt', 'ocgt', 'natural gas', 'lng']),
    ('coal',        ['coal', 'lignite']),
    ('diesel',      ['diesel', 'hfo']),
    ('solar',       ['solar', 'pv']),
    ('biomass',     ['biomass', 'waste2energy', 'waste to energy']),
    ('steam',       ['steam', 'thermal']),
    ('microhydro',  ['micro hydro', 'microhydro', 'mini hydro']),
]

GENERATION_TYPE_MAP = {
    'hydro':      'reservoir',
    'microhydro': 'run-of-river',
    'gas':        'OCGT',
    'coal':       'steam-turbine',
    'diesel':     'diesel-genset',
    'solar':      'solar-pv',
    'biomass':    'biomass',
    'steam':      'steam-turbine',
}

# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_single_voltage(raw: str) -> Optional[int]:
    s = raw.strip().replace(' ', '').upper()
    s = re.sub(r'KV$', '', s)
    s = re.sub(r'V$',  '', s)
    try:
        val = float(s)
    except ValueError:
        return None
    if val >= 1000:
        val = val / 1000.0
    return int(round(val))

def parse_voltage(raw) -> Tuple[Optional[int], List[int]]:
    if pd.isna(raw) or str(raw).strip() == '':
        return None, []
    raw = str(raw)
    tokens = re.split(r'[/,]', raw)
    levels = []
    for tok in tokens:
        kv = _parse_single_voltage(tok)
        if kv is not None and kv > 0:
            levels.append(kv)
    if not levels:
        return None, []
    return max(levels), sorted(set(levels), reverse=True)

_SUB_VOLTAGE_PREFIX = re.compile(
    r'^(\d{1,3} ?kV\s+|\d{1,3}kV\s+|230kV\s+|132kV\s+|66kV\s+|33kV\s+|11kV\s+)',
    re.IGNORECASE
)

def clean_substation_name(raw: str) -> Tuple[str, str]:
    original = str(raw).strip()
    cleaned  = _SUB_VOLTAGE_PREFIX.sub('', original).strip()
    return cleaned, original

def name_quality_flag(name: str) -> str:
    n = str(name).strip()
    if n.startswith('[') and n.endswith(']'):
        return 'placeholder'
    return 'ok'

def clean_name(name: str) -> str:
    if pd.isna(name):
        return 'Unknown'
    return re.sub(r' {2,}', ' ', str(name).strip())

def make_id(geom) -> str:
    return 'GEN_' + hashlib.md5(geom.wkt.encode()).hexdigest()[:8]

def fill_ids(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    mask = gdf['id'].isna() | (gdf['id'].astype(str).str.strip() == '')
    gdf.loc[mask, 'id'] = gdf.loc[mask, 'geometry'].apply(make_id)
    dupes = gdf['id'].duplicated(keep=False)
    if dupes.any():
        logger.warning(f"Duplicate IDs detected ({dupes.sum()} rows) – appending index suffix.")
        for i, idx in enumerate(gdf[dupes].index):
            gdf.at[idx, 'id'] = gdf.at[idx, 'id'] + f'_{i}'
    return gdf

def infer_fuel_type(name: str, tyGenerat: str = '') -> str:
    combined = (str(name) + ' ' + str(tyGenerat)).lower()
    for fuel, keywords in FUEL_KEYWORDS:
        if any(kw in combined for kw in keywords):
            return fuel
    return 'unknown'

def infer_generation_type(fuel: str, tyGenerat: str = '') -> str:
    tg = str(tyGenerat).strip().lower()
    if 'combined' in tg or 'ccgt' in tg:
        return 'CCGT'
    if 'ocgt' in tg or ('gas' in tg and 'turbine' in tg):
        return 'OCGT'
    if 'run' in tg or 'microhydro' in tg:
        return 'run-of-river'
    if 'floating' in tg:
        return 'floating-solar'
    if 'ground' in tg:
        return 'ground-mounted-solar'
    return GENERATION_TYPE_MAP.get(fuel, 'unknown')

def decode_mm_status(raw) -> str:
    if pd.isna(raw) or str(raw).strip() == '':
        return 'unknown'
    raw = str(raw).strip()
    for mm_key, en_val in MM_STATUS_MAP.items():
        if mm_key in raw:
            return en_val
    return raw

def split_developers(raw) -> Optional[str]:
    if pd.isna(raw) or not str(raw).strip():
        return None
    raw_str = str(raw).strip()
    parts = [p.strip() for p in raw_str.split(',') if p.strip()]
    return json.dumps(parts) if parts else None

def is_placeholder(val) -> bool:
    if pd.isna(val) or val is None:
        return True
    s = str(val).strip().lower()
    return s in ('', 'none', 'unknown', '[]') or (s.startswith('[') and s.endswith(']'))

def resolve_attrs(d1: dict, d2: dict) -> dict:
    """Attribute-level merge logic. Keeps the most specific/non-placeholder field."""
    out = dict(d1)
    for col in d2:
        if col in ('geometry', 'id', 'source', 'confidence_score'):
            continue
        v1 = d1.get(col)
        v2 = d2.get(col)
        
        v1_empty = is_placeholder(v1)
        v2_empty = is_placeholder(v2)
        
        if not v1_empty and not v2_empty:
            # Both exist. Prefer higher confidence or more specific
            conf1 = d1.get('confidence_score', 0)
            conf2 = d2.get('confidence_score', 0)
            if conf2 > conf1:
                out[col] = v2
            else:
                out[col] = v1
        elif not v2_empty and v1_empty:
            out[col] = v2
        elif not v1_empty and v2_empty:
            out[col] = v1
    return out

def merge_sources(s1: str, s2: str) -> str:
    parts = {p.strip() for p in (str(s1) + ',' + str(s2)).split(',') if p.strip()}
    return ', '.join(sorted(parts))

# ═══════════════════════════════════════════════════════════════════════════════
# Loaders
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_osm_category(category_name: str, query_template: str, bboxes: list) -> gpd.GeoDataFrame:
    cache = RAW_OSM_DIR / f'osm_{category_name}.geojson'
    if cache.exists():
        return gpd.read_file(cache)

    url = "http://overpass-api.de/api/interpreter"
    elements = []
    for bbox in bboxes:
        q = query_template.format(bbox=f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}")
        try:
            r = requests.get(url, params={'data': q}, timeout=60)
            r.raise_for_status()
            elements.extend(r.json().get('elements', []))
        except Exception as e:
            logger.error(f"OSM {category_name} failed for {bbox}: {e}")

    nodes = {el['id']: (el['lon'], el['lat']) for el in elements if el['type'] == 'node'}
    features = []
    for el in elements:
        tags = el.get('tags', {})
        geom = None
        if el['type'] == 'node':
            geom = Point(el['lon'], el['lat'])
        elif el['type'] == 'way':
            coords = [nodes[n] for n in el.get('nodes', []) if n in nodes]
            if len(coords) > 1:
                geom = LineString(coords)
            elif len(coords) == 1:
                geom = Point(coords[0])
            elif 'geometry' in el:
                coords = [(n['lon'], n['lat']) for n in el['geometry']]
                geom = LineString(coords) if len(coords) > 1 else Point(coords[0]) if coords else None
        elif el['type'] == 'relation' and 'center' in el:
            geom = Point(el['center']['lon'], el['center']['lat'])

        if geom:
            features.append({
                'id':               f"osm_{el['type']}_{el['id']}",
                'name':             tags.get('name', tags.get('name:en', 'Unknown')),
                'type':             tags.get('power', 'unknown'),
                'voltage':          tags.get('voltage', ''),
                'circuits':         tags.get('circuits', 'unknown'),
                'conductor_type':   tags.get('conductor_type', 'unknown'),
                'source':           'OSM',
                'confidence_score': 0.7,
                'geometry':         geom,
            })

    empty = gpd.GeoDataFrame(columns=['id', 'name', 'type', 'voltage', 'source', 'confidence_score', 'geometry'], geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')
    if not features: return empty
    gdf = gpd.GeoDataFrame(features, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')
    gdf = gdf[gdf.is_valid]
    gdf.to_file(cache, driver='GeoJSON')
    return gdf

def load_new_hydro() -> gpd.GeoDataFrame:
    path = INPUT_DIR / 'hydro_gen_nm_20250802.geojson'
    if not path.exists(): return gpd.GeoDataFrame()
    gdf = gpd.read_file(path)
    
    # Validation per User Request 2
    geoms = []
    flipped_count = 0
    for _, row in gdf.iterrows():
        pt = row.geometry
        if pt is None or pt.is_empty:
            geoms.append(pt)
            continue
        lat, lon = pt.y, pt.x
        if not (9.5 <= lat <= 28.5 and 92.0 <= lon <= 102.0):
            # Coordinates likely swapped
            logger.info(f"coordinate_flip: true for {row.get('Hydropower', 'Unknown')} (lat={lat}, lon={lon})")
            geoms.append(Point(lat, lon))
            flipped_count += 1
        else:
            geoms.append(pt)
    gdf['geometry'] = geoms

    rows = []
    for i, row in gdf.iterrows():
        kv, kv_all = parse_voltage(row.get('Transmissi'))

        # Generation Type
        ror = str(row.get('RoR or Sto', '')).strip().upper()
        if ror == 'ROR': gen_type = 'run-of-river'
        elif ror == 'S': gen_type = 'reservoir'
        else: gen_type = 'unknown'

        dam_height = row.get('Dam Height', '')
        if pd.isna(dam_height) or dam_height == '-': 
            dam_height = None
        else:
            try: dam_height = float(dam_height)
            except ValueError: dam_height = None
            
        months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        monthly_gen = {}
        for m in months:
            v = row.get(m)
            if not pd.isna(v) and str(v).strip() != '':
                try: monthly_gen[m] = float(v)
                except ValueError: pass
        
        cap = row.get('Installed')
        try: cap = float(cap) if pd.notna(cap) else None
        except ValueError: cap = None
        
        rows.append({
            'id':                 f"NM_HYDRO_{row.get('ID', i)}",
            'name':               clean_name(row.get('Hydropower')),
            'name_quality':       'ok',
            'type':               'dam',
            'voltage_kv':         kv,
            'voltage_all':        json.dumps(kv_all),
            'capacity':           cap,
            'source':             'NM_Hydro',
            'confidence_score':   0.95,
            'fuel_type':          'hydro',
            'generation_type':    gen_type,
            'operational_status': HYDRO_STATUS_MAP.get(str(row.get('Status')), 'unknown'),
            'river_name':         row.get('River/ Wat'),
            'dam_height_m':       dam_height,
            'dam_type_code':      row.get('Dam Type') if pd.notna(row.get('Dam Type')) else None,
            'developer_list':     split_developers(row.get('Developer')),
            'tl_connect':         row.get('TL Connect') if pd.notna(row.get('TL Connect')) else None,
            'monthly_gen_gwh':    json.dumps(monthly_gen) if monthly_gen else None,
            'geometry':           row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def load_new_pv() -> gpd.GeoDataFrame:
    path = INPUT_DIR / 'pv_gen_nm_20250802.geojson'
    if not path.exists(): return gpd.GeoDataFrame()
    gdf = gpd.read_file(path)
    rows = []
    for i, row in gdf.iterrows():
        t = str(row.get('Type', '')).lower()
        if 'floating' in t: gen_type = 'floating-solar'
        elif 'ground' in t: gen_type = 'ground-mounted-solar'
        else: gen_type = 'solar-pv'

        cap = row.get('Capacity')
        try: cap = float(cap) if pd.notna(cap) else None
        except ValueError: cap = None

        # Backfill agreement_stage for PV projects sitting at MOA/MOU
        status_raw = str(row.get('Status', ''))
        agreement  = AGREEMENT_STAGE_MAP.get(status_raw, None)

        rows.append({
            'id':                 f"NM_PV_{row.get('id', i)}",
            'name':               clean_name(row.get('Name')),
            'name_quality':       'ok',
            'type':               'plant',
            'voltage_kv':         None,
            'voltage_all':        "[]",
            'capacity':           cap,
            'source':             'NM_PV',
            'confidence_score':   0.95,
            'fuel_type':          'solar',
            'generation_type':    gen_type,
            'operational_status': WIND_PV_STATUS_MAP.get(status_raw, 'unknown'),
            'agreement_stage':    agreement,
            'cod':                row.get('COD') if pd.notna(row.get('COD')) else None,
            'remark':             row.get('Remark') if pd.notna(row.get('Remark')) else None,
            'developer_list':     split_developers(row.get('Developer')),
            'geometry':           row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def load_new_wind() -> gpd.GeoDataFrame:
    path = INPUT_DIR / 'wind_gen_nm_20250802.geojson'
    if not path.exists(): return gpd.GeoDataFrame()
    gdf = gpd.read_file(path)
    rows = []
    for i, row in gdf.iterrows():
        cap = row.get('Capacity')
        if pd.notna(cap):
            cap = str(cap).replace(',', '').strip()
            try: cap = float(cap)
            except ValueError: cap = None
        else: cap = None

        rows.append({
            'id':                 f"NM_WIND_{i}",
            'name':               clean_name(row.get('Name')),
            'type':               'plant',
            'fuel_type':          'wind',
            'generation_type':    'onshore-wind',
            'voltage_kv':         None,
            'voltage_all':        "[]",
            'capacity':           cap,
            'source':             'NM_Wind',
            'confidence_score':   0.90,
            'operational_status': WIND_PV_STATUS_MAP.get(str(row.get('Status')), 'unknown'),
            'agreement_stage':    AGREEMENT_STAGE_MAP.get(str(row.get('Status')), None),
            'developer_list':     split_developers(row.get('Developer')),
            'geometry':           row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def load_substations_local_20250802() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(INPUT_DIR / 'substation_nm_20250802.geojson')
    rows = []
    for i, row in gdf.iterrows():
        name_clean, name_orig = clean_substation_name(row.get('name', '') or '')
        kv, kv_all = parse_voltage(row.get('voltage_le') or row.get('Voltage'))

        raw_yr = row.get('commission')
        try: commission_year = int(float(raw_yr)) if raw_yr and str(raw_yr).strip() else None
        except (ValueError, TypeError): commission_year = None

        raw_mva = row.get('MVA')
        try: cap_mva = round(float(raw_mva), 2) if raw_mva and str(raw_mva).strip() else None
        except (ValueError, TypeError): cap_mva = None

        raw_tc = row.get('total_tran')
        try: tc = int(float(raw_tc)) if raw_tc and str(raw_tc).strip() else None
        except (ValueError, TypeError): tc = None

        rows.append({
            'id':                f'Local_20250802_{i}',
            'name':              name_clean if name_clean else 'Unknown',
            'name_original':     name_orig,
            'type':              'substation',
            'voltage_kv':        kv,
            'voltage_all':       json.dumps(kv_all),
            'source':            'Local_20250802',
            'confidence_score':  0.95,
            'commission_year':   commission_year,
            'owner':             None,
            'status':            decode_mm_status(row.get('status')),
            'transformer_count': tc,
            'capacity_mva':      cap_mva,
            'geometry':          row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def load_substations_mimu() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(INPUT_DIR / 'mm_substations_pt_mimu.geojson')
    rows = []
    for i, row in gdf.iterrows():
        kv, kv_all = parse_voltage(row.get('PowerKV'))
        rows.append({
            'id':                row.get('codeEI', f'MIMU_sub_{i}'),
            'name':              clean_name(row.get('cl_nmEng', 'Unknown')),
            'name_original':     row.get('cl_nmEng', ''),
            'type':              'substation',
            'voltage_kv':        kv,
            'voltage_all':       json.dumps(kv_all),
            'source':            'MIMU',
            'confidence_score':  0.85,
            'status':            decode_mm_status(row.get('statOperat')),
            'geometry':          row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def load_powerplants_mimu() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(INPUT_DIR / 'mm_powerplants_pt.geojson')
    rows = []
    for i, row in gdf.iterrows():
        name = clean_name(row.get('cl_nmEng', 'Unknown'))
        fuel = infer_fuel_type(name, row.get('tyGenerat', ''))
        gen_type = infer_generation_type(fuel, row.get('tyGenerat', ''))
        cap = row.get('maxCapacit')
        try: cap = round(float(cap), 2) if cap not in (None, '', 0.0) else None
        except (ValueError, TypeError): cap = None

        rows.append({
            'id':                 row.get('codeEI', f'MIMU_plant_{i}'),
            'name':               name,
            'name_quality':       name_quality_flag(name),
            'type':               'plant',
            'capacity':           cap,
            'source':             'MIMU',
            'confidence_score':   0.85,
            'fuel_type':          fuel,
            'generation_type':    gen_type,
            'operational_status': decode_mm_status(row.get('statOperat')),
            'geometry':           row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def load_hydrodams() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(INPUT_DIR / 'mm_hydrodam_pt.geojson')
    rows = []
    for i, row in gdf.iterrows():
        name = clean_name(row.get('cl_nmEng', 'Unknown'))
        rows.append({
            'id':                 row.get('codeEI', f'Hydro_{i}'),
            'name':               name,
            'name_quality':       name_quality_flag(name),
            'type':               'dam',
            'source':             'MIMU_Hydro',
            'confidence_score':   0.85,
            'operational_status': decode_mm_status(row.get('statOperat')),
            'geometry':           row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def load_lines_local() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(INPUT_DIR / 'tl_nm_20250802.geojson')
    rows = []
    for i, row in gdf.iterrows():
        kv, kv_all = parse_voltage(row.get('voltage') or row.get('vcalc'))
        rows.append({
            'id':               row.get('full_id', f'Local_TL_{i}'),
            'name':             clean_name(row.get('name') or 'Unknown'),
            'type':             'line',
            'voltage_kv':       kv,
            'voltage_all':      json.dumps(kv_all),
            'source':           'Local_TL',
            'confidence_score': 0.9,
            'circuits':         'unknown',
            'conductor_type':   'unknown',
            'geometry':         row.geometry,
        })
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

def harmonize_osm(gdf: gpd.GeoDataFrame, is_sub=False) -> gpd.GeoDataFrame:
    if gdf.empty: return gdf
    rows = []
    for i, row in gdf.iterrows():
        kv, kv_all = parse_voltage(row.get('voltage', ''))
        d = {
            'id':               row.get('id', f'OSM_{i}'),
            'type':             row.get('type', 'unknown'),
            'voltage_kv':       kv,
            'voltage_all':      json.dumps(kv_all),
            'source':           'OSM',
            'confidence_score': 0.7,
            'geometry':         row.geometry,
        }
        name = clean_name(row.get('name', 'Unknown'))
        if is_sub:
            name_c, name_o = clean_substation_name(name)
            d['name'] = name_c
            d['name_original'] = name_o
        else:
            d['name'] = name
            
        rows.append(d)
    return gpd.GeoDataFrame(rows, geometry='geometry', crs=f'EPSG:{EPSG_WGS84}')

# ═══════════════════════════════════════════════════════════════════════════════
# Deduplication Logic
# ═══════════════════════════════════════════════════════════════════════════════

def deduplicate_points(gdf: gpd.GeoDataFrame, distance_m=500, fuzzy_thresh=60) -> gpd.GeoDataFrame:
    if gdf.empty: return gdf
    gdf_utm = gdf.to_crs(EPSG_UTM).copy()
    gdf_utm['_oidx'] = range(len(gdf_utm))
    buffered = gdf_utm.copy()
    buffered['geometry'] = buffered.geometry.buffer(distance_m)

    joined = gpd.sjoin(
        gdf_utm.reset_index(drop=True),
        buffered.reset_index(drop=True)[['geometry', '_oidx']].rename(columns={'_oidx': '_bidx'}),
        how='inner', predicate='intersects'
    )

    processed = set()
    results = []

    for pos in range(len(gdf_utm)):
        if pos in processed: continue
        base = gdf_utm.iloc[pos].to_dict()
        cluster = {pos}

        candidates = joined[joined['_oidx'] == pos]['_bidx'].tolist()
        for c in candidates:
            if c == pos or c in processed: continue
            m = gdf_utm.iloc[c].to_dict()
            n1, n2 = base.get('name', ''), m.get('name', '')
            ok_name = (
                not n1 or n1 in ('Unknown', 'unknown', '[]') or
                not n2 or n2 in ('Unknown', 'unknown', '[]') or
                fuzz.ratio(n1.lower(), n2.lower()) >= fuzzy_thresh
            )
            if ok_name:
                cluster.add(c)
                merged = resolve_attrs(base, m)
                merged['source'] = merge_sources(base.get('source', ''), m.get('source', ''))
                # Prefer better geometry location if confidence is higher
                if m.get('confidence_score', 0) > base.get('confidence_score', 0):
                    merged['geometry'] = m['geometry']
                    merged['confidence_score'] = m['confidence_score']
                base = merged

        processed.update(cluster)
        results.append(base)

    out = gpd.GeoDataFrame(results, crs=EPSG_UTM).to_crs(EPSG_WGS84)
    return out.drop(columns=[c for c in ['_oidx', 'index_right'] if c in out.columns])

def deduplicate_lines(gdf: gpd.GeoDataFrame, endpoint_dist=150, overlap_ratio=0.85) -> gpd.GeoDataFrame:
    if gdf.empty: return gdf
    gdf_utm = gdf.to_crs(EPSG_UTM).copy()
    gdf_utm = gdf_utm[gdf_utm.is_valid & ~gdf_utm.geometry.is_empty].reset_index(drop=True)

    # Normalise MultiLineString → longest LineString constituent so dedup can use endpoints
    from shapely.geometry import MultiLineString as MLS
    def to_linestring(geom):
        if isinstance(geom, MLS):
            parts = [g for g in geom.geoms if isinstance(g, LineString) and len(g.coords) >= 2]
            return max(parts, key=lambda g: g.length) if parts else geom
        return geom
    gdf_utm['geometry'] = gdf_utm['geometry'].apply(to_linestring)
    gdf_utm = gdf_utm[gdf_utm.is_valid & ~gdf_utm.geometry.is_empty].reset_index(drop=True)

    sindex   = gdf_utm.sindex
    pending  = set(range(len(gdf_utm)))
    results  = []

    RELAXED_EP_DIST = endpoint_dist * 5   # 750m for cross-source gate

    for pos in list(pending):
        if pos not in pending: continue
        pending.discard(pos)
        base = gdf_utm.iloc[pos].to_dict()
        line = base['geometry']
        if not isinstance(line, LineString) or len(line.coords) < 2:
            results.append(base)
            continue

        p1, p2   = Point(line.coords[0]), Point(line.coords[-1])
        candidates = [i for i in sindex.intersection(line.bounds) if i in pending and i != pos]

        for c in candidates:
            c_row  = gdf_utm.iloc[c]
            c_line = c_row.geometry
            if not isinstance(c_line, LineString) or len(c_line.coords) < 2: continue

            cp1, cp2 = Point(c_line.coords[0]), Point(c_line.coords[-1])

            # Common gate: spatial overlap ratio using the SHORTER line as denominator
            buf    = line.buffer(50)
            inter  = buf.intersection(c_line)
            if inter.is_empty: continue
            shorter = min(line.length, c_line.length)
            ratio   = inter.length / shorter if shorter > 0 else 0
            if ratio < overlap_ratio: continue

            # Gate 1 (strict): both endpoint pairs within endpoint_dist — safe for parallel circuits
            ep_strict = (
                (p1.distance(cp1) <= endpoint_dist and p2.distance(cp2) <= endpoint_dist) or
                (p1.distance(cp2) <= endpoint_dist and p2.distance(cp1) <= endpoint_dist)
            )
            # Gate 2 (relaxed): at least ONE endpoint pair within 750m — catches cross-source offset
            ep_relaxed = (
                min(p1.distance(cp1), p1.distance(cp2)) <= RELAXED_EP_DIST or
                min(p2.distance(cp1), p2.distance(cp2)) <= RELAXED_EP_DIST
            )
            if not (ep_strict or ep_relaxed): continue

            c_dict = c_row.to_dict()
            base   = resolve_attrs(base, c_dict)
            base['source'] = merge_sources(base.get('source', ''), c_dict.get('source', ''))
            if c_line.length > line.length:
                base['geometry'] = c_line
                line = c_line
                p1, p2 = Point(line.coords[0]), Point(line.coords[-1])
            pending.discard(c)

        results.append(base)

    out = gpd.GeoDataFrame(results, crs=EPSG_UTM).to_crs(EPSG_WGS84)
    return out.drop(columns=[c for c in ['index_right'] if c in out.columns])


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    logger.info("=== Myanmar Grid Processor – Starting ===")

    # ── 1. Acquire Data ─────────────
    # OSM
    q_subs = """[out:json][timeout:60];(node["power"="substation"]({bbox});way["power"="substation"]({bbox});relation["power"="substation"]({bbox}););out center;"""
    q_plants = """[out:json][timeout:60];(node["power"="plant"]({bbox}); way["power"="plant"]({bbox}); relation["power"="plant"]({bbox});
    node["power"="generator"]({bbox}); way["power"="generator"]({bbox}); relation["power"="generator"]({bbox}););out center;"""
    q_lines = """[out:json][timeout:60];(way["power"="line"]({bbox});way["power"="minor_line"]({bbox});way["power"="cable"]({bbox}););out geom;"""
    
    osm_subs   = fetch_osm_category('substations', q_subs, MYANMAR_BBOXES)
    osm_plants = fetch_osm_category('plants', q_plants, MYANMAR_BBOXES)
    osm_lines  = fetch_osm_category('lines', q_lines, MYANMAR_BBOXES)
    
    if not osm_subs.empty:   osm_subs['type']   = 'substation'
    if not osm_plants.empty: osm_plants['type'] = 'plant'
    if not osm_lines.empty:  osm_lines['type']  = 'line'

    # Local
    local_subs1  = load_substations_local_20250802()
    local_subs2  = load_substations_mimu()
    local_plants = load_powerplants_mimu()
    local_hydro  = load_hydrodams()
    local_lines  = load_lines_local()

    # New
    nm_hydro = load_new_hydro()
    nm_pv    = load_new_pv()
    nm_wind  = load_new_wind()   # Merged into plants

    # Harmonize OSM
    osm_subs_h   = harmonize_osm(osm_subs, is_sub=True)
    osm_plants_h = harmonize_osm(osm_plants)
    osm_lines_h  = harmonize_osm(osm_lines)

    # Concat sets
    def safe_concat(dfs): return gpd.GeoDataFrame(pd.concat([d for d in dfs if not d.empty], ignore_index=True), crs=EPSG_WGS84)

    all_subs   = safe_concat([local_subs1, local_subs2, osm_subs_h])
    all_plants = safe_concat([local_plants, local_hydro, nm_hydro, nm_pv, nm_wind, osm_plants_h])
    all_lines  = safe_concat([local_lines,  osm_lines_h])

    # ── 2. Deduplicate ──────────────
    logger.info("Deduplicating substations (500m)...")
    final_subs   = deduplicate_points(all_subs, distance_m=500, fuzzy_thresh=60)
    
    logger.info("Deduplicating plants (200m)...") # Per user req for PV
    final_plants = deduplicate_points(all_plants, distance_m=200, fuzzy_thresh=70)

    logger.info("Snapping line endpoints (200m)...")
    snap_targets = safe_concat([final_subs[['geometry']], final_plants[['geometry']]])
    lines_utm  = all_lines.to_crs(EPSG_UTM)
    targets_utm = snap_targets.to_crs(EPSG_UTM)
    mpoint = targets_utm.geometry.union_all()
    
    snapped = []
    for _, row in tqdm(lines_utm.iterrows(), total=len(lines_utm), desc="Snapping"):
        line = row.geometry
        if not isinstance(line, LineString) or len(line.coords) < 2:
            snapped.append(line)
            continue
        coords = list(line.coords)
        coords[0] = snap(Point(coords[0]), mpoint, 200).coords[0]
        coords[-1] = snap(Point(coords[-1]), mpoint, 200).coords[0]
        snapped.append(LineString(coords))
    lines_utm['geometry'] = snapped
    lines_snapped = lines_utm.to_crs(EPSG_WGS84)

    logger.info("Deduplicating lines (150m, 85%)...")
    final_lines = deduplicate_lines(lines_snapped, endpoint_dist=150, overlap_ratio=0.85)

    # ── 3. Split Hydro / Finalize IDs ──────
    final_subs   = fill_ids(final_subs)
    final_plants = fill_ids(final_plants)
    final_lines  = fill_ids(final_lines)

    # ── 3.5 Inject Excel Parameters ────────
    import os
    excel_path = INPUT_DIR / '1. Line & Transformer (ALL Myanmar).xlsx'
    
    # Initialize new columns with None to ensure schema consistency even if Excel is missing
    final_subs['region'] = None
    final_subs['commission_year'] = None
    final_subs['transformers_json'] = None
    
    final_lines['from_sub_id'] = None
    final_lines['to_sub_id'] = None
    final_lines['status'] = 'existing'
    
    line_param_cols = ['r1_ohm_km', 'x1_ohm_km', 'c1_uf_km', 'r0_ohm_km', 'x0_ohm_km', 'c0_uf_km',
                       'thermal_rating_mva', 'stability_rating_mva', 'conductor_type', 'circuits']
    for c in line_param_cols:
        final_lines[c] = None

    if excel_path.exists():
        logger.info("Integrating MOEP Excel parameters...")
        import sys
        sys.path.append(str(INPUT_DIR.parent)) # to find excel_parser
        try:
            from excel_parser import load_excel_substations, load_excel_lines, clean_sub_name
            from rapidfuzz import process, fuzz
            
            ex_subs = load_excel_substations(excel_path)
            ex_lines = load_excel_lines(excel_path)
            
            # Substation Name Mapping
            # clean_sub_name now applies the SUBSTATION_NAME_MAP; '__SKIP__' = confirmed non-GIS entries
            pipe_names_raw = [clean_sub_name(n) for n in final_subs['name']]
            pipe_names = [n for n in pipe_names_raw if n and n != '__SKIP__']
            pipe_id_map = {n: sid for n, sid in zip(pipe_names_raw, final_subs['id']) if n and n != '__SKIP__'}
            excel_to_pipe_sub_id = {}
            
            all_esubs = set(ex_subs.keys())
            for l in ex_lines:
                all_esubs.add(l['from_sub_clean'])
                all_esubs.add(l['to_sub_clean'])
            # Remove skip entries upfront
            all_esubs = {e for e in all_esubs if e != '__SKIP__'}
                
            exact = 0
            fuzzy = 0
            skipped = 0
            for esub in all_esubs:
                if esub == '__SKIP__':
                    skipped += 1
                    continue
                if esub in pipe_id_map:
                    excel_to_pipe_sub_id[esub] = pipe_id_map[esub]
                    exact += 1
                else:
                    match = process.extractOne(esub, pipe_names, scorer=fuzz.token_set_ratio)
                    if match and match[1] >= 75:
                        excel_to_pipe_sub_id[esub] = pipe_id_map[match[0]]
                        fuzzy += 1
            
            logger.info(f"Substation Matches: {exact} exact, {fuzzy} fuzzy, {len(all_esubs)-exact-fuzzy} unmatched out of {len(all_esubs)} Excel references")
            
            # Inject Substation Data
            for esub, pid in excel_to_pipe_sub_id.items():
                if esub in ex_subs:
                    esub_data = ex_subs[esub]
                    idx = final_subs['id'] == pid
                    final_subs.loc[idx, 'region'] = esub_data['region']
                    final_subs.loc[idx, 'commission_year'] = esub_data['commission_year']
                    if esub_data['transformers_json']:
                        final_subs.loc[idx, 'transformers_json'] = esub_data['transformers_json']
                    
            # Line Spatial Node Mapping
            subs_utm = final_subs.to_crs(EPSG_UTM)
            lines_utm = final_lines.to_crs(EPSG_UTM)
            
            def get_nearest_sub(pt):
                dist = subs_utm.distance(pt)
                if dist.min() <= 500:
                    return subs_utm.loc[dist.idxmin(), 'id']
                return None
                
            ex_line_map = {}
            for el in ex_lines:
                f = el['from_sub_clean']
                t = el['to_sub_clean']
                if f in excel_to_pipe_sub_id and t in excel_to_pipe_sub_id:
                    key = frozenset([excel_to_pipe_sub_id[f], excel_to_pipe_sub_id[t]])
                    ex_line_map.setdefault(key, []).append(el)
                    
            import re
            def extract_ids_from_name(name_str):
                if not name_str or name_str == 'Unknown': return None, None
                clean = re.sub(r'^(500kV|230kV|132kV|66kV|33kV)\s*', '', name_str, flags=re.IGNORECASE)
                parts = [p.strip() for p in re.split(r'\s+[-_–]+\s+|\s*to\s*', clean) if p.strip()]
                if len(parts) == 2:
                    p1_id, p2_id = None, None
                    esubs_list = list(all_esubs)
                    
                    def normalize(s):
                        return re.sub(r'[^A-Z0-9]', '', s.upper())
                        
                    norm_e = [normalize(e) for e in esubs_list]
                    
                    n_p0 = normalize(parts[0])
                    m1 = process.extractOne(n_p0, norm_e, scorer=fuzz.partial_ratio)
                    if m1 and m1[1] >= 85: p1_id = excel_to_pipe_sub_id.get(esubs_list[m1[2]])
                    
                    n_p1 = normalize(parts[1])
                    m2 = process.extractOne(n_p1, norm_e, scorer=fuzz.partial_ratio)
                    if m2 and m2[1] >= 85: p2_id = excel_to_pipe_sub_id.get(esubs_list[m2[2]])
                    
                    return p1_id, p2_id
                return None, None
                
            assigned_excel_lines = set()
            line_matches = 0
            
            for idx, row in lines_utm.iterrows():
                geom = row.geometry
                id1, id2 = None, None
                if geom and not geom.is_empty:
                    p1, p2 = Point(geom.coords[0]), Point(geom.coords[-1])
                    id1, id2 = get_nearest_sub(p1), get_nearest_sub(p2)
                
                # If geometry fractured, try name extraction
                if not (id1 and id2):
                    n1, n2 = extract_ids_from_name(row['name'])
                    if n1 and n2:
                        id1, id2 = n1, n2
                        
                final_lines.at[idx, 'from_sub_id'] = id1
                final_lines.at[idx, 'to_sub_id'] = id2
                
                if id1 and id2:
                    key = frozenset([id1, id2])
                    if key in ex_line_map:
                        candidates = ex_line_map[key]
                        best = None
                        for c_idx, c in enumerate(candidates):
                            # Allow parallel assignment to disconnected fractures
                            if c['voltage_kv'] and row['voltage_kv']:
                                try:
                                    if abs(float(c['voltage_kv']) - float(row['voltage_kv'])) < 20: best = c_idx; break
                                except:
                                    pass
                            else:
                                best = c_idx; break
                        if best is None: 
                            best = 0 # Default to first circuit if voltage match fails safely
                            
                        el = candidates[best]
                        for c in line_param_cols:
                            final_lines.at[idx, c] = el[c]
                        final_lines.at[idx, 'status'] = el['status']
                        line_matches += 1
            
            logger.info(f"Injecting electrical params to {line_matches} lines")
            
            # --- Name-based Proxy Injection for fragments ---
            propagate_count = 0
            for name, group in final_lines.groupby('name'):
                if not name or name == 'Unknown':
                    continue
                
                # Find segments that received parameters
                injected = group[group['thermal_rating_mva'].notna()]
                if len(injected) > 0:
                    # Find longest fragment to act as safeguard reference
                    best_frag_idx = injected.index[0]
                    max_len = 0
                    for idx in injected.index:
                        # compute topological length dynamically
                        l = lines_utm.loc[idx].geometry.length / 1000
                        if l > max_len:
                            max_len = l
                            best_frag_idx = idx
                            
                    # Safeguard: Only apply if actual mapped fragment is roughly transmission scale (>5km)
                    if max_len >= 5:
                        params = injected.loc[best_frag_idx]
                        cols_to_copy = line_param_cols + ['status', 'from_sub_id', 'to_sub_id']
                        
                        to_update = group[group['thermal_rating_mva'].isna()].index
                        for idx in to_update:
                            for c in cols_to_copy:
                                final_lines.at[idx, c] = params[c]
                            propagate_count += 1
                            
            if propagate_count > 0:
                logger.info(f"Propagated parameters to {propagate_count} additional line fragments via name grouping")
        except Exception as e:
            logger.error(f"Failed parsing/injecting excel: {e}")

    hydro_mask = (
        final_plants['source'].str.contains('Hydro', na=False, case=False) |
        (final_plants['type'] == 'dam') |
        (final_plants['fuel_type'] == 'hydro')
    )
    final_hydro = final_plants[hydro_mask].copy()
    final_plants_no_hydro = final_plants[~hydro_mask].copy()

    final_hydro['type'] = 'dam'

    # Drop hydro-only columns from the non-hydro plants output
    HYDRO_ONLY_COLS = ['river_name', 'dam_height_m', 'dam_type_code', 'tl_connect',
                       'monthly_gen_gwh', 'name_original']
    final_plants_no_hydro = final_plants_no_hydro.drop(
        columns=[c for c in HYDRO_ONLY_COLS if c in final_plants_no_hydro.columns], errors='ignore'
    )

    # ── 3.6 MIMU Administrative Boundary Spatial Join (Tier 3 / T1-C) ────────────
    mimu_path = INPUT_DIR / 'mimu_adm3_townships.geojson'
    ADMIN_COLS = ['state_region', 'district', 'township', 'ts_pcode', 'sr_pcode']
    for layer in [final_subs, final_lines, final_plants_no_hydro, final_hydro]:
        for col in ADMIN_COLS:
            if col not in layer.columns:
                layer[col] = None

    if mimu_path.exists():
        logger.info("Running MIMU administrative boundary spatial join...")
        try:
            mimu = gpd.read_file(mimu_path).to_crs(EPSG_WGS84)
            mimu = mimu[['ST', 'ST_PCODE', 'DT', 'TS', 'TS_PCODE', 'geometry']].copy()
            mimu = mimu.rename(columns={
                'ST': 'state_region', 'ST_PCODE': 'sr_pcode',
                'DT': 'district', 'TS': 'township', 'TS_PCODE': 'ts_pcode'
            })

            def do_spatial_join(gdf, label, use_centroid=False):
                """Point-in-polygon join. For lines, use centroid of each geometry."""
                gdf_4326 = gdf.to_crs(EPSG_WGS84)
                if use_centroid:
                    pts = gdf_4326.copy()
                    pts['geometry'] = gdf_4326.geometry.centroid
                else:
                    pts = gdf_4326
                joined = gpd.sjoin(
                    pts[['geometry']].reset_index(),
                    mimu, how='left', predicate='within'
                ).set_index('index')
                matched = 0
                for col in ADMIN_COLS:
                    if col in joined.columns:
                        col_vals = joined[col].reindex(gdf.index)
                        gdf[col] = col_vals
                        if col == 'township':
                            matched = col_vals.notna().sum()
                logger.info(f"  {label}: {matched}/{len(gdf)} tagged")
                return gdf

            final_subs            = do_spatial_join(final_subs,            'Substations')
            final_plants_no_hydro = do_spatial_join(final_plants_no_hydro, 'Power Plants')
            final_hydro           = do_spatial_join(final_hydro,           'Hydro Dams')
            final_lines           = do_spatial_join(final_lines,           'Transmission Lines', use_centroid=True)

        except Exception as e:
            logger.error(f"MIMU spatial join failed: {e}")
    else:
        logger.warning("mimu_adm3_townships.geojson not found — skipping admin boundary join")

    # ── 3.7 Plant-Grid Connection (Tier 2-A) ────────────
    logger.info("Mapping Plant-Grid Connections (Tier 2-A)...")
    try:
        subs_utm = final_subs.to_crs(EPSG_UTM)
        for df, lbl in [(final_plants_no_hydro, "Power Plants"), (final_hydro, "Hydro")]:
            df_utm = df.to_crs(EPSG_UTM)
            # Find closest substation
            joined = gpd.sjoin_nearest(
                df_utm.reset_index(), 
                subs_utm[['id', 'name', 'geometry']], 
                how='left', 
                distance_col='sub_dist_m'
            ).set_index('index')
            # Handle duplicates from equidistant points
            joined = joined[~joined.index.duplicated(keep='first')]
            
            def format_conn(row):
                if pd.isna(row.get('id_right')): return None
                nm = row.get('name_right', 'Unknown')
                sid = row.get('id_right', '')
                d_km = row.get('sub_dist_m', 0) / 1000
                return f"{nm} [{sid}] ({d_km:.1f}km)"
                
            df['tl_connect'] = joined.apply(format_conn, axis=1)
            logger.info(f"  {lbl}: {df['tl_connect'].notna().sum()}/{len(df)} linked to nearest substation")
    except Exception as e:
        logger.error(f"Plant-Grid connection failed: {e}")

    # Cast developer_list / monthly_gen_gwh as explicit string dtype for OGR compatibility
    STR_JSON_COLS = ['developer_list', 'monthly_gen_gwh', 'voltage_all', 'transformers_json']
    for df in [final_plants_no_hydro, final_hydro, final_subs, final_lines]:
        for col in STR_JSON_COLS:
            if col in df.columns:
                df[col] = df[col].where(df[col].notna(), other=None)
                df[col] = df[col].apply(lambda v: str(v) if v is not None else None)

    # ── 4. Calculated columns & Rounding ───
    final_lines['length_km'] = (final_lines.to_crs(EPSG_UTM).geometry.length / 1000).round(2)

    for col in ['capacity', 'capacity_mva', 'transformer_count']:
        for df in [final_subs, final_plants_no_hydro, final_hydro, nm_wind]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').round(2)

    # ── 5. Reorder & Export ─────────
    def reorder(df, cols): return df[[c for c in cols if c in df.columns] + [c for c in df.columns if c not in cols and c != 'geometry'] + ['geometry']]

    PLANT_COLS  = ['id', 'name', 'name_quality', 'type', 'fuel_type', 'generation_type',
                   'capacity', 'voltage_kv', 'source', 'confidence_score',
                   'operational_status', 'agreement_stage', 'developer_list', 'tl_connect', 'cod', 'remark']
    HYDRO_COLS  = ['id', 'name', 'name_quality', 'type', 'fuel_type', 'generation_type',
                   'capacity', 'voltage_kv', 'source', 'confidence_score',
                   'operational_status', 'river_name', 'dam_height_m', 'dam_type_code',
                   'developer_list', 'tl_connect', 'monthly_gen_gwh']

    final_subs   = reorder(final_subs,   ['id', 'name', 'name_original', 'type', 'voltage_kv',
                                           'state_region', 'district', 'township', 'ts_pcode',
                                           'region', 'commission_year', 'transformers_json'])
    final_lines  = reorder(final_lines,  ['id', 'name', 'type', 'voltage_kv', 'status',
                                           'from_sub_id', 'to_sub_id', 'circuits', 'length_km',
                                           'state_region', 'district', 'township', 'ts_pcode',
                                           'conductor_type', 'r1_ohm_km', 'x1_ohm_km', 'c1_uf_km',
                                           'r0_ohm_km', 'x0_ohm_km', 'c0_uf_km',
                                           'thermal_rating_mva', 'stability_rating_mva'])
    PLANT_COLS_OUT  = PLANT_COLS  + ['state_region', 'district', 'township', 'ts_pcode']
    HYDRO_COLS_OUT  = HYDRO_COLS  + ['state_region', 'district', 'township', 'ts_pcode']
    final_plants = reorder(final_plants_no_hydro, PLANT_COLS_OUT)
    final_hydro  = reorder(final_hydro,  HYDRO_COLS_OUT)

    def write_geojson(gdf: gpd.GeoDataFrame, path: str):
        """Write GeoJSON directly via json module to avoid OGR type restrictions."""
        features = []
        for _, row in gdf.iterrows():
            props = {}
            for col in gdf.columns:
                if col == 'geometry':
                    continue
                val = row[col]
                # Normalise NaN / pd.NA / numpy types → Python native
                if val is None:
                    props[col] = None
                elif isinstance(val, float) and pd.isna(val):
                    props[col] = None
                elif hasattr(val, 'item'):   # numpy scalar
                    props[col] = val.item()
                else:
                    props[col] = val
            geom = row['geometry']
            features.append({
                'type': 'Feature',
                'geometry': geom.__geo_interface__ if geom else None,
                'properties': props,
            })
        fc = {'type': 'FeatureCollection', 'features': features}
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(fc, f, ensure_ascii=False)
        logger.info(f"Saved {path} ({len(features)} features)")

    out_map = {
        'myanmar_transmission_lines_final.geojson': final_lines,
        'myanmar_substations_final.geojson':        final_subs,
        'myanmar_powerplants_final.geojson':        final_plants,
        'myanmar_hydrodams_final.geojson':          final_hydro,
    }
    for fname, df in out_map.items():
        write_geojson(df, fname)

    # Remove stale wind file if it exists from a previous run
    import os
    stale = 'myanmar_windplants_final.geojson'
    if os.path.exists(stale):
        os.remove(stale)
        logger.info(f"Removed stale file: {stale}")

if __name__ == '__main__':
    main()

