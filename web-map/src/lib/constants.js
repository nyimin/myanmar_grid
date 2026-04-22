export const MAP_STYLES = {
  light: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  },
  dark: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
      },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  },
};

export const INITIAL_VIEW_STATE = {
  longitude: 95.956,
  latitude: 21.9162,
  zoom: 5.5,
  pitch: 0,
  bearing: 0,
  transitionDuration: 0,
};

export const VOLTAGE_COLORS = {
  500: [255, 105, 180, 255],
  230: [239, 68, 68, 255],
  132: [59, 130, 246, 255],
  66: [34, 197, 94, 255],
  33: [156, 163, 175, 220],
  11: [100, 116, 139, 200],
  0: [70, 80, 100, 160],
};

export const FUEL_COLORS = {
  gas: [56, 189, 248],
  solar: [250, 204, 21],
  coal: [168, 162, 158],
  hydro: [59, 130, 246],
  wind: [167, 243, 208],
  default: [217, 119, 6],
};

export const DONUT_COLORS = {
  hydro: '#3b82f6',
  gas: '#38bdf8',
  solar: '#facc15',
  coal: '#a8a29e',
  wind: '#a7f3d0',
  steam: '#fb923c',
  biomass: '#4ade80',
  default: '#d97706',
  unknown: '#6b7280',
};

export const STATE_FILL_COLORS = [
  [99, 179, 237, 30],
  [154, 230, 180, 30],
  [251, 211, 141, 30],
  [246, 173, 185, 30],
  [214, 188, 250, 30],
  [129, 230, 217, 30],
  [252, 196, 25, 30],
  [196, 181, 253, 30],
  [167, 243, 208, 30],
  [253, 186, 116, 30],
  [147, 197, 253, 30],
  [252, 165, 165, 30],
  [110, 231, 183, 30],
  [233, 213, 255, 30],
  [254, 240, 138, 30],
  [186, 230, 253, 30],
  [253, 224, 132, 30],
  [167, 243, 208, 30],
];
