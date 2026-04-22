import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { AttributionControl, NavigationControl } from 'react-map-gl/maplibre';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FUEL_COLORS, MAP_STYLES, STATE_FILL_COLORS } from '../../lib/constants.js';
import { getVoltageColor, haversineKm, makeCircleGeoJSON, rgbToHex } from '../../lib/geo.js';

const FUEL_ICON_PATHS = {
  hydro: "%3Cpath d='M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z' fill='white'/%3E",
  solar: "%3Ccircle cx='12' cy='12' r='4' fill='white'/%3E%3Cpath d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41' stroke='white' stroke-width='2' fill='none' stroke-linecap='round'/%3E",
  gas: "%3Cpath d='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z' fill='white'/%3E",
  coal: "%3Cpath d='M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z' fill='white'/%3E",
  wind: "%3Cpath d='M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2' stroke='white' stroke-width='2' fill='none' stroke-linecap='round'/%3E",
  default: "%3Cpolygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2' fill='white'/%3E",
};

function mkTriangle(hex) {
  return {
    url: `data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 2L2 22h20z' fill='%23${hex}' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E`,
    width: 24,
    height: 24,
    anchorY: 12,
  };
}

function mkPlantIcon(hex, fuel) {
  const fuelType = (fuel || 'default').toLowerCase();
  const innerPath = FUEL_ICON_PATHS[fuelType] || FUEL_ICON_PATHS.default;
  return {
    url: `data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='11' fill='%23${hex}' stroke='%23000' stroke-width='1.5'/%3E%3Cg transform='translate(4.8, 4.8) scale(0.6)'%3E${innerPath}%3C/g%3E%3C/svg%3E`,
    width: 24,
    height: 24,
    anchorY: 12,
  };
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

export default function MapView({
  viewState,
  setViewState,
  filteredData,
  showBoundaries,
  visibleLayers,
  mapTheme,
  hoverInfo,
  setHoverInfo,
  activeTool,
  handleMapClick,
  measurePoints,
  measureMousePos,
  setMeasureMousePos,
  proximityCenter,
  proximityRadius,
  workspaceFeatures,
  savedLocationFeatures,
  traceInfo,
  setHoveredSubId,
}) {
  const isMeasureMode = activeTool === 'measure';
  const traceLineData = traceInfo ? featureCollection(traceInfo.connectedLines) : null;
  const traceSubData = traceInfo?.connectedSubFeatures ? featureCollection(traceInfo.connectedSubFeatures) : null;
  const circleData = proximityCenter ? makeCircleGeoJSON(proximityCenter.lng, proximityCenter.lat, proximityRadius) : null;
  const measureLineData = (() => {
    const allPoints = measureMousePos && isMeasureMode ? [...measurePoints, measureMousePos] : measurePoints;
    if (allPoints.length < 2) return null;
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: allPoints.map((point) => [point.lng, point.lat]) },
      properties: {},
    };
  })();

  const workspacePointFeatures = workspaceFeatures.filter((feature) => feature.geometry.type === 'Point');
  const workspaceLineFeatures = workspaceFeatures.filter((feature) => feature.geometry.type === 'LineString');
  const workspacePolygonFeatures = workspaceFeatures.filter((feature) => feature.geometry.type === 'Polygon');

  const layers = [
    showBoundaries && filteredData.boundaries && new GeoJsonLayer({
      id: 'admin-boundaries',
      data: filteredData.boundaries,
      pickable: false,
      stroked: true,
      filled: true,
      getFillColor: (feature, { index }) => STATE_FILL_COLORS[index % STATE_FILL_COLORS.length],
      getLineColor: [100, 120, 160, 180],
      lineWidthMinPixels: 1,
      getLineWidth: 1,
    }),
    filteredData.lines && new GeoJsonLayer({
      id: 'transmission-lines',
      data: filteredData.lines,
      visible: visibleLayers.lines,
      pickable: !isMeasureMode,
      lineWidthScale: 20,
      lineWidthMinPixels: 1,
      lineWidthMaxPixels: 5,
      getLineColor: (feature) => getVoltageColor(feature.properties.voltage_kv),
      getLineWidth: (feature) => {
        const voltage = feature.properties.voltage_kv;
        if (voltage >= 500) return 6;
        if (voltage >= 230) return 4;
        if (voltage >= 132) return 2.5;
        if (voltage >= 66) return 1.5;
        return 1;
      },
      onHover: (info) => setHoverInfo(info),
    }),
    traceLineData && new GeoJsonLayer({
      id: 'trace-lines',
      data: traceLineData,
      pickable: false,
      getLineColor: [255, 210, 0, 240],
      getLineWidth: 4,
      lineWidthMinPixels: 3,
    }),
    circleData && new GeoJsonLayer({
      id: 'proximity-circle',
      data: circleData,
      pickable: false,
      stroked: true,
      filled: true,
      getFillColor: [167, 139, 250, 22],
      getLineColor: [167, 139, 250, 200],
      getLineWidth: 2,
      lineWidthMinPixels: 2,
    }),
    proximityCenter && new ScatterplotLayer({
      id: 'proximity-center',
      data: [proximityCenter],
      pickable: false,
      getPosition: (item) => [item.lng, item.lat],
      getRadius: 6,
      radiusUnits: 'pixels',
      getFillColor: [167, 139, 250, 255],
      getLineColor: [255, 255, 255, 255],
      stroked: true,
      lineWidthMinPixels: 2,
    }),
    measureLineData && new GeoJsonLayer({
      id: 'measure-line',
      data: measureLineData,
      pickable: false,
      getLineColor: [52, 211, 153, 220],
      getLineWidth: 3,
      lineWidthMinPixels: 2,
    }),
    measurePoints.length > 0 && new ScatterplotLayer({
      id: 'measure-points',
      data: measurePoints.map((point, index) => ({ ...point, index })),
      pickable: false,
      getPosition: (item) => [item.lng, item.lat],
      getRadius: 6,
      radiusUnits: 'pixels',
      getFillColor: (item) => item.index === 0 ? [52, 211, 153, 255] : [255, 255, 255, 255],
      getLineColor: [52, 211, 153, 255],
      stroked: true,
      lineWidthMinPixels: 1.5,
    }),
    filteredData.substations && new GeoJsonLayer({
      id: 'substations',
      data: filteredData.substations,
      visible: visibleLayers.substations,
      pickable: !isMeasureMode,
      pointType: 'icon',
      getIcon: (feature) => mkTriangle(rgbToHex(getVoltageColor(feature.properties.voltage_kv))),
      getIconSize: (feature) => Math.max(12, Math.min(22, 10 + (feature.properties.voltage_kv || 0) * 0.03)),
      onHover: (info) => {
        setHoverInfo(info);
        setHoveredSubId(info.object?.properties?.id || null);
      },
    }),
    traceSubData && new GeoJsonLayer({
      id: 'trace-substations',
      data: traceSubData,
      pickable: false,
      pointType: 'circle',
      pointRadiusUnits: 'pixels',
      getPointRadius: 10,
      getFillColor: [255, 210, 0, 220],
      getLineColor: [255, 255, 255, 255],
      stroked: true,
      lineWidthMinPixels: 2,
    }),
    filteredData.plants && new GeoJsonLayer({
      id: 'power-plants',
      data: filteredData.plants,
      visible: visibleLayers.plants,
      pickable: !isMeasureMode,
      pointType: 'icon',
      getIcon: (feature) => mkPlantIcon(rgbToHex(FUEL_COLORS[feature.properties.fuel_type?.toLowerCase()] || FUEL_COLORS.default), feature.properties.fuel_type),
      getIconSize: (feature) => Math.max(12, Math.min(24, 10 + Math.sqrt(feature.properties.capacity || 0) * 1.5)),
      onHover: (info) => setHoverInfo(info),
    }),
    filteredData.hydro && new GeoJsonLayer({
      id: 'hydro-dams',
      data: filteredData.hydro,
      visible: visibleLayers.hydro,
      pickable: !isMeasureMode,
      pointType: 'icon',
      getIcon: () => mkPlantIcon(rgbToHex(FUEL_COLORS.hydro), 'hydro'),
      getIconSize: (feature) => Math.max(12, Math.min(26, 12 + Math.sqrt(feature.properties.capacity || 0) * 1.2)),
      onHover: (info) => setHoverInfo(info),
    }),
    workspaceLineFeatures.length > 0 && new GeoJsonLayer({
      id: 'workspace-lines',
      data: featureCollection(workspaceLineFeatures),
      pickable: true,
      getLineColor: [20, 184, 166, 220],
      getLineWidth: 2.25,
      lineWidthMinPixels: 2,
      onHover: (info) => setHoverInfo(info),
    }),
    workspacePolygonFeatures.length > 0 && new GeoJsonLayer({
      id: 'workspace-polygons',
      data: featureCollection(workspacePolygonFeatures),
      pickable: true,
      filled: true,
      stroked: true,
      getFillColor: [20, 184, 166, 35],
      getLineColor: [20, 184, 166, 200],
      getLineWidth: 2,
      lineWidthMinPixels: 1.5,
      onHover: (info) => setHoverInfo(info),
    }),
    workspacePointFeatures.length > 0 && new GeoJsonLayer({
      id: 'workspace-points',
      data: featureCollection(workspacePointFeatures),
      pickable: true,
      pointType: 'circle',
      pointRadiusUnits: 'pixels',
      getPointRadius: 7,
      getFillColor: [249, 115, 22, 230],
      getLineColor: [255, 255, 255, 255],
      stroked: true,
      lineWidthMinPixels: 1.5,
      onHover: (info) => setHoverInfo(info),
    }),
    savedLocationFeatures.length > 0 && new ScatterplotLayer({
      id: 'saved-locations',
      data: savedLocationFeatures,
      pickable: true,
      getPosition: (feature) => feature.geometry.coordinates,
      getRadius: 7,
      radiusUnits: 'pixels',
      getFillColor: [251, 191, 36, 255],
      getLineColor: [255, 255, 255, 255],
      stroked: true,
      lineWidthMinPixels: 2,
      onHover: (info) => setHoverInfo(info),
    }),
  ].filter(Boolean);

  return (
    <div className="map-shell">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: nextState }) => setViewState(nextState)}
        controller={isMeasureMode ? { doubleClickZoom: false } : true}
        layers={layers}
        onClick={handleMapClick}
        getTooltip={() => null}
        onHover={(info) => {
          if (!isMeasureMode) setHoverInfo(info);
          if (info.coordinate) setMeasureMousePos({ lng: info.coordinate[0], lat: info.coordinate[1] });
        }}
        getCursor={({ isHovering }) => (
          isMeasureMode || activeTool === 'proximity' || activeTool === 'nearest'
            ? 'crosshair'
            : isHovering ? 'pointer' : 'grab'
        )}
      >
        <Map mapStyle={MAP_STYLES[mapTheme]} reuseMaps attributionControl={false}>
          <AttributionControl compact position="bottom-right" />
          <NavigationControl position="top-right" />
        </Map>
        {hoverInfo?.object && !isMeasureMode && (
          <div
            className="map-tooltip glass-panel"
            style={{
              left: Math.max(140, Math.min(hoverInfo.x, window.innerWidth - 140)),
              top: hoverInfo.y,
            }}
          >
            <div className="tooltip-title">{hoverInfo.object.properties.name || hoverInfo.object.properties.datasetName || 'Asset'}</div>
            {hoverInfo.object.properties.__cluster && (
              <div className="tooltip-row">
                <span>Cluster</span>
                <strong>{hoverInfo.object.properties.clusterCount} assets</strong>
              </div>
            )}
            {hoverInfo.object.properties.capacity && (
              <div className="tooltip-row">
                <span>Capacity</span>
                <strong>{hoverInfo.object.properties.capacity} MW</strong>
              </div>
            )}
            {hoverInfo.object.properties.voltage_kv && (
              <div className="tooltip-row">
                <span>Voltage</span>
                <strong>{hoverInfo.object.properties.voltage_kv} kV</strong>
              </div>
            )}
            {hoverInfo.object.geometry.type === 'LineString' && hoverInfo.object.geometry.coordinates?.length > 1 && (
              <div className="tooltip-row">
                <span>Approx span</span>
                <strong>{haversineKm(
                  hoverInfo.object.geometry.coordinates[0][1],
                  hoverInfo.object.geometry.coordinates[0][0],
                  hoverInfo.object.geometry.coordinates.at(-1)[1],
                  hoverInfo.object.geometry.coordinates.at(-1)[0],
                ).toFixed(1)} km</strong>
              </div>
            )}
          </div>
        )}
      </DeckGL>
    </div>
  );
}
