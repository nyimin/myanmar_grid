import { FlyToInterpolator } from '@deck.gl/core';
import * as turf from '@turf/turf';
import { FolderOpen, Home, Layers3, LocateFixed, Menu, Search, SlidersHorizontal } from 'lucide-react';
import { startTransition, Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import LoadingOverlay from '../components/LoadingOverlay.jsx';
import MapLegend from '../features/map/MapLegend.jsx';
import BottomPanel from '../features/panels/BottomPanel.jsx';
import Sidebar from '../features/sidebar/Sidebar.jsx';
import { useWorkspace } from '../features/workspace/useWorkspace.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useStaticDatasets } from '../hooks/useStaticDatasets.js';
import { INITIAL_VIEW_STATE } from '../lib/constants.js';
import { getFeatureCenter, getPointCoords, haversineKm, makeCircleGeoJSON } from '../lib/geo.js';

const MapView = lazy(() => import('../features/map/MapView.jsx'));

function buildSearchResults(query, features) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return features.filter((feature) => feature.properties?.name?.toLowerCase().includes(q)).slice(0, 10);
}

function buildSyntheticSelection(coordinate) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coordinate },
    properties: {
      id: `selection-${coordinate.join('-')}`,
      name: 'Selected Point',
      type: 'selection',
      longitude: coordinate[0].toFixed(6),
      latitude: coordinate[1].toFixed(6),
    },
  };
}

function buildRecentSelection(feature) {
  const props = feature.properties || {};
  return {
    id: props.id || `${feature.geometry.type}-${Date.now()}`,
    name: props.name || props.datasetName || 'Selected feature',
    meta: props.state_region || props.region || props.type || feature.geometry.type,
    feature,
  };
}

function downloadGeoJson(filename, geojson) {
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getNearestResult(point, datasets, workspaceFeatures) {
  const [lng, lat] = point.geometry.coordinates;
  const turfPoint = turf.point([lng, lat]);

  const nearestPointFeature = (features, label) => {
    let nearest = null;
    let minDistance = Infinity;
    features.forEach((feature) => {
      const coords = getPointCoords(feature);
      if (!coords) return;
      const distance = haversineKm(lat, lng, coords[1], coords[0]);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = feature;
      }
    });
    return nearest ? {
      label,
      name: nearest.properties?.name || nearest.properties?.datasetName || 'Unnamed',
      feature: nearest,
      distanceText: `${minDistance.toFixed(1)} km`,
    } : null;
  };

  let nearestLine = null;
  let nearestLineDistance = Infinity;
  (datasets.lines?.features || []).forEach((feature) => {
    try {
      const distance = turf.pointToLineDistance(turfPoint, feature, { units: 'kilometers' });
      if (distance < nearestLineDistance) {
        nearestLineDistance = distance;
        nearestLine = feature;
      }
    } catch {
      // Invalid geometry; ignore.
    }
  });

  return {
    point,
    items: [
      nearestPointFeature(datasets.substations?.features || [], 'Nearest substation'),
      nearestPointFeature(datasets.plants?.features || [], 'Nearest plant'),
      nearestPointFeature(datasets.hydro?.features || [], 'Nearest hydro dam'),
      nearestPointFeature(workspaceFeatures, 'Nearest workspace feature'),
      nearestLine ? {
        label: 'Nearest transmission line',
        name: nearestLine.properties?.name || `${nearestLine.properties?.voltage_kv || '?'} kV line`,
        feature: nearestLine,
        distanceText: `${nearestLineDistance.toFixed(1)} km`,
      } : null,
    ].filter(Boolean),
  };
}

export default function AppShell() {
  const { logout, pb, user } = useAuth();
  const { datasets, adjacencyMap, ensureDataset, errorKeys, progress } = useStaticDatasets();
  const workspace = useWorkspace({ user, pb });
  const hoverTimer = useRef(null);
  const searchSectionRef = useRef(null);
  const filtersSectionRef = useRef(null);
  const toolsSectionRef = useRef(null);
  const layersSectionRef = useRef(null);
  const workspaceSectionRef = useRef(null);
  const sectionRefs = useMemo(() => ({
    search: searchSectionRef,
    filters: filtersSectionRef,
    tools: toolsSectionRef,
    layers: layersSectionRef,
    workspace: workspaceSectionRef,
  }), []);

  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [hoveredSubId, setHoveredSubId] = useState(null);
  const [visibleLayers, setVisibleLayers] = useState({ lines: true, substations: true, plants: false, hydro: false });
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 960);

  const [regionFilter, setRegionFilter] = useState('All');
  const [voltageFilters, setVoltageFilters] = useState(new Set(['All']));
  const [fuelFilter, setFuelFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const [activeTool, setActiveTool] = useState(null);
  const [panel, setPanel] = useState({ type: null, data: null });
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureMousePos, setMeasureMousePos] = useState(null);
  const [proximityCenter, setProximityCenter] = useState(null);
  const [proximityRadius, setProximityRadius] = useState(15);
  const [traceInfo, setTraceInfo] = useState(null);
  const [recentSelections, setRecentSelections] = useState([]);
  const [legendOpen, setLegendOpen] = useState(window.innerWidth > 960);
  const [locationState, setLocationState] = useState({ kind: 'idle', message: '' });

  useEffect(() => {
    if (showBoundaries) ensureDataset('boundaries');
  }, [ensureDataset, showBoundaries]);

  useEffect(() => {
    if (visibleLayers.hydro) ensureDataset('hydro');
  }, [ensureDataset, visibleLayers.hydro]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveTool(null);
        setMeasurePoints([]);
        setMeasureMousePos(null);
        setProximityCenter(null);
        setPanel({ type: null, data: null });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const matchesVoltage = useCallback((feature) => {
    if (voltageFilters.has('All')) return true;
    const voltage = feature.properties.voltage_kv;
    return [...voltageFilters].some((chip) => {
      if (chip === '500') return voltage >= 500;
      if (chip === '230') return voltage >= 230 && voltage < 500;
      if (chip === '132') return voltage >= 132 && voltage < 230;
      if (chip === '66') return voltage >= 66 && voltage < 132;
      if (chip === '33') return voltage > 0 && voltage < 66;
      return false;
    });
  }, [voltageFilters]);

  const filteredData = useMemo(() => {
    const filterRegion = (feature) => regionFilter === 'All' || feature.properties.state_region === regionFilter || feature.properties.region === regionFilter;
    const filterFuel = (feature) => fuelFilter === 'All' || feature.properties.fuel_type?.toLowerCase() === fuelFilter;
    const filterStatus = (feature) => statusFilter === 'All' || feature.properties.operational_status === statusFilter;

    return {
      lines: datasets.lines ? {
        ...datasets.lines,
        features: datasets.lines.features.filter((feature) => filterRegion(feature) && matchesVoltage(feature)),
      } : null,
      substations: datasets.substations ? {
        ...datasets.substations,
        features: datasets.substations.features.filter((feature) => filterRegion(feature) && matchesVoltage(feature)),
      } : null,
      plants: datasets.plants ? {
        ...datasets.plants,
        features: datasets.plants.features.filter((feature) => filterRegion(feature) && filterFuel(feature) && filterStatus(feature)),
      } : null,
      hydro: datasets.hydro ? {
        ...datasets.hydro,
        features: datasets.hydro.features.filter((feature) => filterRegion(feature) && filterFuel(feature) && filterStatus(feature)),
      } : null,
      boundaries: datasets.boundaries,
    };
  }, [datasets, fuelFilter, matchesVoltage, regionFilter, statusFilter]);

  const searchableFeatures = useMemo(() => [
    ...(filteredData.substations?.features || []),
    ...(filteredData.plants?.features || []),
    ...(filteredData.hydro?.features || []),
    ...workspace.mapDatasetFeatures,
    ...workspace.savedLocationFeatures,
  ], [filteredData.hydro?.features, filteredData.plants?.features, filteredData.substations?.features, workspace.mapDatasetFeatures, workspace.savedLocationFeatures]);

  const searchResults = useMemo(() => buildSearchResults(deferredSearchQuery, searchableFeatures), [deferredSearchQuery, searchableFeatures]);

  const proximityResults = useMemo(() => {
    if (!proximityCenter) return [];
    const allFeatures = [
      ...(datasets.substations?.features || []),
      ...(datasets.plants?.features || []),
      ...(datasets.hydro?.features || []),
      ...workspace.mapDatasetFeatures,
      ...workspace.savedLocationFeatures,
    ];
    return allFeatures
      .map((feature) => {
        const coords = getPointCoords(feature);
        if (!coords) return null;
        const dist = haversineKm(proximityCenter.lat, proximityCenter.lng, coords[1], coords[0]);
        return dist <= proximityRadius ? { props: feature.properties, dist, feature } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.dist - b.dist);
  }, [datasets.hydro?.features, datasets.plants?.features, datasets.substations?.features, proximityCenter, proximityRadius, workspace.mapDatasetFeatures, workspace.savedLocationFeatures]);

  const jumpToFeature = useCallback((feature) => {
    const center = getFeatureCenter(feature);
    if (!center) return;
    setViewState((current) => ({
      ...current,
      longitude: center.lng,
      latitude: center.lat,
      zoom: feature.geometry.type === 'Point' ? 10 : 8.25,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }),
    }));
    setPanel({ type: 'detail', data: feature });
    if (window.innerWidth <= 960) setSidebarOpen(false);
  }, []);

  const switchTool = useCallback((tool) => {
    startTransition(() => {
      setActiveTool((current) => {
        const next = current === tool ? null : tool;
        setMeasurePoints([]);
        setMeasureMousePos(null);
        setProximityCenter(null);
        setTraceInfo(null);
        setPanel(next === 'measure' ? { type: 'measure', data: null } : { type: null, data: null });
        return next;
      });
    });
  }, []);

  const pushRecentSelection = useCallback((feature) => {
    const recent = buildRecentSelection(feature);
    setRecentSelections((current) => [recent, ...current.filter((item) => item.id !== recent.id)].slice(0, 5));
  }, []);

  const handleMapClick = useCallback((info) => {
    if (info.object?.properties?.__cluster) {
      const [lng, lat] = info.object.geometry.coordinates;
      setViewState((current) => ({
        ...current,
        longitude: lng,
        latitude: lat,
        zoom: Math.min(current.zoom + 2, 10),
        transitionDuration: 700,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.5 }),
      }));
      return;
    }

    if (activeTool === 'measure') {
      if (info.coordinate) setMeasurePoints((current) => [...current, { lng: info.coordinate[0], lat: info.coordinate[1] }]);
      return;
    }

    if (activeTool === 'nearest') {
      if (!info.coordinate) return;
      const point = buildSyntheticSelection(info.coordinate);
      setPanel({ type: 'nearest', data: getNearestResult(point, datasets, workspace.mapDatasetFeatures) });
      pushRecentSelection(point);
      if (window.innerWidth <= 960) setSidebarOpen(false);
      return;
    }

    if (activeTool === 'proximity') {
      if (!info.coordinate) return;
      const center = { lng: info.coordinate[0], lat: info.coordinate[1] };
      setProximityCenter(center);
      setPanel({ type: 'proximity', data: center });
      if (window.innerWidth <= 960) setSidebarOpen(false);
      return;
    }

    if (!info.object) {
      if (info.coordinate) {
        const point = buildSyntheticSelection(info.coordinate);
        setTraceInfo(null);
        setPanel({ type: 'detail', data: point });
        pushRecentSelection(point);
      } else {
        setTraceInfo(null);
        setPanel({ type: null, data: null });
      }
      return;
    }

    const feature = info.object;
    const props = feature.properties || {};
    if (props.type === 'substation') {
      const connections = adjacencyMap[props.id] || [];
      const connectedSubIds = [...new Set(connections.map((entry) => entry.otherSubId))];
      const connectedSubFeatures = (datasets.substations?.features || []).filter((item) => connectedSubIds.includes(item.properties.id));
      setTraceInfo({
        connectedLines: connections.map((entry) => entry.lineFeature),
        connectedSubFeatures,
      });
    } else {
      setTraceInfo(null);
    }

    setPanel({ type: 'detail', data: feature });
    pushRecentSelection(feature);
    if (window.innerWidth <= 960) setSidebarOpen(false);
  }, [activeTool, adjacencyMap, datasets, pushRecentSelection, workspace.mapDatasetFeatures]);

  const saveFeatureToWorkspace = useCallback(async (feature) => {
    if (!feature || !workspace.activeWorkspace) return;
    await workspace.saveLocation(workspace.activeWorkspace.id, feature.geometry, {
      name: feature.properties?.name || 'Saved Location',
      type: feature.properties?.type || feature.geometry.type,
      sourceName: feature.properties?.datasetName || feature.properties?.name || 'Map selection',
    });
  }, [workspace]);

  const saveSelectedFeature = useCallback(async () => {
    await saveFeatureToWorkspace(panel.data);
  }, [panel.data, saveFeatureToWorkspace]);

  const resetHome = useCallback(() => {
    setViewState({
      ...INITIAL_VIEW_STATE,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }),
    });
  }, []);

  const openNearestForFeature = useCallback((feature) => {
    if (!feature) return;
    const center = getFeatureCenter(feature);
    const point = feature.geometry.type === 'Point'
      ? feature
      : (center ? buildSyntheticSelection([center.lng, center.lat]) : null);
    if (!point?.geometry?.coordinates?.length) return;
    setPanel({ type: 'nearest', data: getNearestResult(point, datasets, workspace.mapDatasetFeatures) });
  }, [datasets, workspace.mapDatasetFeatures]);

  const openProximityForFeature = useCallback((feature) => {
    const center = getFeatureCenter(feature);
    if (!center) return;
    setProximityCenter(center);
    setPanel({ type: 'proximity', data: center });
  }, []);

  const openSidebarSection = useCallback((key) => {
    setSidebarOpen(true);
    window.setTimeout(() => {
      sectionRefs[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }, [sectionRefs]);

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationState({ kind: 'error', message: 'Location is not available on this device.' });
      return;
    }
    setLocationState({ kind: 'loading', message: 'Requesting your device location…' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const feature = buildSyntheticSelection([position.coords.longitude, position.coords.latitude]);
        pushRecentSelection(feature);
        jumpToFeature(feature);
        setLocationState({ kind: 'success', message: 'Centered map on your current location.' });
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Current location is unavailable.'
            : 'Location request timed out.';
        setLocationState({ kind: 'error', message });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }, [jumpToFeature, pushRecentSelection]);

  useEffect(() => {
    if (locationState.kind === 'idle') return undefined;
    const timer = window.setTimeout(() => setLocationState({ kind: 'idle', message: '' }), 2800);
    return () => window.clearTimeout(timer);
  }, [locationState]);

  const sidebarWorkspaceProps = {
    workspaces: workspace.workspaces,
    activeWorkspaceId: workspace.activeWorkspaceId,
    onSelectWorkspace: workspace.setActiveWorkspaceId,
    onCreateWorkspace: workspace.createWorkspace,
    status: workspace.status,
    datasets: workspace.activeWorkspaceDatasets,
    savedLocations: workspace.activeSavedLocations,
    onRenameDataset: workspace.renameDataset,
    onDeleteDataset: workspace.deleteDataset,
    onReorderDataset: workspace.reorderDataset,
    onToggleDataset: workspace.toggleWorkspaceDataset,
    onImportKml: async (file) => {
      if (!workspace.activeWorkspace) return null;
      return workspace.importKml(file, workspace.activeWorkspace.id);
    },
    onExportDataset: (datasetId) => {
      const dataset = workspace.activeWorkspaceDatasets.find((item) => item.id === datasetId);
      if (!dataset) return;
      downloadGeoJson(`${dataset.name}.geojson`, dataset.featureCollection);
    },
    onRenameSavedLocation: workspace.renameSavedLocation,
    onDeleteSavedLocation: workspace.deleteSavedLocation,
    recentSelections,
    onJumpToRecent: jumpToFeature,
    onSaveRecent: saveFeatureToWorkspace,
  };

  return (
    <div className="app-shell">
      {!progress.criticalLoaded && <LoadingOverlay progress={progress} errorKeys={errorKeys} />}

      <Suspense fallback={<div className="app-boot">Loading map renderer…</div>}>
        <MapView
          viewState={viewState}
          setViewState={setViewState}
          filteredData={filteredData}
          showBoundaries={showBoundaries}
          visibleLayers={visibleLayers}
          mapTheme="light"
          hoverInfo={hoverInfo}
          setHoverInfo={(info) => {
            clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => setHoverInfo(info), 32);
          }}
          activeTool={activeTool}
          handleMapClick={handleMapClick}
          measurePoints={measurePoints}
          measureMousePos={measureMousePos}
          setMeasureMousePos={setMeasureMousePos}
          proximityCenter={proximityCenter}
          proximityRadius={proximityRadius}
          workspaceFeatures={workspace.mapDatasetFeatures}
          savedLocationFeatures={workspace.savedLocationFeatures}
          traceInfo={traceInfo}
          setHoveredSubId={setHoveredSubId}
        />
      </Suspense>

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchResults={searchResults}
        onJumpToFeature={jumpToFeature}
        regionFilter={regionFilter}
        setRegionFilter={setRegionFilter}
        fuelFilter={fuelFilter}
        setFuelFilter={setFuelFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        voltageFilters={voltageFilters}
        toggleVoltageChip={(kv) => {
          setVoltageFilters((current) => {
            const next = new Set(current);
            next.delete('All');
            if (next.has(kv)) next.delete(kv);
            else next.add(kv);
            return next.size ? next : new Set(['All']);
          });
        }}
        resetVoltageChips={() => setVoltageFilters(new Set(['All']))}
        activeTool={activeTool}
        switchTool={switchTool}
        visibleLayers={visibleLayers}
        setVisibleLayers={setVisibleLayers}
        showBoundaries={showBoundaries}
        setShowBoundaries={setShowBoundaries}
        logout={logout}
        workspace={sidebarWorkspaceProps}
        sectionRefs={sectionRefs}
      />

      <BottomPanel
        panel={panel}
        adjacencyMap={adjacencyMap}
        proximityResults={proximityResults}
        proximityRadius={proximityRadius}
        onProximityRadiusChange={setProximityRadius}
        onClose={() => setPanel({ type: null, data: null })}
        onSaveLocation={saveSelectedFeature}
        measurePoints={measurePoints}
        measureMousePos={measureMousePos}
        onMeasureUndo={() => setMeasurePoints((current) => current.slice(0, -1))}
        onMeasureClear={() => setMeasurePoints([])}
        onMobileBack={() => setSidebarOpen(true)}
        onJumpTo={jumpToFeature}
        onExportBuffer={() => {
          if (!proximityCenter) return;
          downloadGeoJson('buffer.geojson', makeCircleGeoJSON(proximityCenter.lng, proximityCenter.lat, proximityRadius));
        }}
        onFindNearest={() => openNearestForFeature(panel.data)}
        onOpenProximity={() => openProximityForFeature(panel.data)}
      />

      <MapLegend open={legendOpen} onToggle={() => setLegendOpen((current) => !current)} />

      {hoveredSubId && !activeTool && (
        <div className="substation-hint glass-panel">Tap a substation to inspect its connected lines.</div>
      )}

      <div className="floating-actions">
        <button className="floating-btn mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Open controls">
          <Menu size={16} />
        </button>
        <button className="floating-btn" onClick={handleLocateMe} aria-label="Locate me">
          <LocateFixed size={16} />
        </button>
        <button className="floating-btn" onClick={resetHome} aria-label="Reset map">
          <Home size={16} />
        </button>
      </div>

      <div className="mobile-action-bar glass-panel mobile-only">
        <button className="mobile-action-btn" onClick={() => openSidebarSection('search')}>
          <Search size={14} />
          Search
        </button>
        <button className="mobile-action-btn" onClick={() => openSidebarSection('layers')}>
          <Layers3 size={14} />
          Layers
        </button>
        <button className="mobile-action-btn" onClick={() => openSidebarSection('tools')}>
          <SlidersHorizontal size={14} />
          Tools
        </button>
        <button className="mobile-action-btn" onClick={() => openSidebarSection('workspace')}>
          <FolderOpen size={14} />
          Workspace
        </button>
      </div>

      {locationState.kind !== 'idle' && (
        <div className={`location-toast glass-panel location-toast--${locationState.kind}`}>
          <LocateFixed size={14} />
          <span>{locationState.message}</span>
        </div>
      )}

    </div>
  );
}
