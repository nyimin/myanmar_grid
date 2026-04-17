import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as turf from '@turf/turf';
import DeckGL from '@deck.gl/react';
import { FlyToInterpolator } from '@deck.gl/core';
import { Map, NavigationControl } from 'react-map-gl/maplibre';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import {
  MapPin, Search, X, GitBranch, Map as MapIcon,
  Crosshair, ClipboardCopy, Check, Ruler, Undo2, Trash2,
  Moon, Sun, Home, ChevronLeft, ChevronRight, Layers, Zap,
  Triangle, Droplets, LogOut
} from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from './contexts/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────────
const MAP_STYLES = {
  light: {
    version: 8,
    sources: { base: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  },
  dark: {
    version: 8,
    sources: { base: { type: 'raster', tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri' } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  },
};

const INITIAL_VIEW_STATE = {
  longitude: 95.9560, latitude: 21.9162,
  zoom: 5.5, pitch: 0, bearing: 0, transitionDuration: 0,
};

// Fixed: 33 kV and 11 kV now have distinct colors; 0 kV is a separate fallback
const VOLTAGE_COLORS = {
  500: [255, 105, 180, 255],
  230: [239, 68,  68,  255],
  132: [59,  130, 246, 255],
  66:  [34,  197, 94,  255],
  33:  [156, 163, 175, 220],   // medium gray
  11:  [100, 116, 139, 200],   // darker gray — distinct from 33 kV
  0:   [70,  80,  100, 160],   // dim fallback
};

const FUEL_COLORS = {
  gas: [56, 189, 248], solar: [250, 204, 21], coal: [168, 162, 158],
  hydro: [59, 130, 246], wind: [167, 243, 208], default: [217, 119, 6],
};

const STATE_FILL_COLORS = [
  [99,179,237,30],[154,230,180,30],[251,211,141,30],[246,173,185,30],[214,188,250,30],
  [129,230,217,30],[252,196,25,30],[196,181,253,30],[167,243,208,30],[253,186,116,30],
  [147,197,253,30],[252,165,165,30],[110,231,183,30],[233,213,255,30],[254,240,138,30],
  [186,230,253,30],[253,224,132,30],[167,243,208,30],
];

const DONUT_COLORS = {
  hydro:'#3b82f6', gas:'#38bdf8', solar:'#facc15', coal:'#a8a29e',
  wind:'#a7f3d0', steam:'#fb923c', biomass:'#4ade80', default:'#d97706', unknown:'#6b7280',
};

const LOAD_STEPS = [
  'Loading transmission lines…',
  'Loading substations…',
  'Loading power plants…',
  'Loading hydro dams…',
  'Loading admin boundaries…',
  'Loading road network…',
];

// ── Voltage × Capacity minimum voltage rules ────────────────────────────────
function minVoltageForCapacity(capMW) {
  if (capMW < 30)  return 66;
  if (capMW < 100) return 132;
  return 230;
}

// ── Grid Integration scoring (40 pts total) ────────────────────────────────
function scoreGridIntegration(subDist, lineDist, subVoltage, capMW) {
  // Sub distance — 20 pts
  let subScore = 0;
  if (subDist < 5)        subScore = 20;
  else if (subDist < 15)  subScore = 20 - ((subDist - 5)  / 10) * 10;
  else if (subDist < 30)  subScore = 10 - ((subDist - 15) / 15) * 10;

  // Line distance — 10 pts
  let lineScore = 0;
  if (lineDist < 2)        lineScore = 10;
  else if (lineDist < 10)  lineScore = 10 - ((lineDist - 2)  / 8)  * 5;
  else if (lineDist < 25)  lineScore = 5  - ((lineDist - 10) / 15) * 5;

  // Voltage match — 10 pts
  const minV = minVoltageForCapacity(capMW);
  let voltScore = 0;
  if (!subVoltage || subVoltage === 0) {
    voltScore = 0; // unknown — neutral
  } else if (subVoltage >= minV) {
    voltScore = 10;
  } else {
    voltScore = -5; // below minimum — penalise
  }

  return {
    subScore:  Math.round(Math.max(0, subScore)),
    lineScore: Math.round(Math.max(0, lineScore)),
    voltScore,
    total:     Math.round(Math.max(0, subScore + lineScore + voltScore)),
  };
}

// ── Resource Quality scoring (30 pts) ─────────────────────────────────────
function scoreResource(tech, solarYield, ws100) {
  if (tech === 'solar') {
    if (!solarYield) return 0;
    if (solarYield >= 1700) return 30;
    if (solarYield >= 1500) return 30 - ((1700 - solarYield) / 200) * 10;
    if (solarYield >= 1300) return 20 - ((1500 - solarYield) / 200) * 15;
    return 5;
  } else {
    if (!ws100) return 0;
    if (ws100 >= 8.0)  return 30;
    if (ws100 >= 6.5)  return 30 - ((8.0 - ws100) / 1.5) * 10;
    if (ws100 >= 5.0)  return 20 - ((6.5 - ws100) / 1.5) * 15;
    return 5;
  }
}

// ── Site Feasibility scoring (30 pts) ─────────────────────────────────────
function scoreSite(tech, slopeMax, roadDistKm) {
  let slopeScore = 0;
  if (slopeMax === null) {
    slopeScore = 10; // unknown — neutral half score
  } else if (tech === 'solar') {
    if (slopeMax <= 5)  slopeScore = 20;
    else if (slopeMax <= 12) slopeScore = 20 - ((slopeMax - 5) / 7) * 15;
    else slopeScore = 0;
  } else {
    if (slopeMax <= 10) slopeScore = 20;
    else if (slopeMax <= 20) slopeScore = 20 - ((slopeMax - 10) / 10) * 15;
    else slopeScore = 0;
  }
  let roadScore = 0;
  if (roadDistKm === null)  roadScore = 5;
  else if (roadDistKm <= 2) roadScore = 10;
  else if (roadDistKm <= 10) roadScore = 10 - ((roadDistKm - 2) / 8) * 7;
  else roadScore = 3;
  return { slopeScore: Math.round(slopeScore), roadScore: Math.round(roadScore), total: Math.round(slopeScore + roadScore) };
}

// ── Grade from composite score ─────────────────────────────────────────────
const getGrade = (s) => {
  if (s >= 75) return { label: 'High Viability',      color: '#34d399', symbol: '🟢' };
  if (s >= 50) return { label: 'Moderate Viability',  color: '#facc15', symbol: '🟡' };
  if (s >= 30) return { label: 'Low Viability',        color: '#fb923c', symbol: '🟠' };
  return         { label: 'Not Viable',                color: '#ef4444', symbol: '🔴' };
};

// ── Color helpers ──────────────────────────────────────────────────────────
const rgbToHex = ([r, g, b]) => [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

// Fixed: explicit voltage range matching to avoid render/filter mismatch
const getVoltageColor = (v) => {
  if (!v || v <= 0)  return VOLTAGE_COLORS[0];
  if (v >= 500) return VOLTAGE_COLORS[500];
  if (v >= 230) return VOLTAGE_COLORS[230];
  if (v >= 132) return VOLTAGE_COLORS[132];
  if (v >= 66)  return VOLTAGE_COLORS[66];
  if (v >= 33)  return VOLTAGE_COLORS[33];
  return VOLTAGE_COLORS[11];
};

// ── Icon SVG helpers ────────────────────────────────────────────────────────
const mkTriangle = (hex) => ({
  url: `data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 2L2 22h20z' fill='%23${hex}' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E`,
  width: 24, height: 24, anchorY: 12,
});

const FUEL_ICON_PATHS = {
  hydro:   "%3Cpath d='M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z' fill='white'/%3E",
  solar:   "%3Ccircle cx='12' cy='12' r='4' fill='white'/%3E%3Cpath d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41' stroke='white' stroke-width='2' fill='none' stroke-linecap='round'/%3E",
  gas:     "%3Cpath d='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z' fill='white'/%3E",
  coal:    "%3Cpath d='M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z' fill='white'/%3E",
  wind:    "%3Cpath d='M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2' stroke='white' stroke-width='2' fill='none' stroke-linecap='round'/%3E",
  default: "%3Cpolygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2' fill='white'/%3E",
};

const mkPlantIcon = (hex, fuel) => {
  const fType = (fuel || 'default').toLowerCase();
  const innerPath = FUEL_ICON_PATHS[fType] || FUEL_ICON_PATHS.default;
  return {
    url: `data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='11' fill='%23${hex}' stroke='%23000' stroke-width='1.5'/%3E%3Cg transform='translate(4.8, 4.8) scale(0.6)'%3E${innerPath}%3C/g%3E%3C/svg%3E`,
    width: 24, height: 24, anchorY: 12,
  };
};

const mkTriGlow = () => ({
  url: `data:image/svg+xml,%3Csvg width='32' height='32' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 2L2 22h20z' fill='%23FFD700' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E`,
  width: 32, height: 32, anchorY: 16,
});

// ── Geo helpers ────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

function makeCircleGeoJSON(lng, lat, radiusKm, pts = 80) {
  const coords = Array.from({ length: pts + 1 }, (_, i) => {
    const angle = (i / pts) * 2 * Math.PI;
    return [
      lng + (radiusKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.cos(angle),
      lat + (radiusKm / 111.32) * Math.sin(angle),
    ];
  });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }] };
}

function getPointCoords(feature) {
  const { type, coordinates } = feature.geometry;
  if (type === 'Point') return coordinates;
  if (type === 'LineString') return coordinates[Math.floor(coordinates.length / 2)];
  if (type === 'MultiLineString') return coordinates[0][0];
  return null;
}

// ── Loading Overlay ────────────────────────────────────────────────────────
function LoadingOverlay({ step, total, error }) {
  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <span className="loading-logo">⚡</span>
        <h2 className="loading-title">Myanmar Power Grid</h2>
        <p className="loading-subtitle">Loading infrastructure data…</p>
        {!error ? (
          <>
            <div className="loading-progress-track">
              <div className="loading-progress-bar" style={{ width: `${Math.min((step / total) * 100, 100)}%` }} />
            </div>
            <p className="loading-step-label">{LOAD_STEPS[step - 1] || 'Initializing…'}</p>
          </>
        ) : (
          <div className="loading-error">
            ⚠️ Some data files failed to load. The map may be incomplete.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Donut Chart ────────────────────────────────────────────────────────────
function DonutChart({ data, onFilterSeg }) {
  if (!data?.length) return <div className="donut-empty">No plant data</div>;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="donut-empty">0 MW</div>;
  const r = 52, cx = 68, cy = 68, circ = 2 * Math.PI * r;
  // Build cumulative offsets purely (no mutation in render body)
  const segments = data.reduce((acc, d) => {
    const pct = d.value / total;
    const dash = pct * circ;
    const offset = circ - acc.cum * circ;
    return { cum: acc.cum + pct, items: [...acc.items, { ...d, dash, offset }] };
  }, { cum: 0, items: [] }).items;
  return (
    <div className="donut-wrap">
      <svg key={data.length + '-' + data.reduce((s, d) => s + d.value, 0)} width="136" height="136" viewBox="0 0 136 136" role="img" aria-label="Generation mix donut chart">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={20} />
        {segments.map((seg, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={20}
            strokeDasharray={`${seg.dash} ${circ - seg.dash}`} strokeDashoffset={seg.offset}
            style={{ transition: 'stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease' }}
            onClick={() => onFilterSeg && onFilterSeg(seg.label.toLowerCase())}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.2)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'} />
        ))}
        <text x={cx} y={cy - 7} textAnchor="middle" fill="white" fontSize="14" fontWeight="700">
          {(total / 1000).toFixed(1)}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize="10">GW total</text>
      </svg>
      <div className="donut-legend">
        {data.map((d, i) => (
          <div key={i} className="donut-legend-item">
            <div className="donut-legend-dot" style={{ background: d.color }} />
            <span className="donut-legend-label">{d.label}</span>
            <span className="donut-legend-val">
              {d.value >= 1000 ? `${(d.value / 1000).toFixed(1)} GW` : `${Math.round(d.value).toLocaleString()} MW`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Detail Content ─────────────────────────────────────────────────────────
function DetailContent({ feature, adjacencyMap }) {
  const [copied, setCopied] = useState(false);
  if (!feature) return null;
  const p = feature.properties;
  const isSub = p.type === 'substation';
  const ignoredKeys = new Set(['name', 'type', 'id', 'objectid', 'geom']);
  const formatKey = (k) => String(k).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const rows = [];
  if (isSub && adjacencyMap[p.id]) {
    rows.push(['Connections', `${adjacencyMap[p.id].length} lines`]);
  }
  Object.entries(p).forEach(([k, v]) => {
    if (!ignoredKeys.has(k.toLowerCase()) && v !== null && v !== '') {
      let val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (k === 'voltage_kv') val = `${val} kV`;
      else if (k === 'length_km') val = `${val} km`;
      else if (k === 'capacity') val = `${val} MW`;
      rows.push([formatKey(k), val]);
    }
  });
  const exportText = [
    `# ${p.name || 'Feature'}`,
    `type: ${feature.geometry.type}`,
    `coordinates: ${JSON.stringify(feature.geometry.coordinates)}`,
    ...Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  const handleCopy = () => {
    navigator.clipboard.writeText(exportText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="panel-content">
      <div className="detail-meta">
        <span className="detail-badge">
          {p.state_region || p.region || '–'}{p.district ? ` · ${p.district}` : ''}
        </span>
        <button className={`copy-btn ${copied ? 'copy-btn--done' : ''}`} onClick={handleCopy}
          aria-label="Copy feature data to clipboard">
          {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="detail-rows">
        {rows.map(([label, value]) => (
          <div key={label} className="detail-row">
            <span className="detail-label">{label}</span>
            <span className="detail-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trace Content ──────────────────────────────────────────────────────────
function TraceContent({ traceInfo }) {
  if (!traceInfo) return null;
  return (
    <div className="panel-content">
      <div className="trace-stat-grid">
        <div className="trace-stat-card">
          <span className="trace-stat-val" style={{ color: '#ffd700' }}>{traceInfo.connectedLines.length}</span>
          <span className="trace-stat-label">Lines</span>
        </div>
        <div className="trace-stat-card">
          <span className="trace-stat-val" style={{ color: '#a78bfa' }}>{traceInfo.connectedSubIds.length}</span>
          <span className="trace-stat-label">Substns</span>
        </div>
        <div className="trace-stat-card">
          <span className="trace-stat-val" style={{ color: '#34d399', fontSize: '1rem' }}>{traceInfo.totalTracedKm} km</span>
          <span className="trace-stat-label">Span</span>
        </div>
      </div>
      <p className="panel-hint">Connected lines are highlighted gold on the map.</p>
    </div>
  );
}

// ── Proximity Content ──────────────────────────────────────────────────────
function ProximityContent({ results, radius, onRadiusChange, onJumpTo }) {
  const subs   = results.filter(r => r.props.type === 'substation');
  const plants = results.filter(r => r.props.type === 'plant' || r.props.type === 'dam');
  return (
    <div className="panel-content">
      <div className="radius-control">
        <div className="radius-label">
          <span>Search Radius</span>
          <strong>{radius} km</strong>
        </div>
        <input type="range" min="2" max="100" step="1" value={radius}
          onChange={e => onRadiusChange(+e.target.value)}
          className="radius-slider" aria-label="Proximity search radius in km" />
      </div>
      <div className="proximity-summary">
        <div className="proximity-stat"><span>Substations</span><strong>{subs.length}</strong></div>
        <div className="proximity-stat"><span>Plants / Hydro</span><strong>{plants.length}</strong></div>
        <div className="proximity-stat">
          <span>Nearest Asset</span>
          <strong>{results.length ? `${results[0].dist.toFixed(1)} km` : '–'}</strong>
        </div>
      </div>
      {results.length > 0 ? (
        <div className="proximity-list">
          {results.map((r, i) => (
            <div key={i} className="proximity-list-item" onClick={() => onJumpTo(r)} role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onJumpTo(r)}>
              <span className="proximity-icon" style={{ color: r.props.type === 'substation' ? '#94a3b8' : '#facc15' }}>
                {r.props.type === 'substation' ? '▲' : '■'}
              </span>
              <span className="proximity-name">{r.props.name || '(unnamed)'}</span>
              <span className="proximity-dist">{r.dist.toFixed(1)} km</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-hint">No assets within {radius} km. Try increasing the radius.</p>
      )}
    </div>
  );
}

// ── Mini Bar Chart ──────────────────────────────────────────────────────────
const MONTH_LABELS = ['J','F','M','A','M','J','J','A','S','O','N','D'];
function MiniBarChart({ data, color }) {
  const max = data?.length ? Math.max(...data.map(v => v || 0)) : 0;
  if (!data?.length || !max) return (
    <div style={{fontSize:'0.7rem',color:'var(--text-muted)',padding:'4px 0'}}>No chart data available</div>
  );
  return (
    <div className="mini-bar-chart">
      {data.map((v, i) => (
        <div key={i} className="mini-bar-col">
          <div className="mini-bar-track">
            <div className="mini-bar-fill" style={{ height: `${max > 0 ? ((v || 0) / max) * 100 : 0}%`, background: color }} />
          </div>
          <span className="mini-bar-label">{MONTH_LABELS[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Capacity Factor proxy from mean wind speed (generic Class II/III power curve)
function windCF(ws) {
  if (!ws || ws <= 0) return 0;
  if (ws >= 12) return 0.48;
  if (ws >= 10) return 0.40;
  if (ws >= 8.5) return 0.33;
  if (ws >= 7.5) return 0.28;
  if (ws >= 6.5) return 0.22;
  if (ws >= 5.5) return 0.16;
  if (ws >= 4.5) return 0.10;
  return 0.05;
}

// ── Config Panel (Stage 1 of 2) ────────────────────────────────────────────
function ConfigPanel({ point, onRun, onCancel }) {
  const [tech, setTech]     = useState(null);   // 'solar' | 'wind'
  const [capMW, setCapMW]   = useState(50);
  const [mounting, setMounting] = useState('fixed'); // 'fixed' | 'tracking'

  return (
    <div className="viability-root">
      <div className="config-header">
        <div className="config-coords">
          <span className="config-coord-label">📍 Site Location</span>
          <span className="config-coord-val">{point.lat.toFixed(4)}°N, {point.lng.toFixed(4)}°E</span>
        </div>
        <p className="panel-hint">Configure your project before running the analysis.</p>
      </div>

      <div className="panel-content" style={{ gap: 14 }}>
        {/* Technology toggle */}
        <div className="config-group">
          <div className="config-label">Technology</div>
          <div className="config-tech-row">
            {[['solar','☀️ Solar PV'],['wind','🌬️ Onshore Wind']].map(([key,label]) => (
              <button key={key}
                className={`config-tech-btn ${tech === key ? 'config-tech-btn--active' : ''}`}
                onClick={() => setTech(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Capacity */}
        <div className="config-group">
          <div className="config-label-row">
            <span className="config-label">Nameplate Capacity</span>
            <strong className="config-val" style={{ color: tech === 'wind' ? '#a7f3d0' : '#facc15' }}>{capMW} MW</strong>
          </div>
          <input type="range" min={10} max={300} step={5} value={capMW}
            onChange={e => setCapMW(+e.target.value)}
            className="radius-slider"
            style={{ accentColor: tech === 'wind' ? '#a7f3d0' : '#facc15' }}
            aria-label="Nameplate capacity in MW" />
          <div className="config-range-labels"><span>10 MW</span><span>300 MW</span></div>
        </div>

        {/* Solar-only: mounting type */}
        {tech === 'solar' && (
          <div className="config-group">
            <div className="config-label">Mounting Type</div>
            <div className="config-tech-row">
              {[['fixed','Fixed Tilt'],['tracking','Single-Axis Tracker']].map(([key,label]) => (
                <button key={key}
                  className={`config-tech-btn ${mounting === key ? 'config-tech-btn--active' : ''}`}
                  onClick={() => setMounting(key)}>
                  {label}
                </button>
              ))}
            </div>
            {mounting === 'tracking' && (
              <p className="panel-hint" style={{color:'#facc15',marginTop:4}}>⚡ Tracker adds ~15–20% yield vs fixed tilt — accounted in PVWatts fetch.</p>
            )}
          </div>
        )}

        {/* Wind-only: capacity guidance */}
        {tech === 'wind' && (
          <div className="config-note">
            <span>Wind analysis uses ERA5 reanalysis at 100m hub height. Capacity factor estimated from generic IEC Class II/III power curve.</span>
          </div>
        )}

        {/* Voltage requirement preview */}
        {tech && (
          <div className="config-volt-preview">
            <span className="config-volt-label">Required Grid Voltage</span>
            <span className="config-volt-val">
              {capMW < 30 ? '≥ 66 kV' : capMW < 100 ? '≥ 132 kV' : '≥ 230 kV'}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="config-actions">
          <button className="config-cancel-btn" onClick={onCancel}>✕ Cancel</button>
          <button
            className={`config-run-btn ${tech ? 'config-run-btn--ready' : ''}`}
            disabled={!tech}
            onClick={() => onRun({ tech, capMW, mounting })}>
            ▶ Run Analysis
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Analysis Dashboard (Stage 2 of 2) ──────────────────────────────────────
function AnalysisDashboard({ result, meteoData, meteoLoading, config, onReconfigure, onNewPin }) {
  const { tech, capMW } = config;

  // ── Monthly chart state — Phase 5: moved out of useMemo to local state ──
  const [solarMonthlyDisplay, setSolarMonthlyDisplay] = useState(null);
  const [windMonthlyDisplay,  setWindMonthlyDisplay]  = useState(null);
  const [chartVersion, setChartVersion] = useState(0);

  useEffect(() => {
    if (meteoData?.solarMonthly?.length) {
      const scaled = meteoData.solarMonthly.map(v => v ? Math.round((v * capMW * 1000) / 1e3 * 10) / 10 : 0);
      setSolarMonthlyDisplay(scaled);
      setChartVersion(v => v + 1);
    }
  }, [meteoData?.solarMonthly, capMW]);

  useEffect(() => {
    if (meteoData?.windMonthly?.length) {
      const scaled = meteoData.windMonthly.map(m =>
        m ? Math.round(capMW * 8760 / 12 * windCF(m) * 0.85 / 1000 * 10) / 10 : 0
      );
      setWindMonthlyDisplay(scaled);
      setChartVersion(v => v + 1);
    }
  }, [meteoData?.windMonthly, capMW]);

  // ── Derived values ────────────────────────────────────────────────────────
  const solarYield   = meteoData?.solarYield ?? null;
  const ws100        = meteoData?.ws100 ?? null;
  const slopeMax     = meteoData?.slopeMax ?? null;
  const roadDistKm   = meteoData?.roadDistKm ?? null;

  const cf           = windCF(ws100);
  const solarGWhYr   = solarYield ? (capMW * 1000 * solarYield) / 1e6 : null;
  const windGWhYr    = ws100 ? Math.round(capMW * 8760 * cf * 0.85 / 1000 * 10) / 10 : null;
  const solarLandHa  = Math.round(capMW * 1.5);
  const windLeaseHa  = Math.round(capMW * 25);

  // ── Score modules ─────────────────────────────────────────────────────────
  const resourceScore = result ? Math.round(scoreResource(tech, solarYield, ws100)) : 0;
  const gridScores    = result ? scoreGridIntegration(result.subDist, result.lineDist, result.subVoltage, capMW) : null;
  const siteScores    = result ? scoreSite(tech, slopeMax, roadDistKm) : null;
  const composite     = Math.round(gridScores && siteScores ? resourceScore + gridScores.total + siteScores.total : 0);
  const grade         = getGrade(composite);

  // ── Flags ─────────────────────────────────────────────────────────────────
  const flags = [];
  if (result) {
    const minV = minVoltageForCapacity(capMW);
    if (result.subDist > 20)       flags.push({ type: 'red',    text: `Nearest substation ${result.subDist.toFixed(1)} km — high interconnection capex` });
    else if (result.subDist > 15)  flags.push({ type: 'yellow', text: `Grid distance ${result.subDist.toFixed(1)} km — line upgrades likely needed` });
    if (result.subVoltage && result.subVoltage < minV)
                                   flags.push({ type: 'yellow', text: `Nearest sub ${result.subVoltage} kV — below ${minV} kV minimum for ${capMW} MW` });
    if (slopeMax !== null) {
      const slopeLimit = tech === 'wind' ? 20 : 12;
      if (slopeMax > slopeLimit)   flags.push({ type: 'red',    text: `Slope ${slopeMax}% — exceeds ${slopeLimit}% earthworks threshold` });
      else if (slopeMax <= 5)      flags.push({ type: 'green',  text: `Slope ${slopeMax}% — excellent, minimal earthworks` });
      else                         flags.push({ type: 'yellow', text: `Slope ${slopeMax}% — manageable but review terrain` });
    }
    if (tech === 'solar' && solarYield) {
      if (solarYield >= 1700)      flags.push({ type: 'green',  text: `Solar yield ${Math.round(solarYield).toLocaleString()} kWh/kWp/yr — Class I (Excellent)` });
      else if (solarYield >= 1500) flags.push({ type: 'yellow', text: `Solar yield ${Math.round(solarYield).toLocaleString()} kWh/kWp/yr — Class II (Good)` });
      else                         flags.push({ type: 'red',    text: `Solar yield ${Math.round(solarYield).toLocaleString()} kWh/kWp/yr — marginal resource` });
    }
    if (tech === 'wind' && ws100) {
      if (ws100 >= 7.0)            flags.push({ type: 'green',  text: `Wind ${ws100.toFixed(1)} m/s @ 100m — viable resource` });
      else if (ws100 >= 5.5)       flags.push({ type: 'yellow', text: `Wind ${ws100.toFixed(1)} m/s @ 100m — marginal, check micro-siting` });
      else                         flags.push({ type: 'red',    text: `Wind ${ws100.toFixed(1)} m/s @ 100m — below commercial threshold` });
    }
  }

  const flagColor = { red:'#ef4444', yellow:'#facc15', green:'#34d399' };
  const flagIcon  = { red:'⛔', yellow:'⚠️', green:'✅' };

  return (
    <div className="viability-root">
      {/* ── Header ── */}
      <div className="dash-header">
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
          <div>
            <div className="dash-coords">{result?.targetPoint ? `${result.targetPoint.lat.toFixed(4)}°N, ${result.targetPoint.lng.toFixed(4)}°E` : '—'}</div>
            <div className="dash-config-line">
              {tech === 'solar' ? '☀️ Solar PV' : '🌬️ Onshore Wind'} · {capMW} MW
            </div>
          </div>
          <div style={{ display:'flex', gap:4 }}>
            <button className="dash-action-btn" onClick={onReconfigure} title="Reconfigure">⚙️</button>
            <button className="dash-action-btn" onClick={onNewPin} title="New location">📍</button>
          </div>
        </div>
      </div>

      {/* ── Loading state ── */}
      {meteoLoading && (
        <div className="dash-loading">
          <div className="dash-loading-stages">
            {['Fetching resource data…','Analysing grid proximity…','Computing scores…'].map((s, i) => (
              <div key={i} className="dash-loading-stage">
                <span className="meteo-spinner" style={{ borderTopColor: i === 0 ? '#facc15' : i === 1 ? '#60a5fa' : '#34d399' }} />
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Scores ── */}
      {!meteoLoading && (
        <div className="viability-modal-body">
          
          <div className="viability-modal-left">
            {/* Overall grade */}
            <div className="dash-overall">
              <div className="dash-grade-ring" style={{ borderColor: grade.color }}>
                <span className="dash-grade-num" style={{ color: grade.color }}>{composite}</span>
                <span className="dash-grade-denom">/100</span>
              </div>
              <div>
                <div className="dash-grade-label" style={{ color: grade.color }}>{grade.symbol} {grade.label}</div>
                <div className="dash-grade-sub">Composite score across 3 modules</div>
              </div>
            </div>

            {/* Sub-scores detail */}
            {gridScores && (
              <div className="dash-section">
                <div className="vsec-title">Grid Integration Breakdown</div>
                {[
                  { label:'Sub Distance', score: Math.round(gridScores.subScore),  max:20, color:'#60a5fa' },
                  { label:'Line Distance',score: Math.round(gridScores.lineScore), max:10, color:'#a78bfa' },
                  { label:'Voltage Match',score: Math.round(gridScores.voltScore), max:10, color:'#34d399', canBeNeg: true },
                ].map(b => (
                  <div key={b.label} className="viability-bar-row">
                    <span className="viability-bar-label">{b.label}</span>
                    <div className="viability-bar-track">
                      <div className="viability-bar-fill" style={{
                        width:`${(Math.max(0,b.score)/b.max)*100}%`,
                        background: b.score < 0 ? '#ef4444' : b.color,
                      }} />
                    </div>
                    <span className="viability-bar-pts" style={{ color: b.score < 0 ? '#ef4444' : b.color }}>
                      {b.canBeNeg && b.score > 0 ? '+' : ''}{b.score}/{b.max}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Flags */}
            {flags.length > 0 && (
              <div className="dash-section">
                <div className="vsec-title">Site Assessment</div>
                <div className="dash-flags">
                  {flags.map((f, i) => (
                    <div key={i} className="dash-flag" style={{ borderColor: flagColor[f.type]+'55' }}>
                      <span>{flagIcon[f.type]}</span>
                      <span style={{ color: f.type === 'green' ? '#94a3b8' : flagColor[f.type] }}>{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Infrastructure */}
            {result && (
              <div className="dash-section" style={{ borderBottom: 'none' }}>
                <div className="vsec-title">Grid Infrastructure</div>
                <div className="detail-row">
                  <span className="detail-label">Nearest Substation</span>
                  <span className="detail-value" style={{ color:'#60a5fa' }}>{result.subName || 'Unknown'} — {result.subDist.toFixed(1)} km</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Substation Voltage</span>
                  <span className="detail-value">{result.subVoltage ? `${result.subVoltage} kV` : '?'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Nearest Line</span>
                  <span className="detail-value" style={{ color:'#a78bfa' }}>{result.lineDist.toFixed(1)} km @ {result.lineVoltage ? `${result.lineVoltage} kV` : '? kV'}</span>
                </div>
              </div>
            )}
          </div>

          <div className="viability-modal-right">
            {/* Module cards */}
            <div className="dash-modules">
              {[
                { label:'Resource Quality',  score: resourceScore, max:30, color:'#facc15',  confidence:'High',   icon: tech==='solar'?'☀️':'🌬️' },
                { label:'Grid Integration', score: gridScores ? Math.round(gridScores.total) : 0, max:40, color:'#60a5fa', confidence:'Medium', icon:'⚡' },
                { label:'Site Feasibility', score: siteScores ? Math.round(siteScores.total) : 0, max:30, color:'#34d399', confidence:'Medium', icon:'⛰️' },
              ].map(m => (
                <div key={m.label} className="dash-module-card">
                  <div className="dash-module-top">
                    <span className="dash-module-icon">{m.icon}</span>
                    <span className="dash-module-label">{m.label}</span>
                    <span className="dash-confidence" title={`Confidence: ${m.confidence}`}>{m.confidence === 'High' ? '🟢' : '🟡'}</span>
                  </div>
                  <div className="dash-module-score" style={{ color: m.color }}>{m.score}<span className="dash-module-max">/{m.max}</span></div>
                  <div className="dash-module-bar-track">
                    <div className="dash-module-bar-fill" style={{ width:`${(m.score/m.max)*100}%`, background: m.color }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Key Metrics */}
            <div className="dash-section">
              <div className="vsec-title">Key Metrics</div>
              <div className="dash-metrics-grid">
                {tech === 'solar' && solarGWhYr && (
                  <><div className="dash-metric"><span className="dash-metric-val" style={{color:'#facc15'}}>{solarGWhYr.toFixed(1)}</span><span className="dash-metric-label">GWh/yr</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{Math.round(solarYield).toLocaleString()}</span><span className="dash-metric-label">kWh/kWp/yr</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{solarLandHa}</span><span className="dash-metric-label">ha land</span></div>
                  </>
                )}
                {tech === 'wind' && windGWhYr && (
                  <><div className="dash-metric"><span className="dash-metric-val" style={{color:'#a7f3d0'}}>{windGWhYr}</span><span className="dash-metric-label">GWh/yr</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{Math.round(cf*100)}%</span><span className="dash-metric-label">Cap. Factor</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{windLeaseHa}</span><span className="dash-metric-label">ha lease</span></div>
                  </>
                )}
                {roadDistKm !== null && (
                  <div className="dash-metric"><span className="dash-metric-val">{roadDistKm}</span><span className="dash-metric-label">km road</span></div>
                )}
                {slopeMax !== null && (
                  <div className="dash-metric"><span className="dash-metric-val" style={{color: slopeMax > (tech==='wind'?20:12) ? '#ef4444':'#34d399'}}>{slopeMax}%</span><span className="dash-metric-label">max slope</span></div>
                )}
              </div>
            </div>

            {/* Monthly chart */}
            {tech === 'solar' && solarMonthlyDisplay && (
              <div className="dash-section">
                <div className="vsec-title">Monthly Generation (MWh)</div>
                <MiniBarChart key={`solar-${chartVersion}`} data={solarMonthlyDisplay} color="#facc15" />
              </div>
            )}
            {tech === 'wind' && windMonthlyDisplay && (
              <div className="dash-section">
                <div className="vsec-title">Monthly Wind Speed (m/s)</div>
                <MiniBarChart key={`wind-${chartVersion}`} data={meteoData?.windMonthly} color="#a7f3d0" />
              </div>
            )}

            <div style={{ flex: 1 }} />
            <p className="panel-hint" style={{margin:'16px 16px 12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px'}}>
              Scores derived from PVGIS/ERA5 meteorological data, MIMU road network, and local GeoJSON grid data. For indicative purposes only.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Viability Content (state machine dispatcher) ────────────────────────────
function ViabilityContent({ analysisPhase, viabilityPoint, viabilityConfig, result, meteoData, meteoLoading, onRunAnalysis, onReconfigure, onNewPin }) {
  if (analysisPhase === 'idle' || !viabilityPoint) {
    return <div className="panel-content"><p className="panel-hint">Place a pin on the map to begin site configuration.</p></div>;
  }
  if (analysisPhase === 'configuring') {
    return <ConfigPanel point={viabilityPoint} onRun={onRunAnalysis} onCancel={onNewPin} />;
  }
  // analyzing or results
  return (
    <AnalysisDashboard
      result={result}
      meteoData={meteoData}
      meteoLoading={meteoLoading}
      config={viabilityConfig}
      onReconfigure={onReconfigure}
      onNewPin={onNewPin}
    />
  );
}

// ── Measure Content ────────────────────────────────────────────────────────
function MeasureContent({ points, mousePos, onUndo, onClear }) {
  const segments = useMemo(() => {
    const all = mousePos ? [...points, mousePos] : points;
    return all.slice(1).map((p, i) => {
      const from = all[i];
      return {
        dist: haversineKm(from.lat, from.lng, p.lat, p.lng),
        isPreview: mousePos && i === all.length - 2,
      };
    });
  }, [points, mousePos]);

  const confirmedTotal = segments.filter(s => !s.isPreview).reduce((s, seg) => s + seg.dist, 0);
  const liveTotal     = segments.reduce((s, seg) => s + seg.dist, 0);

  return (
    <div className="panel-content">
      <div className="measure-actions">
        <button className="measure-action-btn" onClick={onUndo} disabled={points.length === 0}
          title="Undo last point" aria-label="Undo last point">
          <Undo2 size={12} /> Undo
        </button>
        <button className="measure-action-btn" onClick={onClear} title="Clear all" aria-label="Clear all points">
          <Trash2 size={12} /> Clear
        </button>
        {segments.length > 0 && (
          <button className="measure-action-btn" onClick={() => {
            const text = segments.filter(s => !s.isPreview).map((s, i) => `Leg ${i + 1}: ${formatDist(s.dist)}`).join('\n') + `\nTotal: ${formatDist(segments.filter(s => !s.isPreview).reduce((sum, s) => sum + s.dist, 0))}`;
            navigator.clipboard.writeText(text);
          }} title="Copy distances" aria-label="Copy distances to clipboard">
            <ClipboardCopy size={12} /> Copy
          </button>
        )}
      </div>
      {points.length === 0 && <p className="panel-hint">Click on the map to start placing points.</p>}
      {points.length === 1 && <p className="panel-hint">Click again to measure distance.</p>}
      {segments.length > 0 && (
        <div className="measure-segments">
          {segments.map((seg, i) => (
            <div key={i} className={`measure-seg-row ${seg.isPreview ? 'measure-seg-preview' : ''}`}>
              <span className="measure-seg-label">{seg.isPreview ? '→ cursor' : `Leg ${i + 1}`}</span>
              <span className="measure-seg-dist">{formatDist(seg.dist)}</span>
            </div>
          ))}
          <div className="measure-total">
            <span>Total{mousePos ? ' (live)' : ''}</span>
            <strong>{formatDist(liveTotal)}</strong>
          </div>
          {mousePos && confirmedTotal > 0 && (
            <div className="measure-confirmed">
              <span>Confirmed</span><span>{formatDist(confirmedTotal)}</span>
            </div>
          )}
        </div>
      )}
      <div className="measure-footer">
        {points.length} point{points.length !== 1 ? 's' : ''} placed · Press Esc to exit
      </div>
    </div>
  );
}

// ── Analysis Panel (unified) ───────────────────────────────────────────────
function AnalysisPanel({
  panelState, onClose, adjacencyMap,
  proximityResults, proximityRadius, onProximityRadiusChange, onProximityJump,
  measurePoints, measureMousePos, onMeasureUndo, onMeasureClear,
  meteoData, meteoLoading, viabilityResult,
  analysisPhase, viabilityPoint, viabilityConfig, onRunAnalysis, onReconfigure, onNewPin,
  onJumpTo, onMobileBack,
}) {
  const { type, data } = panelState;
  if (!type) return null;

  // Viability panel becomes centered only during analysis & results
  const isCentered = type === 'viability' && (analysisPhase === 'analyzing' || analysisPhase === 'results');
  const isWide = type === 'viability' && analysisPhase === 'results';

  const config = {
    detail:    { icon: 'ℹ️', title: data?.properties?.name || (data?.geometry?.type?.includes('LineString') ? 'Transmission Line' : 'Asset') },
    trace:     { icon: <GitBranch size={14} color="#ffd700" />, title: `Trace: ${data?.subName || ''}` },
    proximity: { icon: <Crosshair size={14} color="#a78bfa" />, title: 'Proximity Scan' },
    viability: { icon: <MapPin size={14} color="#fb923c" />, title: 'Conceptual Analysis' },
    measure:   { icon: <Ruler size={14} color="#34d399" />, title: 'Measure Distance' },
  };
  const { icon, title } = config[type] || {};

  return (
    <>
      {/* Backdrop — dims map when viability is actively calculating or showing results */}
      {isCentered && (
        <div className="panel-backdrop" onClick={onClose} aria-hidden="true" />
      )}

      <div
        className={`analysis-panel glass-panel${isCentered ? ' panel--centered' : ''}${isWide ? ' panel--wide' : ''}`}
        role="region"
        aria-label={`${title} panel`}
      >
        <div className="panel-header">
          {typeof icon === 'string' ? <span>{icon}</span> : icon}
          <span className="panel-title">{title}</span>
          {onMobileBack && (
            <button className="panel-close" onClick={() => { if (window.innerWidth <= 768) onMobileBack(); }} aria-label="Go back to sidebar">
              <ChevronLeft size={13} />
            </button>
          )}
          <button className="panel-close" onClick={onClose} aria-label="Close panel">
            <X size={13} />
          </button>
        </div>

        {type === 'detail' && (
          <>
            {traceInfo && (
              <div style={{ display: 'flex', gap: 6, padding: '6px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                <button
                  className={`chip ${traceTab === 'info' ? 'chip--active' : ''}`}
                  onClick={() => setTraceTab('info')}
                >Info</button>
                <button
                  className={`chip ${traceTab === 'trace' ? 'chip--active' : ''}`}
                  onClick={() => setTraceTab('trace')}
                >Trace</button>
              </div>
            )}
            {traceTab === 'info' ? (
              <DetailContent feature={data} adjacencyMap={adjacencyMap} />
            ) : (
              <TraceContent traceInfo={traceInfo} />
            )}
          </>
        )}
        {type === 'trace' && (
          <TraceContent traceInfo={data} />
        )}
        {type === 'proximity' && (
          <ProximityContent
            results={proximityResults}
            radius={proximityRadius}
            onRadiusChange={onProximityRadiusChange}
            onJumpTo={onJumpTo}
          />
        )}
        {type === 'viability' && (
          <ViabilityContent
            analysisPhase={analysisPhase}
            viabilityPoint={viabilityPoint}
            viabilityConfig={viabilityConfig}
            result={viabilityResult}
            meteoData={meteoData}
            meteoLoading={meteoLoading}
            onRunAnalysis={onRunAnalysis}
            onReconfigure={onReconfigure}
            onNewPin={onNewPin}
          />
        )}
        {type === 'measure' && (
          <MeasureContent
            points={measurePoints} mousePos={measureMousePos}
            onUndo={onMeasureUndo} onClear={onMeasureClear}
          />
        )}
      </div>
    </>
  );
}

// ── Status Strip ───────────────────────────────────────────────────────────
function StatusStrip({ stats, activeTool, onResetHome, regionFilter }) {
  const toolColors  = { measure: '#34d399', proximity: '#a78bfa', viability: '#fb923c' };
  const toolLabels  = { measure: '📐 Measuring', proximity: '🎯 Proximity Mode', viability: '📍 Viability Mode' };

  return (
    <div className="status-strip glass-panel" role="status" aria-live="polite">
      <div className="status-stats">
        {[
          { icon: '⚡', value: `${stats.totalCapMW.toLocaleString()} MW`, label: 'Capacity', color: '#facc15' },
          { icon: '●',  value: `${stats.totalLinKm.toLocaleString()} km`, label: 'Lines',    color: '#3b82f6' },
          { icon: '▲',  value: stats.subCount,                            label: 'Subs',     color: '#a3e635' },
          { icon: '■',  value: stats.plantCount,                          label: 'Plants',   color: '#f97316' },
          { icon: '≡',  value: stats.lineCount,                           label: 'Segs',     color: '#e879f9' },
        ].map((s, i, arr) => (
          <React.Fragment key={i}>
            <div className="stat-item">
              <span style={{ color: s.color, fontSize: '0.9rem' }}>{s.icon}</span>
              <div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            </div>
            {i < arr.length - 1 && <div className="stat-divider" />}
          </React.Fragment>
        ))}
      </div>

      {regionFilter && regionFilter !== 'All' && (
        <span style={{
          fontSize: '0.65rem', color: 'var(--text-muted)',
          background: 'rgba(255,255,255,0.06)', padding: '2px 8px',
          borderRadius: 20, border: '1px solid var(--border-subtle)',
          whiteSpace: 'nowrap',
        }}>📍 {regionFilter}</span>
      )}

      {activeTool ? (
        <div className="status-tool-badge"
          style={{ borderColor: toolColors[activeTool], color: toolColors[activeTool] }}>
          {toolLabels[activeTool]} · Esc to cancel
        </div>
      ) : (
        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Esc to cancel tools</span>
      )}

      <button className="status-home-btn" onClick={onResetHome} title="Reset to Myanmar overview" aria-label="Reset map to overview">
        <Home size={14} />
      </button>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const { logout } = useAuth();
  // ── Core map state
  const [viewState, setViewState]   = useState(INITIAL_VIEW_STATE);
  const [hoverInfo, setHoverInfo]   = useState(null);
  const [hoveredSubId, setHoveredSubId] = useState(null);
  const [mapTheme, setMapTheme]     = useState('light');
  const [geoData, setGeoData]       = useState({ lines: null, substations: null, plants: null, hydro: null, boundaries: null });
  const [adjacencyMap, setAdjacencyMap] = useState({});
  const [dataLoadState, setDataLoadState] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const [loadStep, setLoadStep]     = useState(0);

  // ── UI state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showBoundaries, setShowBoundaries]     = useState(false);
  const [visibleLayers, setVisibleLayers]       = useState({ hydro: false, plants: false, substations: true, lines: true });

  // ── Filter state
  const [regionFilter, setRegionFilter]     = useState('All');
  const [voltageFilters, setVoltageFilters] = useState(new Set(['All']));
  const [fuelFilter, setFuelFilter]         = useState('All');
  const [statusFilter, setStatusFilter]     = useState('All');

  // ── Search state — with keyboard nav
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch]       = useState(false);
  const [activeResultIdx, setActiveResultIdx] = useState(-1);
  const searchRef          = useRef(null);
  const searchContainerRef = useRef(null);
  const hoverTimer = useRef(null);

  // ── Unified tool state (C5 fix: single exclusive enum)
  const [activeTool, setActiveTool] = useState(null); // null | 'measure' | 'proximity' | 'viability'

  // ── Unified analysis panel (C1 fix: single right panel slot)
  const [analysisPanel, setAnalysisPanel] = useState({ type: null, data: null });

  // ── Tool-specific data
  const [measurePoints, setMeasurePoints]   = useState([]);
  const [measureMousePos, setMeasureMousePos] = useState(null);
  const [proximityCenter, setProximityCenter] = useState(null);
  const [proximityRadius, setProximityRadius] = useState(15);
  const [viabilityPoint, setViabilityPoint] = useState(null);
  // ── Analysis phase state machine: idle → configuring → analyzing → results
  const [analysisPhase, setAnalysisPhase]   = useState('idle');
  const [viabilityConfig, setViabilityConfig] = useState(null); // { tech, capMW, mounting }
  const [meteoData, setMeteoData]     = useState(null);
  const [meteoLoading, setMeteoLoading] = useState(false);
  const [traceInfo, setTraceInfo]     = useState(null); // keeps map highlight data
  const [traceTab, setTraceTab]     = useState('info');

  // ── Activate / deactivate a tool (exclusive) ──────────────────────────────
  const switchTool = useCallback((tool) => {
    setActiveTool(prev => {
      const next = prev === tool ? null : tool; // toggle off if same tool
      // Reset all tool-specific state
      setMeasurePoints([]);
      setProximityCenter(null);
      setViabilityPoint(null);
      setAnalysisPhase('idle');
      setViabilityConfig(null);
      setMeteoData(null);
      setTraceInfo(null);
      // Open measure panel immediately; others wait for a map click
      if (next === 'measure') {
        setAnalysisPanel({ type: 'measure', data: null });
      } else {
        setAnalysisPanel({ type: null, data: null });
      }
      return next;
    });
  }, []);

  // ── Global ESC key ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setActiveTool(null);
        setMeasurePoints([]);
        setProximityCenter(null);
        setViabilityPoint(null);
        setAnalysisPhase('idle');
        setViabilityConfig(null);
        setMeteoData(null);
        setShowSearch(false);
        setSearchQuery('');
        setSearchResults([]);
        setAnalysisPanel({ type: null, data: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Outside-click dismiss for search (H2 fix) ──────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowSearch(false);
        setActiveResultIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // TODO / KNOWN ISSUE — Viability Meteo Fetch Race Condition
  //
  // Symptom: Monthly bar charts (PV & Wind) in ViabilityContent fail to render
  // even though meteoData contains valid solarMonthly (Array[12]) and
  // windMonthly (Array[12]) — confirmed via console logs:
  //   [meteo] solarYield: 1493 | solarMonthly: Array(12) | ws100: 4.45 | windMonthly: Array(12)
  //
  // The data arrives correctly. MiniBarChart receives non-null arrays with
  // positive values. Yet the bars never render — the chart returns null
  // silently despite hasData=true and max>0 in the component.
  //
  // Suspected causes (not yet confirmed):
  //   a) React render cycle mismatch — ViabilityContent re-renders before
  //      setMeteoData completes, reading stale undefined values
  //   b) useMemo dependency chain — solarMonthlyScaled/windMonthlyScaled are
  //      computed from meteoData but may not trigger re-render correctly
  //   c) CSS / flexbox overflow — .mini-bar-chart container may be clipping
  //      or have zero height in the viability panel scroll context
  //   d) Promise.all race — earlier fetch for a different location resolves
  //      AFTER a later fetch, overwriting valid data with stale nulls
  //   e) Vite proxy timing — concurrent proxy requests may interfere
  //
  // Workaround applied so far:
  //   - Click debounce: meteoLoading guard in handleMapClick prevents
  //     re-entrant fetches during pending requests
  //   - cancelled flag in useEffect to skip stale closures
  //   - Explicit null guard on meteoData.windMonthly in JSX
  //
  // Remaining action: add fetch-id monotonic counter to discard out-of-order
  // responses, or move meteo fetch to a useReducer with action queue to
  // guarantee sequential state updates. Also inspect panel CSS for overflow
  // and height constraints on .mini-bar-chart.
  // ─────────────────────────────────────────────────────────────────────────────
  // ── Analysis run (fired from ConfigPanel "Run Analysis" button) ─────────────
  const handleRunAnalysis = useCallback((config) => {
    setViabilityConfig(config);
    setAnalysisPhase('analyzing');
    setMeteoData(null);
    setMeteoLoading(true);
  }, []);

  const handleReconfigure = useCallback(() => {
    setAnalysisPhase('configuring');
    setMeteoData(null);
    setMeteoLoading(false);
  }, []);

  const handleNewPin = useCallback(() => {
    setViabilityPoint(null);
    setAnalysisPhase('idle');
    setViabilityConfig(null);
    setMeteoData(null);
    setMeteoLoading(false);
  }, []);

  // ── Meteo + terrain fetch — fires only when phase === 'analyzing' ──────────
  useEffect(() => {
    if (analysisPhase !== 'analyzing' || !viabilityPoint || !viabilityConfig) return;
    const { lat, lng } = viabilityPoint;
    const { mounting } = viabilityConfig;
    let cancelled = false;

    // Date range: trailing 12 months, offset by 7 days to account for ERA5 lag
    const endDate   = new Date();
    endDate.setDate(endDate.getDate() - 7);
    const startDate = new Date(endDate);
    startDate.setFullYear(startDate.getFullYear() - 1);
    const fmt = (d) => d.toISOString().slice(0, 10);

    // ── PVWatts — array_type=2 for single-axis tracking, 0 for fixed ────────
    const arrayType = mounting === 'tracking' ? 2 : 0;
    const pvwUrl = `/api/pvwatts/v8.json?api_key=${import.meta.env.VITE_PVWATTS_API_KEY}&lat=${lat}&lon=${lng}&system_capacity=1&module_type=0&losses=14&array_type=${arrayType}&tilt=15&azimuth=180&dataset=nsrdb&radius=100`;

    // ── Open-Meteo: 3×3 grid elevation (9 points, spacing 0.001°≈110m) ─────
    const s = 0.001;
    const latGrid = [lat, lat+s, lat-s, lat,   lat,   lat+s, lat+s, lat-s, lat-s].join(',');
    const lngGrid = [lng, lng,   lng,   lng+s, lng-s, lng+s, lng-s, lng+s, lng-s].join(',');
    const elevUrl = `/api/openmeteo/v1/elevation?latitude=${latGrid}&longitude=${lngGrid}`;

    // ── Open-Meteo Archive: hourly wind_speed_100m for past year ─────────────
    const windUrl = `/api/meteo-archive/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${fmt(startDate)}&end_date=${fmt(endDate)}&hourly=wind_speed_10m,wind_speed_100m&wind_speed_unit=ms&timezone=auto&timeformat=unixtime`;

    Promise.all([
      fetch(pvwUrl).then(r => r.json()).catch(() => null),
      fetch(elevUrl).then(r => r.json()).catch(() => null),
      fetch(windUrl).then(r => r.json()).catch(() => null),
    ]).then(([pvwatts, elev, windArchive]) => {
      if (cancelled) return;

      // ── Solar from PVWatts V8 ──────────────────────────────────────────────
      let solarYield = null, solarMonthly = null;
      try {
        solarYield   = pvwatts?.outputs?.ac_annual ?? null;
        solarMonthly = pvwatts?.outputs?.ac_monthly ?? null;
      } catch (e) { console.error('PVWatts error', e); }

      // ── Slope from 3×3 elevation grid — max of 8 directional gradients ────
      // Points: [0]=center, [1]=N, [2]=S, [3]=E, [4]=W, [5]=NE, [6]=NW, [7]=SE, [8]=SW
      let slopeMax = null, slopeAspect = null;
      try {
        const elevs = elev?.elevation;
        if (elevs?.length === 9) {
          const [c, n, sv, e, w, ne, nw, se, sw] = elevs;
          const spacing = 110; // metres per 0.001°
          const slopes = [
            Math.abs(n  - c) / spacing,
            Math.abs(sv - c) / spacing,
            Math.abs(e  - c) / spacing,
            Math.abs(w  - c) / spacing,
            Math.abs(ne - c) / (spacing * Math.SQRT2),
            Math.abs(nw - c) / (spacing * Math.SQRT2),
            Math.abs(se - c) / (spacing * Math.SQRT2),
            Math.abs(sw - c) / (spacing * Math.SQRT2),
          ];
          const maxIdx = slopes.indexOf(Math.max(...slopes));
          slopeMax = Math.round(Math.max(...slopes) * 10000) / 100; // → %
          // Rough aspect from dominant direction
          const aspects = ['N','S','E','W','NE','NW','SE','SW'];
          slopeAspect = aspects[maxIdx] ?? null;
        }
      } catch { /* elev api miss */ }

      // ── Wind from Open-Meteo Archive ──────────────────────────────────────
      let ws100ann = null, windMonthly = null;
      try {
        const hourly = windArchive?.hourly;
        const times  = hourly?.time ?? [];
        const speeds = hourly?.wind_speed_100m ?? [];
        if (speeds.length > 0) {
          ws100ann = speeds.reduce((s, v) => s + v, 0) / speeds.length;
          const monthAccum = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }));
          times.forEach((t, i) => {
            const mo = new Date(t * 1000).getMonth();
            if (!isNaN(mo) && speeds[i] != null) {
              monthAccum[mo].sum += speeds[i];
              monthAccum[mo].count++;
            }
          });
          windMonthly = monthAccum.map(m => m.count > 0 ? Math.round(m.sum / m.count * 100) / 100 : null);
        }
      } catch { /* wind api miss */ }

      // ── Road distance — query local MIMU GeoJSON via Turf.js ─────────────
      let roadDistKm = null;
      try {
        if (geoData.roads?.features?.length) {
          const pt = turf.point([lng, lat]);
          const relevantRoads = geoData.roads.features.filter(f =>
            f.properties.Road_Type === 'Main' || f.properties.Road_Type === 'Secondary'
          );
          let minDist = Infinity;
          relevantRoads.forEach(f => {
            try {
              const d = turf.pointToLineDistance(pt, f, { units: 'kilometers' });
              if (d < minDist) minDist = d;
            } catch { /* invalid geom */ }
          });
          if (minDist < Infinity) roadDistKm = Math.round(minDist * 10) / 10;
        }
      } catch { /* turf error */ }

      setMeteoData({ solarYield, solarMonthly, ws100: ws100ann, windMonthly, slopeMax, slopeAspect, roadDistKm });
      setMeteoLoading(false);
      setAnalysisPhase('results');
    }).catch((err) => {
      if (!cancelled) {
        console.error('[meteo] fetch error:', err);
        setMeteoData(null);
        setMeteoLoading(false);
        setAnalysisPhase('results'); // show dashboard even on partial failure
      }
    });
    return () => { cancelled = true; };
  }, [analysisPhase, viabilityPoint, viabilityConfig, geoData.roads]);

  // ── Data fetch with per-file progress ──────────────────────────────────────
  useEffect(() => {
    const urls = [
      '/data/myanmar_transmission_lines_final.geojson',
      '/data/myanmar_substations_final.geojson',
      '/data/myanmar_powerplants_final.geojson',
      '/data/myanmar_hydrodams_final.geojson',
      '/data/myanmar_admin1_boundaries.geojson',
      '/data/myanmar_roads_final.geojson',
    ];
    let step = 0;
    const results = Array(urls.length).fill(null);
    let hasError = false;
    Promise.all(
      urls.map((url, i) =>
        fetch(url).then(r => r.json())
          .then(d => { results[i] = d; setLoadStep(++step); })
          .catch(() => { hasError = true; setLoadStep(++step); })
      )
    ).then(() => {
      const [lines, substations, plants, hydro, boundaries, roads] = results;
      setGeoData({ lines, substations, plants, hydro, boundaries, roads });
      // Build adjacency map for connectivity tracing
      const adj = {};
      (lines?.features || []).forEach(f => {
        const { from_sub_id, to_sub_id } = f.properties;
        if (from_sub_id && to_sub_id) {
          if (!adj[from_sub_id]) adj[from_sub_id] = [];
          if (!adj[to_sub_id])   adj[to_sub_id]   = [];
          adj[from_sub_id].push({ lineFeature: f, otherSubId: to_sub_id });
          adj[to_sub_id].push({ lineFeature: f, otherSubId: from_sub_id });
        }
      });
      setAdjacencyMap(adj);
      setDataLoadState(hasError ? 'error' : 'loaded');
    });
  }, []);

  // ── Voltage chip toggle ────────────────────────────────────────────────────
  const toggleVoltageChip = useCallback((kv) => {
    setVoltageFilters(prev => {
      const next = new Set(prev);
      if (kv === 'All') return new Set(['All']);
      next.delete('All');
      if (next.has(kv)) { next.delete(kv); if (next.size === 0) return new Set(['All']); }
      else next.add(kv);
      return next;
    });
  }, []);

  // C6 fix: voltage filter ranges now perfectly mirror getVoltageColor ranges
  const matchesVoltage = useCallback((f) => {
    if (voltageFilters.has('All')) return true;
    const v = f.properties.voltage_kv;
    return [...voltageFilters].some(chip => {
      if (chip === '500') return v >= 500;
      if (chip === '230') return v >= 230 && v < 500;
      if (chip === '132') return v >= 132 && v < 230;
      if (chip === '66')  return v >= 66  && v < 132;
      if (chip === '33')  return v > 0    && v < 66;  // catches 33 kV and 11 kV
      return false;
    });
  }, [voltageFilters]);

  // ── Search with keyboard nav (H1 + H2 fix) ────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]); setActiveResultIdx(-1); return;
    }
    const q = searchQuery.toLowerCase();
    const subs  = (geoData.substations?.features || [])
      .filter(f => f.properties.name?.toLowerCase().includes(q)).slice(0, 5)
      .map(f => ({ ...f, _layer: 'substation' }));
    const plnts = (geoData.plants?.features || [])
      .filter(f => f.properties.name?.toLowerCase().includes(q) && f.properties.name_quality !== 'placeholder').slice(0, 4)
      .map(f => ({ ...f, _layer: 'plant' }));
    const hydro = (geoData.hydro?.features || [])
      .filter(f => f.properties.name?.toLowerCase().includes(q)).slice(0, 3)
      .map(f => ({ ...f, _layer: 'hydro' }));
    setSearchResults([...subs, ...plnts, ...hydro].slice(0, 8));
    setActiveResultIdx(-1);
  }, [searchQuery, geoData]);

  // ── jumpToFeature must be declared before handleSearchKeyDown (TDZ fix) ──
  const jumpToFeature = useCallback((feature) => {
    const coords = feature.geometry.coordinates;
    setViewState(prev => ({
      ...prev, longitude: coords[0], latitude: coords[1], zoom: 10,
      transitionDuration: 1200, transitionInterpolator: new FlyToInterpolator({ speed: 1.5 }),
    }));
    setSearchQuery(''); setSearchResults([]); setShowSearch(false); setActiveResultIdx(-1);
  }, []);

  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveResultIdx(i => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveResultIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeResultIdx >= 0 ? searchResults[activeResultIdx] : searchResults[0];
      if (target) jumpToFeature(target);
    } else if (e.key === 'Escape') {
      setShowSearch(false);
      setActiveResultIdx(-1);
    }
  }, [searchResults, activeResultIdx, jumpToFeature]);

  // ── Filtered data ──────────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    const fR = (f) => regionFilter === 'All' || f.properties.state_region === regionFilter || f.properties.region === regionFilter;
    const fF = (f) => fuelFilter === 'All' || f.properties.fuel_type?.toLowerCase() === fuelFilter;
    const fS = (f) => statusFilter === 'All' || f.properties.operational_status === statusFilter;
    return {
      lines:       geoData.lines       ? { ...geoData.lines,       features: geoData.lines.features.filter(f => fR(f) && matchesVoltage(f)) } : null,
      substations: geoData.substations ? { ...geoData.substations, features: geoData.substations.features.filter(f => fR(f) && matchesVoltage(f)) } : null,
      plants:      geoData.plants      ? { ...geoData.plants,      features: geoData.plants.features.filter(f => fR(f) && fF(f) && fS(f)) } : null,
      hydro:       geoData.hydro       ? { ...geoData.hydro,       features: geoData.hydro.features.filter(f => fR(f) && fF(f) && fS(f)) } : null,
    };
  }, [geoData, regionFilter, fuelFilter, statusFilter, matchesVoltage]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const plantCap = (filteredData.plants?.features || []).reduce((s, f) => s + (f.properties.capacity || 0), 0);
    const hydroCap = (filteredData.hydro?.features  || []).reduce((s, f) => s + (f.properties.capacity || 0), 0);
    const totalLen = (filteredData.lines?.features  || []).reduce((s, f) => s + (f.properties.length_km || 0), 0);
    const fuelMap = {};
    [...(filteredData.plants?.features || []), ...(filteredData.hydro?.features || [])].forEach(f => {
      const ft = (f.properties.fuel_type || 'unknown').toLowerCase();
      fuelMap[ft] = (fuelMap[ft] || 0) + (f.properties.capacity || 0);
    });
    const donutData = Object.entries(fuelMap).sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), value, color: DONUT_COLORS[label] || DONUT_COLORS.default }));
    return {
      totalCapMW: Math.round(plantCap + hydroCap),
      totalLinKm: Math.round(totalLen),
      subCount:   filteredData.substations?.features?.length ?? 0,
      plantCount: (filteredData.plants?.features?.length ?? 0) + (filteredData.hydro?.features?.length ?? 0),
      lineCount:  filteredData.lines?.features?.length ?? 0,
      donutData,
      layerCounts: {
        lines:       filteredData.lines?.features?.length ?? 0,
        substations: filteredData.substations?.features?.length ?? 0,
        plants:      filteredData.plants?.features?.length ?? 0,
        hydro:       filteredData.hydro?.features?.length ?? 0,
      },
    };
  }, [filteredData]);

  const layerCounts = useMemo(() => ({
    lines: filteredData.lines?.features?.length ?? 0,
    substations: filteredData.substations?.features?.length ?? 0,
    plants: filteredData.plants?.features?.length ?? 0,
    hydro: filteredData.hydro?.features?.length ?? 0,
  }), [filteredData]);

  // ── Proximity results ──────────────────────────────────────────────────────
  const proximityResults = useMemo(() => {
    if (!proximityCenter) return [];
    const { lng, lat } = proximityCenter;
    return [
      ...(geoData.substations?.features || []),
      ...(geoData.plants?.features || []),
      ...(geoData.hydro?.features || []),
    ].map(f => {
      const coords = getPointCoords(f);
      if (!coords) return null;
      const dist = haversineKm(lat, lng, coords[1], coords[0]);
      return dist <= proximityRadius ? { props: f.properties, dist, feature: f } : null;
    }).filter(Boolean).sort((a, b) => a.dist - b.dist);
  }, [proximityCenter, proximityRadius, geoData]);

  // ── Viability result — spatial query using Turf.js ─────────────────────────
  const viabilityResult = useMemo(() => {
    if (!viabilityPoint || !geoData.substations || !geoData.lines) return null;
    const { lng, lat } = viabilityPoint;
    const pt = turf.point([lng, lat]);

    // ── Nearest substation ────────────────────────────────────────────────────
    let nearestSub = null, minSubDist = Infinity;
    (geoData.substations.features || []).forEach(f => {
      const coords = getPointCoords(f);
      if (coords) {
        const d = turf.distance(pt, turf.point(coords), { units: 'kilometers' });
        if (d < minSubDist) { minSubDist = d; nearestSub = f; }
      }
    });

    // ── Nearest transmission line (vertex scan + Turf for accuracy) ───────────
    let nearestLine = null, minLineDist = Infinity, nearestLinePoint = null;
    (geoData.lines.features || []).forEach(f => {
      try {
        const d = turf.pointToLineDistance(pt, f, { units: 'kilometers' });
        if (d < minLineDist) {
          minLineDist = d;
          nearestLine = f;
          // Nearest vertex for the connector line on the map
          const coords = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat();
          let minV = Infinity, nearestVtx = null;
          coords.forEach(c => {
            const dv = haversineKm(lat, lng, c[1], c[0]);
            if (dv < minV) { minV = dv; nearestVtx = { lng: c[0], lat: c[1] }; }
          });
          nearestLinePoint = nearestVtx;
        }
      } catch { /* skip invalid geometry */ }
    });

    const subVoltage  = nearestSub  ? (nearestSub.properties.voltage_kv  || 0) : 0;
    const lineVoltage = nearestLine ? (nearestLine.properties.voltage_kv || 0) : 0;
    const subName     = nearestSub?.properties?.name || null;

    return {
      subDist: minSubDist, subName, subVoltage,
      lineDist: minLineDist, lineVoltage, linePoint: nearestLinePoint,
      targetPoint: { lng, lat },
    };
  }, [viabilityPoint, geoData.substations, geoData.lines]);

  // ── Map click handler ──────────────────────────────────────────────────────
  const handleMapClick = useCallback((info) => {
    if (activeTool === 'measure') {
      const coord = info.coordinate;
      if (coord) setMeasurePoints(prev => [...prev, { lng: coord[0], lat: coord[1] }]);
      return;
    }
    if (activeTool === 'proximity') {
      const { coordinate } = info;
      if (coordinate) {
        const center = { lng: coordinate[0], lat: coordinate[1] };
        setProximityCenter(center);
        setAnalysisPanel({ type: 'proximity', data: center });
        if (window.innerWidth <= 768) setSidebarCollapsed(true);
      }
      return;
    }
    if (activeTool === 'viability') {
      const { coordinate } = info;
      if (coordinate && analysisPhase === 'idle') {
        // Stage 1: drop pin → open config panel
        setViabilityPoint({ lng: coordinate[0], lat: coordinate[1] });
        setAnalysisPhase('configuring');
        setMeteoData(null);
        setAnalysisPanel({ type: 'viability', data: null });
        if (window.innerWidth <= 768) setSidebarCollapsed(true);
      }
      return;
    }
    // Normal click-to-inspect mode
    if (!info.object) {
      setTraceInfo(null);
      setAnalysisPanel({ type: null, data: null });
      return;
    }
    const props = info.object.properties;
    if (props.type === 'substation') {
      const connections = adjacencyMap[props.id] || [];
      const ti = {
        subId: props.id, subName: props.name,
        connectedLines: connections.map(c => c.lineFeature),
        connectedSubIds: [...new Set(connections.map(c => c.otherSubId))],
        totalTracedKm: Math.round(connections.reduce((s, c) => s + (c.lineFeature.properties.length_km || 0), 0) * 10) / 10,
      };
      setTraceInfo(ti);
      // Show detail by default; 'trace' tab available as a second content block
      setAnalysisPanel({ type: 'detail', data: info.object });
      if (window.innerWidth <= 768) setSidebarCollapsed(true);
    } else {
      setTraceInfo(null);
      setAnalysisPanel({ type: 'detail', data: info.object });
      if (window.innerWidth <= 768) setSidebarCollapsed(true);
    }
  }, [activeTool, adjacencyMap]);


  const resetHome = useCallback(() => {
    setViewState({
      ...INITIAL_VIEW_STATE,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.5 }),
    });
  }, []);

  const handlePanelClose = useCallback(() => {
    setAnalysisPanel({ type: null, data: null });
    setTraceInfo(null);
    if (activeTool === 'measure')   { setMeasurePoints([]); setActiveTool(null); }
    if (activeTool === 'proximity') { setProximityCenter(null); setActiveTool(null); }
    if (activeTool === 'viability') {
      setViabilityPoint(null); setMeteoData(null); setMeteoLoading(false);
      setAnalysisPhase('idle'); setViabilityConfig(null);
      setActiveTool(null);
    }
  }, [activeTool]);

  // ── Layer computation ──────────────────────────────────────────────────────
  const isMeasureMode = activeTool === 'measure';
  const traceLineData = useMemo(() => traceInfo ? { type: 'FeatureCollection', features: traceInfo.connectedLines } : null, [traceInfo]);
  const traceSubData  = useMemo(() => {
    if (!traceInfo || !geoData.substations) return null;
    return { type: 'FeatureCollection', features: geoData.substations.features.filter(f => traceInfo.connectedSubIds.includes(f.properties.id)) };
  }, [traceInfo, geoData.substations]);
  const circleData = useMemo(() => proximityCenter ? makeCircleGeoJSON(proximityCenter.lng, proximityCenter.lat, proximityRadius) : null, [proximityCenter, proximityRadius]);
  const measureLineData = useMemo(() => {
    const pts = measureMousePos && isMeasureMode ? [...measurePoints, measureMousePos] : measurePoints;
    if (pts.length < 2) return null;
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) }, properties: {} };
  }, [measurePoints, measureMousePos, isMeasureMode]);

  const layers = useMemo(() => [
    showBoundaries && geoData.boundaries && new GeoJsonLayer({ id: 'admin-boundaries', data: geoData.boundaries, pickable: false, stroked: true, filled: true, getFillColor: (d, { index }) => STATE_FILL_COLORS[index % STATE_FILL_COLORS.length], getLineColor: [100, 120, 160, 200], lineWidthMinPixels: 1.5, getLineWidth: 2 }),
    new GeoJsonLayer({ id: 'transmission-lines', data: filteredData.lines, visible: visibleLayers.lines, pickable: !isMeasureMode, stroked: false, filled: false, lineWidthScale: 20, lineWidthMinPixels: 1, lineWidthMaxPixels: 5, getLineColor: d => getVoltageColor(d.properties.voltage_kv), getLineWidth: d => { const v = d.properties.voltage_kv; if (v >= 500) return 6; if (v >= 230) return 4; if (v >= 132) return 2.5; if (v >= 66) return 1.5; return 1; }, onHover: info => setHoverInfo(info) }),
    traceLineData && new GeoJsonLayer({ id: 'trace-lines', data: traceLineData, pickable: false, stroked: false, filled: false, lineWidthMinPixels: 3, lineWidthMaxPixels: 8, getLineColor: [255, 210, 0, 240], getLineWidth: 8 }),
    circleData && new GeoJsonLayer({ id: 'proximity-circle', data: circleData, pickable: false, stroked: true, filled: true, getFillColor: [167, 139, 250, 18], getLineColor: [167, 139, 250, 220], lineWidthMinPixels: 2, getLineWidth: 2 }),
    proximityCenter && new ScatterplotLayer({ id: 'proximity-center', data: [proximityCenter], pickable: false, getPosition: d => [d.lng, d.lat], getRadius: 6, radiusUnits: 'pixels', getFillColor: [167, 139, 250, 255], getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 2, stroked: true }),
    measureLineData && new GeoJsonLayer({ id: 'measure-line', data: measureLineData, pickable: false, stroked: true, filled: false, getLineColor: [52, 211, 153, 240], lineWidthMinPixels: 2, getLineWidth: 3 }),
    measurePoints.length > 0 && new ScatterplotLayer({ id: 'measure-points', data: measurePoints.map((p, i) => ({ ...p, i })), pickable: false, getPosition: d => [d.lng, d.lat], getRadius: 6, radiusUnits: 'pixels', getFillColor: d => d.i === 0 ? [52, 211, 153, 255] : [255, 255, 255, 255], getLineColor: [52, 211, 153, 255], lineWidthMinPixels: 1.5, stroked: true }),
    new GeoJsonLayer({ id: 'substations', data: filteredData.substations, visible: visibleLayers.substations, pickable: !isMeasureMode, pointType: 'icon', getIcon: d => mkTriangle(rgbToHex(getVoltageColor(d.properties.voltage_kv))), getIconSize: d => Math.max(12, Math.min(22, 10 + (d.properties.voltage_kv || 0) * 0.03)), onHover: info => { setHoverInfo(info); setHoveredSubId(info.object?.properties?.type === 'substation' ? info.object.properties.id : null); } }),
    traceSubData && new GeoJsonLayer({ id: 'trace-substations', data: traceSubData, pickable: false, pointType: 'icon', getIcon: () => mkTriGlow(), getIconSize: 28 }),
    new GeoJsonLayer({ id: 'power-plants', data: filteredData.plants, visible: visibleLayers.plants, pickable: !isMeasureMode, pointType: 'icon', getIcon: d => mkPlantIcon(rgbToHex(FUEL_COLORS[d.properties.fuel_type?.toLowerCase()] || FUEL_COLORS.default), d.properties.fuel_type), getIconSize: d => Math.max(12, Math.min(24, 10 + Math.sqrt(d.properties.capacity || 0) * 1.5)), onHover: info => setHoverInfo(info) }),
    new GeoJsonLayer({ id: 'hydro-dams', data: filteredData.hydro, visible: visibleLayers.hydro, pickable: !isMeasureMode, pointType: 'icon', getIcon: () => mkPlantIcon(rgbToHex(FUEL_COLORS.hydro), 'hydro'), getIconSize: d => Math.max(12, Math.min(26, 12 + Math.sqrt(d.properties.capacity || 0) * 1.2)), onHover: info => setHoverInfo(info) }),
    viabilityResult && viabilityResult.linePoint && new GeoJsonLayer({
      id: 'viability-connecting-lines',
      data: {
        type: 'FeatureCollection', features: [
          { type: 'Feature', geometry: { type: 'LineString', coordinates: [[viabilityResult.targetPoint.lng, viabilityResult.targetPoint.lat], [viabilityResult.linePoint.lng, viabilityResult.linePoint.lat]] }, properties: {} },
        ].filter(Boolean),
      },
      pickable: false, getLineColor: [251, 146, 60, 180], lineWidthMinPixels: 1.5, getLineWidth: 2,
    }),
    viabilityPoint && new ScatterplotLayer({
      id: 'viability-center', data: [viabilityPoint], pickable: false,
      getPosition: d => [d.lng, d.lat], getRadius: 8, radiusUnits: 'pixels',
      getFillColor: [251, 146, 60, 255], getLineColor: [255, 255, 255, 255],
      lineWidthMinPixels: 2, stroked: true,
    }),
  ].filter(Boolean), [filteredData, visibleLayers, showBoundaries, isMeasureMode, traceLineData, traceSubData, circleData, proximityCenter, measureLineData, measurePoints, viabilityResult, viabilityPoint, adjacencyMap, geoData.boundaries]);

  // ── Tooltip render (with viewport-edge clamping — M6 fix) ─────────────────
  const renderTooltip = () => {
    if (!hoverInfo?.object || isMeasureMode) return null;
    const { object, x, y } = hoverInfo;
    const p = object.properties;
    const isLine = object.geometry.type.includes('LineString');
    const isSub  = p.type === 'substation';
    // Clamp so tooltip never clips at viewport edges
    const safeX = Math.max(150, Math.min(x, window.innerWidth - 150));
    return (
      <div className="custom-tooltip glass-panel" style={{ left: safeX, top: y }}>
        <div className="tooltip-title">{p.name || (isLine ? 'Transmission Line' : 'Asset')}</div>
        {isLine ? (<>
          <div className="tooltip-row"><span className="tooltip-label">Voltage</span><span className="tooltip-value">{p.voltage_kv ? `${p.voltage_kv} kV` : 'N/A'}</span></div>
          <div className="tooltip-row"><span className="tooltip-label">Length</span><span className="tooltip-value">{p.length_km ? `${p.length_km} km` : 'N/A'}</span></div>
        </>) : isSub ? (<>
          <div className="tooltip-row"><span className="tooltip-label">Voltage</span><span className="tooltip-value">{p.voltage_kv || 'N/A'} kV</span></div>
          <div className="tooltip-row"><span className="tooltip-label">Connections</span><span className="tooltip-value">{(adjacencyMap[p.id] || []).length} lines</span></div>
          <div className="tooltip-hint">Click to trace & inspect</div>
        </>) : (<>
          <div className="tooltip-row"><span className="tooltip-label">Fuel</span><span className="tooltip-value" style={{ textTransform: 'capitalize' }}>{p.fuel_type || 'Unknown'}</span></div>
          <div className="tooltip-row"><span className="tooltip-label">Capacity</span><span className="tooltip-value">{p.capacity ? `${p.capacity} MW` : 'N/A'}</span></div>
          <div className="tooltip-hint">Click to inspect & copy</div>
        </>)}
        <div className="tooltip-row" style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px' }}>
          <span className="tooltip-label">Region</span>
          <span className="tooltip-value">{p.state_region || p.region || '–'}</span>
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Loading overlay — shows for 'loading' and 'error' states */}
      {dataLoadState !== 'loaded' && (
        <LoadingOverlay step={loadStep} total={6} error={dataLoadState === 'error'} />
      )}

      {/* Map canvas */}
      <div className="map-container">
        <DeckGL
          viewState={viewState}
          onViewStateChange={({ viewState: vs }) => setViewState(vs)}
          controller={isMeasureMode ? { doubleClickZoom: false } : true}
          layers={layers}
          onClick={handleMapClick}
          getTooltip={() => null}
          onHover={(info) => {
            clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => {
              if (!isMeasureMode) setHoverInfo(info);
            }, 40);
            if (info.coordinate) setMeasureMousePos({ lng: info.coordinate[0], lat: info.coordinate[1] });
          }}
          getCursor={({ isHovering }) =>
            (isMeasureMode || activeTool === 'proximity' || activeTool === 'viability')
              ? 'crosshair' : (isHovering ? 'pointer' : 'grab')
          }
        >
          <Map mapStyle={MAP_STYLES[mapTheme]} reuseMaps>
            <NavigationControl position="top-right" />
          </Map>
          {renderTooltip()}
        </DeckGL>
      </div>

      {/* Persistent substation trace hint */}
      {hoveredSubId && !activeTool && !analysisPanel.open && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)',
          color: '#ffd700', padding: '6px 16px', borderRadius: 20, fontSize: '0.75rem',
          zIndex: 9, pointerEvents: 'none', animation: 'fadeUp 0.18s ease-out',
          whiteSpace: 'nowrap',
        }}>
          Click substation to trace connectivity
        </div>
      )}

      {/* Sidebar */}
      <nav className={`sidebar glass-panel ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}
        aria-label="Map controls">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed(v => !v)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>

        {!sidebarCollapsed && (
          <div className="sidebar-content">
            {/* Branding */}
            <div className="header">
              <div className="header-text">
                <h1>Myanmar Power Grid</h1>
                <p>Interactive Infrastructure Map</p>
              </div>
            </div>

            {/* Search */}
            <div className="search-container" ref={searchContainerRef}>
              <div className="search-input-wrap">
                <Search size={14} className="search-icon" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="text"
                  className="search-input"
                  placeholder="Search substations, plants…"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setShowSearch(true); }}
                  onFocus={() => setShowSearch(true)}
                  onKeyDown={handleSearchKeyDown}
                  role="combobox"
                  aria-expanded={showSearch && searchResults.length > 0}
                  aria-autocomplete="list"
                  aria-controls="search-listbox"
                  aria-activedescendant={activeResultIdx >= 0 ? `search-result-${activeResultIdx}` : undefined}
                  aria-label="Search map assets"
                />
                {searchQuery && (
                  <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearch(false); }} aria-label="Clear search">
                    <X size={12} />
                  </button>
                )}
              </div>
              {showSearch && searchResults.length > 0 && (
                <div className="search-results glass-panel" id="search-listbox" role="listbox" aria-label="Search results">
                  {searchResults.map((f, i) => (
                    <div
                      key={i}
                      id={`search-result-${i}`}
                      className={`search-result-item ${i === activeResultIdx ? 'search-result-item--active' : ''}`}
                      onClick={() => jumpToFeature(f)}
                      role="option"
                      aria-selected={i === activeResultIdx}
                      tabIndex={-1}
                    >
                      <span className="search-result-type">{f._layer === 'substation' ? <Triangle size={11} color="#94a3b8" /> : f._layer === 'hydro' ? <Droplets size={11} color="#3b82f6" /> : <Zap size={11} color="#facc15" />} {f._layer}</span>
                      <span className="search-result-name">{f.properties.name}</span>
                      <span className="search-result-region">{f.properties.state_region || ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Jurisdiction */}
            <div className="filter-group">
              <label className="filter-label" htmlFor="region-filter">Jurisdiction</label>
              <select id="region-filter" className="dropdown" value={regionFilter} onChange={e => setRegionFilter(e.target.value)}>
                <option value="All">All Regions / States</option>
                {['Ayeyarwady','Bago','Chin','Kachin','Kayah','Kayin','Magway','Mandalay','Mon','Naypyitaw','Rakhine','Sagaing','Shan','Tanintharyi','Yangon'].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Reset all filters */}
            {(regionFilter !== 'All' || !voltageFilters.has('All') || fuelFilter !== 'All' || statusFilter !== 'All') && (
              <button
                style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 'var(--text-xs)', cursor: 'pointer', textAlign: 'left', padding: '2px 0' }}
                onClick={() => {
                  setRegionFilter('All');
                  setVoltageFilters(new Set(['All']));
                  setFuelFilter('All');
                  setStatusFilter('All');
                }}
              >
                Reset all filters
              </button>
            )}

            {/* Voltage chips */}
            <div className="filter-group filter-group--sm">
              <label className="filter-label">Voltage (Lines & Subs)</label>
              <div className="chip-row" role="group" aria-label="Voltage filter">
                <button className={`chip ${voltageFilters.has('All') ? 'chip--active chip--all' : ''}`}
                  onClick={() => setVoltageFilters(new Set(['All']))} aria-pressed={voltageFilters.has('All')}>All</button>
                {[
                  { kv: '500', c: 'rgb(255,105,180)' },
                  { kv: '230', c: 'rgb(239,68,68)' },
                  { kv: '132', c: 'rgb(59,130,246)' },
                  { kv: '66',  c: 'rgb(34,197,94)' },
                  { kv: '33',  c: 'rgb(156,163,175)' },
                ].map(({ kv, c }) => (
                  <button key={kv}
                    className={`chip ${voltageFilters.has(kv) ? 'chip--active' : ''}`}
                    style={voltageFilters.has(kv) ? { borderColor: c, background: c + '33', color: '#fff' } : {}}
                    onClick={() => toggleVoltageChip(kv)}
                    aria-pressed={voltageFilters.has(kv)}>
                    {kv} kV
                  </button>
                ))}
              </div>
            </div>

            {/* Fuel & Status */}
            <div className="filter-group filter-group--sm">
              <label className="filter-label" htmlFor="fuel-filter">Fuel (Plants)</label>
              <select id="fuel-filter" className="dropdown" value={fuelFilter} onChange={e => setFuelFilter(e.target.value)}>
                <option value="All">All Fuels</option>
                {['gas','hydro','solar','coal','wind'].map(f => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="filter-group filter-group--sm">
              <label className="filter-label" htmlFor="status-filter">Status (Plants)</label>
              <select id="status-filter" className="dropdown" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="All">All Status</option>
                <option value="operational">Operational</option>
                <option value="planned">Planned</option>
                <option value="under_construction">Under Construction</option>
              </select>
            </div>

            {/* ── Analysis Tools — visually separated section */}
            <div className="filter-group filter-group--sm">
              <label className="filter-label">⚙️ Analysis Tools</label>
              <div className="tool-group" role="group" aria-label="Analysis tools">
                <button
                  id="tool-proximity"
                  className={`tool-btn tool-btn--proximity ${activeTool === 'proximity' ? 'tool-btn--active' : ''}`}
                  onClick={() => switchTool('proximity')}
                  aria-pressed={activeTool === 'proximity'}>
                  <Crosshair size={13} aria-hidden="true" />
                  {activeTool === 'proximity' ? 'Cancel Scan' : 'Proximity Scan'}
                </button>
                <button
                  id="tool-measure"
                  className={`tool-btn tool-btn--measure ${activeTool === 'measure' ? 'tool-btn--active' : ''}`}
                  onClick={() => switchTool('measure')}
                  aria-pressed={activeTool === 'measure'}>
                  <Ruler size={13} aria-hidden="true" />
                  {activeTool === 'measure' ? 'Stop Measuring' : 'Measure Distance'}
                </button>
                <button
                  id="tool-viability"
                  className={`tool-btn tool-btn--viability ${activeTool === 'viability' ? 'tool-btn--active' : ''}`}
                  onClick={() => switchTool('viability')}
                  aria-pressed={activeTool === 'viability'}>
                  <MapPin size={13} aria-hidden="true" />
                  {activeTool === 'viability' ? 'Cancel Analysis' : 'Conceptual Analysis'}
                </button>
              </div>
            </div>

            {/* Layer toggles */}
            <div className="filter-group filter-group--sm">
              <label className="filter-label">Layers</label>
              <div className="layer-list">
                {[
                  { key: 'lines',       icon: <Layers size={12} />,  label: 'Transmission Lines', color: '#3b82f6' },
                  { key: 'substations', icon: <span>▲</span>,        label: 'Substations',        color: '#94a3b8' },
                  { key: 'plants',      icon: <Zap size={12} />,     label: 'Power Plants',       color: '#facc15' },
                  { key: 'hydro',       icon: <span>💧</span>,       label: 'Hydro Dams',         color: '#3b82f6' },
                ].map(({ key, icon, label, color }) => {
                  const count = stats.layerCounts[key];
                  const isOn = visibleLayers[key];
                  return (
                  <button key={key}
                    role="switch"
                    aria-checked={isOn}
                    className={`layer-toggle ${isOn ? 'layer-toggle--on' : ''}`}
                    onClick={() => setVisibleLayers(p => ({ ...p, [key]: !p[key] }))}>
                    <span className="layer-icon" style={{ color: isOn ? color : '#475569' }}>{icon}</span>
                    <span className="layer-label">{label} <span style={{ color: isOn ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: '0.7rem' }}>({count})</span></span>
                    <span className={`layer-switch ${isOn ? 'layer-switch--on' : ''}`} />
                  </button>
                );
                })}
                <button
                  role="switch"
                  aria-checked={showBoundaries}
                  className={`layer-toggle ${showBoundaries ? 'layer-toggle--on' : ''}`}
                  onClick={() => setShowBoundaries(v => !v)}>
                  <span className="layer-icon"><MapIcon size={12} color={showBoundaries ? '#a78bfa' : '#475569'} /></span>
                  <span className="layer-label">Admin Boundaries</span>
                  <span className={`layer-switch ${showBoundaries ? 'layer-switch--on' : ''}`} />
                </button>
              </div>
            </div>

            {/* Map style toggle — now a dedicated section (M8 fix) */}
            <div className="filter-group filter-group--sm">
              <label className="filter-label">Map Style</label>
              <button className="theme-toggle" onClick={() => setMapTheme(t => t === 'light' ? 'dark' : 'light')}
                aria-label={`Switch to ${mapTheme === 'light' ? 'dark' : 'light'} map style`}>
                {mapTheme === 'light' ? <Moon size={13} aria-hidden="true" /> : <Sun size={13} aria-hidden="true" />}
                {mapTheme === 'light' ? 'Switch to Dark Map' : 'Switch to Light Map'}
              </button>
            </div>

            {/* Voltage legend */}
            <div className="filter-group filter-group--sm">
              <label className="filter-label">Voltage Legend</label>
              <div className="legend-section">
                {[
                  ['500 kV', 'rgb(255,105,180)', 4],
                  ['230 kV', 'rgb(239,68,68)',   3],
                  ['132 kV', 'rgb(59,130,246)',  2.5],
                  ['66 kV',  'rgb(34,197,94)',   2],
                  ['33 kV',  'rgb(156,163,175)', 1.5],
                  ['11 kV',  'rgb(100,116,139)', 1],
                ].map(([label, color, h]) => (
                  <div key={label} className="legend-item">
                    <div className="legend-line" style={{ background: color, height: `${h}px` }} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Generation mix donut */}
            <div className="filter-group filter-group--sm">
              <label className="filter-label">Generation Mix</label>
              <DonutChart data={stats.donutData} onFilterSeg={setFuelFilter} />
            </div>

            {/* Logout Button */}
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
              <button 
                onClick={logout} 
                style={{ 
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', 
                  padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500,
                  background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)',
                  cursor: 'pointer', transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                aria-label="Sign Out"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>

          </div>
        )}
      </nav>

      {/* Sticky hint strip */}
      {hoveredSubId && !activeTool && !analysisPanel.type && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)',
          color: '#ffd700', padding: '6px 16px', borderRadius: 20, fontSize: '0.75rem',
          zIndex: 9, pointerEvents: 'none', animation: 'fadeUp 0.18s ease-out'
        }}>
          Click substation to trace connectivity
        </div>
      )}

      {/* Unified Analysis Panel — no collision possible */}
      <AnalysisPanel
        panelState={analysisPanel}
        onClose={handlePanelClose}
        adjacencyMap={adjacencyMap}
        proximityResults={proximityResults}
        proximityRadius={proximityRadius}
        onProximityRadiusChange={setProximityRadius}
        onProximityJump={(f) => { handlePanelClose(); jumpToFeature(f); }}
        measurePoints={measurePoints}
        measureMousePos={measureMousePos}
        onMeasureUndo={() => setMeasurePoints(prev => prev.slice(0, -1))}
        onMeasureClear={() => setMeasurePoints([])}
        meteoData={meteoData}
        meteoLoading={meteoLoading}
        viabilityResult={viabilityResult}
        analysisPhase={analysisPhase}
        viabilityPoint={viabilityPoint}
        viabilityConfig={viabilityConfig}
        onRunAnalysis={handleRunAnalysis}
        onReconfigure={handleReconfigure}
        onNewPin={handleNewPin}
        geoData={geoData}
        onMobileBack={() => setSidebarCollapsed(false)}
        onJumpTo={(result) => {
          // Find the actual feature in geoData matching this proximity result
          const allFeatures = [
            ...(geoData.substations?.features || []),
            ...(geoData.plants?.features || []),
            ...(geoData.hydro?.features || []),
          ];
          const feature = allFeatures.find(f => f.properties.id === result.props.id);
          if (feature) {
            setAnalysisPanel({ type: null, data: null });
            setProximityCenter(null);
            jumpToFeature(feature);
          }
        }}
      />

      {/* Status Strip — replaces the old stats pill */}
      {dataLoadState !== 'loading' && (
        <StatusStrip
          stats={stats}
          activeTool={activeTool}
          onResetHome={resetHome}
          regionFilter={regionFilter}
        />
      )}
    </>
  );
}
