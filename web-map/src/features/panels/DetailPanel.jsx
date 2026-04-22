import { Check, ChevronDown, ChevronUp, ClipboardCopy, Crosshair, GitBranch, LocateFixed, MapPinned, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

function formatKey(key) {
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildSummary(props, geometryType, adjacencyMap) {
  const items = [
    ['Type', props.type || geometryType],
    ['Region', props.state_region || props.region || 'Unknown'],
  ];

  if (props.voltage_kv) items.push(['Voltage', `${props.voltage_kv} kV`]);
  if (props.capacity) items.push(['Capacity', `${props.capacity} MW`]);
  if (props.fuel_type) items.push(['Generation', props.fuel_type]);
  if (props.operational_status) items.push(['Status', props.operational_status]);
  if (props.type === 'substation' && adjacencyMap[props.id]) items.push(['Connections', `${adjacencyMap[props.id].length} lines`]);

  return items.slice(0, 5);
}

export default function DetailPanel({ feature, adjacencyMap, onSaveLocation, onFindNearest, onOpenProximity }) {
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(window.innerWidth > 720);
  const props = useMemo(() => feature?.properties || {}, [feature]);
  const isSubstation = props.type === 'substation';
  const summary = useMemo(() => buildSummary(props, feature.geometry.type, adjacencyMap), [adjacencyMap, feature.geometry.type, props]);

  const rows = useMemo(() => {
    const ignoredKeys = new Set(['name', 'type', 'id', '__workspace', 'workspaceId', 'datasetName']);
    const items = [];
    if (isSubstation && adjacencyMap[props.id]) {
      items.push(['Connections', `${adjacencyMap[props.id].length} lines`]);
    }
    Object.entries(props).forEach(([key, value]) => {
      if (ignoredKeys.has(key) || value === null || value === '') return;
      items.push([formatKey(key), typeof value === 'object' ? JSON.stringify(value) : String(value)]);
    });
    return items;
  }, [adjacencyMap, isSubstation, props]);

  const exportText = [
    `# ${props.name || 'Feature'}`,
    `type: ${feature.geometry.type}`,
    `coordinates: ${JSON.stringify(feature.geometry.coordinates)}`,
    ...Object.entries(props).filter(([, value]) => value != null).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`),
  ].join('\n');

  useEffect(() => {
    const onResize = () => setShowAdvanced(window.innerWidth > 720);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const primaryRows = rows.slice(0, 6);
  const secondaryRows = rows.slice(6);

  return (
    <div className="panel-scroll">
      <div className="inspect-hero">
        <div className="inspect-kicker">{props.type || feature.geometry.type}</div>
        <div className="inspect-title">{props.name || props.datasetName || 'Selected feature'}</div>
        <div className="inspect-subtitle">
          {props.state_region || props.region || 'Myanmar'}{props.datasetName ? ` · ${props.datasetName}` : ''}
        </div>
      </div>

      <div className="inspect-summary-grid">
        {summary.map(([label, value]) => (
          <div key={label} className="inspect-summary-card">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="panel-toolbar">
        <button
          className="secondary-btn"
          onClick={() => {
            navigator.clipboard.writeText(exportText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="primary-btn" onClick={onSaveLocation}>
          <Plus size={14} />
          Save Location
        </button>
        <button className="secondary-btn" onClick={onFindNearest}>
          <LocateFixed size={14} />
          Nearest
        </button>
        <button className="secondary-btn" onClick={onOpenProximity}>
          <Crosshair size={14} />
          Buffer
        </button>
      </div>
      {isSubstation && (
        <div className="metric-banner">
          <GitBranch size={14} />
          <span>{adjacencyMap[props.id]?.length || 0} connected lines</span>
        </div>
      )}
      <div className="metric-banner metric-banner--info">
        <MapPinned size={14} />
        <span>Quick actions help you save, scan nearby assets, or check the closest grid connection.</span>
      </div>
      <div className="detail-list">
        {primaryRows.map(([label, value]) => (
          <div key={label} className="detail-row">
            <span className="detail-label">{label}</span>
            <span className="detail-value">{value}</span>
          </div>
        ))}
      </div>
      {secondaryRows.length > 0 && (
        <div className="detail-advanced">
          <button className="secondary-btn detail-toggle" onClick={() => setShowAdvanced((current) => !current)}>
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showAdvanced ? 'Hide details' : `More details (${secondaryRows.length})`}
          </button>
          {showAdvanced && (
            <div className="detail-list">
              {secondaryRows.map(([label, value]) => (
                <div key={label} className="detail-row">
                  <span className="detail-label">{label}</span>
                  <span className="detail-value">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
