import pandas as pd
import math
import json

# Manual mapping: Excel name (after basic cleaning) -> GIS pipeline name
# Rationale: Excel uses facility names, GIS uses regional/common names for same substations.
# Parenthetical variants in Excel stripped to canonical key below.
SUBSTATION_NAME_MAP = {
    # Hydro project complexes – facility name vs. common name
    'LAW PI TA':                  'BALUCHAUNG (2) HYDROELECTRIC POWER PLANT (SUBSTATION)',
    'LAW PITA':                   'BALUCHAUNG (2) HYDROELECTRIC POWER PLANT (SUBSTATION)',
    
    # Spelling/transliteration variants
    'TI KYIT':                    'TIGYIT COAL POWER PLANT',
    'TIKYIT':                     'TIGYIT COAL POWER PLANT',
    'HIN THA DA':                 'HINTHADA SUBSTATION',
    'POAN NA KYUN':               'PONNA KYUN',
    'KAN BAUK':                   'KANBAUK SUBSTATION',
    'OAK SHIPIN':                 'OAK SHIT PIN',
    'KATANKUN':                   'TAUNGOO PRIMARY SUBSTATION',
    'MYOT THA':                   'MYOTHIT SUBSTATION',
    'KAN BAE':                    'KANBAUK SUBSTATION',
    'KANBAE':                     'KANBAUK SUBSTATION',
    'THA PHAN ZEIK':              'THABAUNG SUBSTATION',
    'SE DAW GYI':                 'SEDAWGYI HYDROELECTRIC POWER PLANT (SUBSTATION)',
    'UPPER YEYWA':                'YEYWA HYDROELECTRIC POWER PLANT (SUBSTATION)',
    'KIN DA':                     'KINDA HYDROPOWER PLANT (SUBSTATION)',
    'KYEIK KA SAN':               'KYAIKASAN SUBSTATION',
    'BUDDH AKONE':                'BUDDHA KONE',
    'SAPAE KYWE':                 'SHWEBO PRIMARY SUBSTATION',
    'MAGWE':                      'MAGWAY SUBSTATION',
    'HAKA':                       'FALAM SUBSTATION',
    'MYIN GYAN':                  'MYINGYAN PRIMARY SUBSTATION',
    
    # Abbreviation / truncation
    'BA MAW':                     'BHAMO PRIMARY SUBSTATION',
    'BAMAW':                      'BHAMO PRIMARY SUBSTATION',
    'WINE MAW':                   'BHAMO PRIMARY SUBSTATION',  # Bhamo = Banmaw = Wine Maw district
    'WINEMAW':                    'BHAMO PRIMARY SUBSTATION',
    'NYAUNG BIN GYI':             'NYAUNG BIN GYI',
    
    # Parenthetical company suffix variants (strip suffix applied before lookup)
    'HLAINGTHAYAR':               'HLAING THAR YAR',
    'MYIN GYAN(VPOWER-2)':        'MYINGYAN PRIMARY SUBSTATION',
    'MON YWA':                    'MONYWA PRIMARY SUBSTATION',
    
    # Parenthetical corridor tags (these are mid-line in/out markers, not real substations)
    # Map to the named corridor endpoint if unambiguous, else None to skip
    'LAT PAN PYAR':               'LET PAN PYA ?',
    'NYAUNGNITPIN':               'NYAUNG NIT PIN',
    'KHA YAN':                    'KHA LOKE',   # best available; flag for review
    'SOUTH OAKKALA PA':           None,          # not in GIS — planned/future
    'JOINT':                      None,          # cable joint marker, not a substation
    'KMIC':                       None,          # KMIC industrial zone, not in GIS
    'NIHC':                       None,          # NIHC not in GIS
    'MELAUNG GYUNT':              None,          # not in GIS
    'YA DANAR BON':               None,          # not in GIS
    'NAM PAW':                    None,          # remote hydro, not in GIS
    'TAMU':                       None,          # border area, not in GIS
    'MINYAL':                     None,          # not found in GIS
    'TA CHI LATE':                'TA YOKE LAT',
    'BOKYIN':                     None,          # Bokpyin, not in GIS
    'CHI BWE NGE':                None,          # in/out tap, not a real sub
    'KYUK SE (POWER GEN)':        None,
    'KALAYWA(COAL PLANT)':        None,
    
    # Additional resolvable entries from line endpoint analysis
    'AUNG PIN LAE':               'AUNG PIN LAE',
    'OHN TAW':                    'OHN TAW',
    'PYIN OO LWIN':               'PYIN OO LWIN',
    'PATHEIN':                    'PATHEIN ??',
    'KALAY':                      'KALE SUBSTATION',
    'INDUSTRIAL ZONE':            'INDUSTRIAL ZONE PRIMARY SUBSTATION',
    'MYEIK':                      None,          # Myeik/Mergui, not in GIS dataset
    'WAR SHAUNG':                 None,          # not in GIS
    'CBN':                        None,          # Chi Bwe Nge in/out tap, not a sub
    '(OHN TAW-NYAUNG BIN GYI)':  'OHN TAW',    # use From endpoint (more prominent)
    '(OAK SHIT PIN-TAUNGUP)':     'OAK SHIT PIN', # use From endpoint
    '(KAMARNAT-MYAUNGTAGAR)':     'MYAUNG TA GAR',
    '(CHAUK-THAZI)':              'CHAUK',
    '(THAN LYIN-THILAWA)':        'VPOWER THANLYIN',
    '(NGA PYAW DINE-LET PAN HLA)': None,        # distribution tap
}

def _strip_parenthetical(name):
    """Strip trailing parenthetical from Excel names like MYIN GYAN(VPOWER-2) -> MYIN GYAN."""
    import re
    return re.sub(r'\s*\(.*?\)\s*$', '', name).strip()

def clean_sub_name(name):
    if not isinstance(name, str):
        return ""
    # Strip kV prefixes (case insensitive)
    v_prefixes = ['500KV', '230KV', '132KV', '110KV', '66KV', '33KV']
    n = str(name)
    n_upper = n.upper()
    for p in v_prefixes:
        if n_upper.startswith(p):
            n = n[len(p):]
            break # only strip once
    n = n.strip()
    
    # Strip -1, -2 suffixes
    if n.endswith('-1') or n.endswith('-2') or n.endswith('-3') or n.endswith('- 1'):
        n = n.rsplit('-', 1)[0].strip()
        
    # Replace common issues
    n = n.replace('\n', ' ')
    n = ' '.join(n.split())
    
    # Also remove "S/S" if present
    if n.endswith('S/S'):
        n = n[:-3].strip()
    
    n = n.upper()
    
    # Apply manual mapping (try full key first, then parenthetical-stripped key)
    if n in SUBSTATION_NAME_MAP:
        mapped = SUBSTATION_NAME_MAP[n]
        return mapped.upper() if mapped else '__SKIP__'
    
    stripped = _strip_parenthetical(n)
    if stripped != n and stripped in SUBSTATION_NAME_MAP:
        mapped = SUBSTATION_NAME_MAP[stripped]
        return mapped.upper() if mapped else '__SKIP__'
    
    return n

def load_excel_substations(filepath):
    """
    Parses the 02 Substations sheet.
    Returns a dict mapping normalized substation name -> dict of details
    """
    df = pd.read_excel(filepath, sheet_name='02 Substations', header=None)
    
    subs = {}
    current_sub = None
    
    for idx, row in df.iterrows():
        if idx < 5:  # skip headers
            continue
            
        sub_name_raw = row[1]
        
        if pd.notna(sub_name_raw) and str(sub_name_raw).strip() != "":
            current_sub = clean_sub_name(str(sub_name_raw))
            region = str(row[2]).strip() if pd.notna(row[2]) else None
            cod = str(row[22]).strip() if pd.notna(row[22]) else None
            
            if current_sub not in subs:
                subs[current_sub] = {
                    'name_raw': str(sub_name_raw),
                    'region': region,
                    'commission_year': cod,
                    'transformers': []
                }
        
        if not current_sub:
            continue
            
        # Parse transformer pairs
        # Pairs: 230/132 (3,4), 230/66 (5,6), 230/33 (7,8), 230/11 (9,10)
        # 132/66 (11,12), 132/33 (13,14), 132/11 (15,16), 110/66 (17,18)
        tr_map = {
            '230/132': (3,4), '230/66': (5,6), '230/33': (7,8), '230/11': (9,10),
            '132/66': (11,12), '132/33': (13,14), '132/11': (15,16), '110/66': (17,18)
        }
        
        for k, (cap_idx, qty_idx) in tr_map.items():
            cap = row[cap_idx]
            qty = row[qty_idx]
            
            if pd.notna(cap) and pd.notna(qty):
                try:
                    cap_val = float(cap)
                    qty_val = int(qty)
                    if cap_val > 0 and qty_val > 0:
                        subs[current_sub]['transformers'].append({
                            'voltage_step': k,
                            'capacity_mva': cap_val,
                            'quantity': qty_val
                        })
                except ValueError:
                    pass
                    
    # Convert transformers to JSON strings
    for sub in subs.values():
        sub['transformers_json'] = json.dumps(sub['transformers']) if sub['transformers'] else None
        
    return subs

def load_excel_lines(filepath):
    """
    Parses the 2025Lines sheet.
    Returns a list of line dictionaries.
    """
    df = pd.read_excel(filepath, sheet_name='2025Lines', header=None)
    
    lines = []
    status = 'existing'
    
    # Forward fill From, To, Voltage, Length ? Sometimes Line Code/Name is missing but From/To is present
    current_line_name = None
    
    for idx, row in df.iterrows():
        # Check boundary
        col0 = str(row[0]).strip().lower()
        if 'planned lines' in col0:
            status = 'planned'
            
        if idx < 3: # skip headers
            continue
            
        from_raw = row[3]
        to_raw = row[4]
        name_raw = row[2]
        
        if pd.notna(name_raw):
            current_line_name = str(name_raw)
            
        if pd.isna(from_raw) or pd.isna(to_raw):
            continue
            
        from_sub = clean_sub_name(str(from_raw))
        to_sub = clean_sub_name(str(to_raw))
        
        if not from_sub or not to_sub:
            continue
            
        voltage = row[5]
        length = row[6]
        
        def safe_float(v):
            if pd.isna(v): return None
            try: return float(v)
            except ValueError: return None
            
        line_data = {
            'excel_name': current_line_name,
            'from_sub_clean': from_sub,
            'to_sub_clean': to_sub,
            'status': status,
            'voltage_kv': safe_float(voltage),
            'length_km': safe_float(length),
            'conductor_type': str(row[7]).strip() if pd.notna(row[7]) else None,
            'circuits': safe_float(row[9]),
            'r1_ohm_km': safe_float(row[10]),
            'x1_ohm_km': safe_float(row[11]),
            'c1_uf_km': safe_float(row[12]),
            'r0_ohm_km': safe_float(row[13]),
            'x0_ohm_km': safe_float(row[14]),
            'c0_uf_km': safe_float(row[15]),
            'thermal_rating_mva': safe_float(row[16]),
            'stability_rating_mva': safe_float(row[17]),
        }
        lines.append(line_data)
        
    return lines
