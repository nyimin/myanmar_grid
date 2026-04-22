import { ChevronLeft, Crosshair, LocateFixed, MapPin, Ruler, X } from 'lucide-react';
import DetailPanel from './DetailPanel.jsx';
import MeasurePanel from './MeasurePanel.jsx';
import NearestAssetPanel from './NearestAssetPanel.jsx';
import ProximityPanel from './ProximityPanel.jsx';

export default function BottomPanel({
  panel,
  adjacencyMap,
  proximityResults,
  proximityRadius,
  onProximityRadiusChange,
  onClose,
  onSaveLocation,
  workspaces,
  saveWorkspaceId,
  onSaveWorkspaceChange,
  measurePoints,
  measureMousePos,
  onMeasureUndo,
  onMeasureClear,
  onMobileBack,
  onJumpTo,
  onExportBuffer,
  onFindNearest,
  onOpenProximity,
}) {
  if (!panel.type) return null;

  const titles = {
    detail: panel.data?.properties?.name || 'Feature Details',
    proximity: 'Proximity Scan',
    measure: 'Measure Distance',
    nearest: 'Nearest Asset',
  };
  const icons = {
    detail: <MapPin size={16} />,
    proximity: <Crosshair size={16} />,
    measure: <Ruler size={16} />,
    nearest: <LocateFixed size={16} />,
  };

  return (
    <div className="panel-sheet glass-panel">
      <div className="panel-header">
        <div className="panel-header-title">
          {icons[panel.type]}
          <span>{titles[panel.type]}</span>
        </div>
        <div className="panel-header-actions">
          <button className="icon-btn mobile-only" onClick={onMobileBack} aria-label="Back to controls">
            <ChevronLeft size={16} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>
      </div>

      {panel.type === 'detail' && (
        <DetailPanel
          feature={panel.data}
          adjacencyMap={adjacencyMap}
          onSaveLocation={onSaveLocation}
          workspaces={workspaces}
          saveWorkspaceId={saveWorkspaceId}
          onSaveWorkspaceChange={onSaveWorkspaceChange}
          onFindNearest={onFindNearest}
          onOpenProximity={onOpenProximity}
        />
      )}
      {panel.type === 'proximity' && (
        <ProximityPanel
          results={proximityResults}
          radius={proximityRadius}
          onRadiusChange={onProximityRadiusChange}
          onJumpTo={onJumpTo}
          onExportBuffer={onExportBuffer}
        />
      )}
      {panel.type === 'measure' && (
        <MeasurePanel
          points={measurePoints}
          mousePos={measureMousePos}
          onUndo={onMeasureUndo}
          onClear={onMeasureClear}
        />
      )}
      {panel.type === 'nearest' && (
        <NearestAssetPanel result={panel.data} onJumpTo={onJumpTo} />
      )}
    </div>
  );
}
