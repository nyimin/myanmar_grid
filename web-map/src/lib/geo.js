import { VOLTAGE_COLORS } from './constants.js';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const radiusKm = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = (
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLon / 2) ** 2))
  );

  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

export function makeCircleGeoJSON(lng, lat, radiusKm, pts = 80) {
  const coords = Array.from({ length: pts + 1 }, (_, index) => {
    const angle = (index / pts) * 2 * Math.PI;
    return [
      lng + (radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle),
      lat + (radiusKm / 111.32) * Math.sin(angle),
    ];
  });

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {},
      },
    ],
  };
}

export function getPointCoords(feature) {
  if (!feature?.geometry) return null;
  const { type, coordinates } = feature.geometry;
  if (type === 'Point') return coordinates;
  if (type === 'LineString') return coordinates[Math.floor(coordinates.length / 2)] ?? null;
  if (type === 'Polygon') return coordinates?.[0]?.[0] ?? null;
  if (type === 'MultiLineString') return coordinates?.[0]?.[0] ?? null;
  if (type === 'MultiPolygon') return coordinates?.[0]?.[0]?.[0] ?? null;
  return null;
}

export function getFeatureCenter(feature) {
  if (!feature?.geometry) return null;
  const coords = getPointCoords(feature);
  if (!coords) return null;
  return { lng: coords[0], lat: coords[1] };
}

export function rgbToHex([r, g, b]) {
  return [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function getVoltageColor(voltageKv) {
  if (!voltageKv || voltageKv <= 0) return VOLTAGE_COLORS[0];
  if (voltageKv >= 500) return VOLTAGE_COLORS[500];
  if (voltageKv >= 230) return VOLTAGE_COLORS[230];
  if (voltageKv >= 132) return VOLTAGE_COLORS[132];
  if (voltageKv >= 66) return VOLTAGE_COLORS[66];
  if (voltageKv >= 33) return VOLTAGE_COLORS[33];
  return VOLTAGE_COLORS[11];
}

export function getFeatureDisplayName(feature) {
  return feature?.properties?.name || feature?.properties?.datasetName || 'Unnamed Feature';
}

export function clusterPointFeatures(features, zoom, options = {}) {
  const thresholdZoom = options.thresholdZoom ?? 7;
  if (zoom >= thresholdZoom) return [];

  const cellSize = 18 / (2 ** Math.max(0, zoom));
  const buckets = new Map();

  features.forEach((feature) => {
    const coords = getPointCoords(feature);
    if (!coords) return;
    const bucketKey = `${Math.floor(coords[0] / cellSize)}:${Math.floor(coords[1] / cellSize)}`;
    const bucket = buckets.get(bucketKey) || {
      count: 0,
      lngSum: 0,
      latSum: 0,
      names: [],
    };
    bucket.count += 1;
    bucket.lngSum += coords[0];
    bucket.latSum += coords[1];
    if (feature.properties?.name) bucket.names.push(feature.properties.name);
    buckets.set(bucketKey, bucket);
  });

  return [...buckets.values()]
    .filter((bucket) => bucket.count > 1)
    .map((bucket, index) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [bucket.lngSum / bucket.count, bucket.latSum / bucket.count],
      },
      properties: {
        id: `cluster-${index}`,
        __cluster: true,
        clusterCount: bucket.count,
        previewNames: bucket.names.slice(0, 3),
      },
    }));
}
