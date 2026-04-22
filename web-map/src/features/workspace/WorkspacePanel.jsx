import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  EyeOff,
  FolderPlus,
  LocateFixed,
  MapPinned,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

function geometrySummaryLabel(summary = {}) {
  const labels = Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .map(([key, value]) => `${value} ${key}`);

  return labels.join(' · ') || 'No geometry summary';
}

function featureCountLabel(summary = {}) {
  const total = summary.total || 0;
  return `${total} feature${total === 1 ? '' : 's'}`;
}

function getStatusBadge(status, hasPendingSync) {
  if (hasPendingSync) return { label: 'Pending sync', tone: 'warning' };
  if (status.sync === 'ready') return { label: 'Synced', tone: 'success' };
  if (status.sync === 'syncing') return { label: 'Syncing', tone: 'info' };
  if (status.sync === 'degraded') return { label: 'Offline fallback', tone: 'warning' };
  if (status.sync === 'error') return { label: 'Load error', tone: 'danger' };
  return { label: 'Local only', tone: 'neutral' };
}

function classifySavedLocation(location) {
  const sourceName = location.metadata?.sourceName || '';
  const sourceType = location.metadata?.type || '';
  const isManual = sourceName === 'Map selection' || sourceType === 'selection' || sourceType === 'saved_location';
  return isManual ? 'manual' : 'derived';
}

function buildSavedGroups(savedLocations) {
  const recent = savedLocations.slice(0, 3);
  const recentIds = new Set(recent.map((location) => location.id));
  const derived = savedLocations.filter((location) => !recentIds.has(location.id) && classifySavedLocation(location) === 'derived');
  const manual = savedLocations.filter((location) => !recentIds.has(location.id) && classifySavedLocation(location) === 'manual');

  return [
    { key: 'recent', title: 'Recently saved', items: recent },
    { key: 'derived', title: 'Imported / workspace-derived', items: derived },
    { key: 'manual', title: 'Manual selections', items: manual },
  ].filter((group) => group.items.length > 0);
}

function InlineDialog({
  title,
  description,
  value,
  onChange,
  onSubmit,
  onClose,
  submitLabel,
  danger = false,
}) {
  return (
    <div className="workspace-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="workspace-dialog glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workspace-dialog-header">
          <div>
            <div className="section-title">{title}</div>
            {description ? <p className="panel-hint">{description}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        {typeof value === 'string' && (
          <input
            className="login-input workspace-dialog-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
          />
        )}
        <div className="workspace-dialog-actions">
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
          <button className={danger ? 'danger-btn' : 'primary-btn'} onClick={onSubmit}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkspacePanel({
  workspaces = [],
  activeWorkspace,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  activeWorkspacePendingSync = false,
  status,
  datasets = [],
  savedLocations = [],
  onRenameDataset,
  onDeleteDataset,
  onReorderDataset,
  onToggleDataset,
  onImportKml,
  onZoomToDataset,
  onIsolateDataset,
  onShowAllDatasets,
  onExportDataset,
  onRenameSavedLocation,
  onDeleteSavedLocation,
  onJumpToSavedLocation,
  recentSelections = [],
  onJumpToRecent,
  onSaveRecent,
}) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [importFeedback, setImportFeedback] = useState([]);
  const [mobileTab, setMobileTab] = useState('datasets');
  const [showRecentSelections, setShowRecentSelections] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 960);
  const [expandedDatasetId, setExpandedDatasetId] = useState(null);

  const statusBadge = getStatusBadge(status, activeWorkspacePendingSync);
  const savedGroups = useMemo(() => buildSavedGroups(savedLocations), [savedLocations]);

  useEffect(() => {
    if (!dialog) return;
    setDialogValue(dialog.initialValue || '');
  }, [dialog]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 960);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleFiles = async (files) => {
    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.kmz')) {
        setImportFeedback((current) => [{
          type: 'error',
          message: `${file.name}: KMZ is not supported yet. Please convert it to plain .kml first.`,
        }, ...current].slice(0, 5));
        continue;
      }
      if (!lowerName.endsWith('.kml')) {
        setImportFeedback((current) => [{ type: 'error', message: `${file.name}: only .kml files are supported.` }, ...current].slice(0, 5));
        continue;
      }
      if (datasets.some((dataset) => dataset.name === file.name.replace(/\.kml$/i, ''))) {
        setImportFeedback((current) => [{ type: 'warning', message: `${file.name}: duplicate dataset name, imported anyway.` }, ...current].slice(0, 5));
      }
      try {
        const dataset = await onImportKml(file);
        setImportFeedback((current) => [{
          type: 'success',
          message: `${dataset.name}: ${geometrySummaryLabel(dataset.geometrySummary)} imported.`,
        }, ...current].slice(0, 5));
      } catch (error) {
        setImportFeedback((current) => [{ type: 'error', message: `${file.name}: ${error.message}` }, ...current].slice(0, 5));
      }
    }
  };

  const openNameDialog = (config) => {
    setDialog(config);
    setDialogValue(config.initialValue || '');
  };

  const activeTabClass = (key) => `workspace-tab ${mobileTab === key ? 'workspace-tab--active' : ''}`;
  const visibleCount = datasets.filter((dataset) => dataset.visible).length;

  return (
    <section className="workspace-card workspace-card--manager">
      <div className="workspace-sticky-top">
        <div className="workspace-header workspace-header--manager">
          <div>
            <h2>Workspace</h2>
            <p>{activeWorkspace?.name || 'No active workspace selected.'}</p>
          </div>
          <button
            className="secondary-btn"
            onClick={() => openNameDialog({
              kind: 'create-workspace',
              title: 'Create workspace',
              description: 'Use a short label so it is easy to target when saving locations.',
              submitLabel: 'Create',
              initialValue: '',
              onSubmit: async (name) => {
                const trimmed = name.trim();
                if (!trimmed) return;
                await onCreateWorkspace(trimmed);
                setDialog(null);
              },
            })}
          >
            <FolderPlus size={14} />
            New
          </button>
        </div>

        <div className="workspace-status-row">
          <span className={`status-badge status-badge--${statusBadge.tone}`}>{statusBadge.label}</span>
          <span className="workspace-status-copy">{status.message}</span>
        </div>

        <div className="workspace-switcher">
          <label className="field-label">
            Active workspace
            <select className="dropdown" value={activeWorkspaceId} onChange={(event) => onSelectWorkspace(event.target.value)}>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
          </label>
          <button
            className="secondary-btn"
            onClick={() => openNameDialog({
              kind: 'rename-workspace',
              title: 'Rename workspace',
              description: 'Update the workspace label everywhere it appears in the sidebar.',
              submitLabel: 'Save',
              initialValue: activeWorkspace?.name || '',
              onSubmit: async (name) => {
                const trimmed = name.trim();
                if (!trimmed || !activeWorkspace) return;
                await onRenameWorkspace(activeWorkspace.id, trimmed);
                setDialog(null);
              },
            })}
            disabled={!activeWorkspace}
          >
            <Pencil size={14} />
            Rename
          </button>
        </div>

        <div className="workspace-mobile-tabs mobile-only">
          <button className={activeTabClass('datasets')} onClick={() => setMobileTab('datasets')}>Layers</button>
          <button className={activeTabClass('saved')} onClick={() => setMobileTab('saved')}>Places</button>
          <button className={activeTabClass('recent')} onClick={() => setMobileTab('recent')}>History</button>
        </div>
      </div>

      {(mobileTab === 'datasets' || !isMobile) && (
        <>
          <div className="workspace-section">
            <div className="workspace-section-header">
              <div>
                <div className="section-title">Working layers ({datasets.length})</div>
                <p className="panel-hint">Uploaded KML layers you can zoom to, isolate, and inspect on the map.</p>
              </div>
              {datasets.length > 0 && (
                <button className="secondary-btn" onClick={onShowAllDatasets}>
                  <Eye size={14} />
                  Show all
                </button>
              )}
            </div>
            <div
              className={`workspace-dropzone ${dragActive ? 'workspace-dropzone--active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={async (event) => {
                event.preventDefault();
                setDragActive(false);
                await handleFiles(Array.from(event.dataTransfer.files || []));
              }}
            >
              <button className="primary-btn workspace-upload" onClick={() => inputRef.current?.click()}>
                <Upload size={14} />
                Upload KML
              </button>
              <p className="panel-hint">Import plain `.kml` layers into the active workspace. KMZ archives are not supported yet.</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".kml"
              hidden
              multiple
              onChange={async (event) => {
                const files = Array.from(event.target.files || []);
                await handleFiles(files);
                event.target.value = '';
              }}
            />
            {importFeedback.length > 0 && (
              <div className="workspace-feedback-list">
                {importFeedback.map((item, index) => (
                  <div key={`${item.message}-${index}`} className={`workspace-feedback workspace-feedback--${item.type}`}>
                    {item.message}
                  </div>
                ))}
              </div>
            )}
            {datasets.length === 0 && <p className="panel-hint">No uploaded layers yet. Import a KML layer to start working with its extent and geometry on the map.</p>}
            {datasets.length > 0 && (
              <div className="workspace-summary-strip">
                <span className="sync-pill">{visibleCount} visible</span>
                <span className="sync-pill">{datasets.length - visibleCount} hidden</span>
              </div>
            )}
            {datasets.map((dataset, index) => (
              <div key={dataset.id} className={`workspace-item workspace-item--dataset workspace-layer-card ${dataset.visible ? 'workspace-layer-card--visible' : ''}`}>
                <div className="workspace-item-main">
                  <div className="workspace-layer-title-row">
                    <div className="workspace-item-title">{dataset.name}</div>
                    <span className={`status-badge ${dataset.visible ? 'status-badge--success' : 'status-badge--neutral'}`}>
                      {dataset.visible ? 'Visible' : 'Hidden'}
                    </span>
                  </div>
                  <div className="workspace-meta">
                    {featureCountLabel(dataset.geometrySummary)} · {geometrySummaryLabel(dataset.geometrySummary)}
                  </div>
                </div>
                <div className="workspace-actions workspace-actions--layer-primary">
                  <button className="primary-btn" onClick={() => onZoomToDataset(dataset.id)}>
                    <LocateFixed size={14} />
                    Zoom
                  </button>
                  <button className="secondary-btn" onClick={() => onToggleDataset(dataset.id, !dataset.visible)}>
                    {dataset.visible ? <EyeOff size={14} /> : <Eye size={14} />}
                    {dataset.visible ? 'Hide' : 'Show'}
                  </button>
                  <button className="secondary-btn" onClick={() => setExpandedDatasetId((current) => current === dataset.id ? null : dataset.id)}>
                    {expandedDatasetId === dataset.id ? 'Less' : 'Manage'}
                  </button>
                  {dataset.pendingSync && <span className="sync-pill">Pending sync</span>}
                </div>
                {expandedDatasetId === dataset.id && (
                  <div className="workspace-actions workspace-actions--layer-secondary">
                    <button className="secondary-btn" onClick={() => onIsolateDataset(dataset.id)}>
                      <Eye size={14} />
                      Show only this
                    </button>
                    <button className="secondary-btn icon-only-btn" onClick={() => onReorderDataset(dataset.id, 'up')} aria-label="Move dataset up" disabled={index === 0}>
                      <ArrowUp size={14} />
                    </button>
                    <button className="secondary-btn icon-only-btn" onClick={() => onReorderDataset(dataset.id, 'down')} aria-label="Move dataset down" disabled={index === datasets.length - 1}>
                      <ArrowDown size={14} />
                    </button>
                    <button
                      className="secondary-btn"
                      onClick={() => openNameDialog({
                        kind: 'rename-dataset',
                        title: 'Rename dataset',
                        description: 'This label is shown on the map and in search results.',
                        submitLabel: 'Save',
                        initialValue: dataset.name,
                        onSubmit: async (name) => {
                          const trimmed = name.trim();
                          if (!trimmed) return;
                          await onRenameDataset(dataset.id, trimmed);
                          setDialog(null);
                        },
                      })}
                    >
                      Rename
                    </button>
                    <button className="secondary-btn" onClick={() => onExportDataset(dataset.id)}>
                      <Download size={14} />
                      Export
                    </button>
                    <button
                      className="secondary-btn"
                      onClick={() => openNameDialog({
                        kind: 'delete-dataset',
                        title: 'Delete dataset?',
                        description: `${dataset.name} will be removed from this workspace.`,
                        submitLabel: 'Delete',
                        danger: true,
                        onSubmit: async () => {
                          await onDeleteDataset(dataset.id);
                          setDialog(null);
                        },
                      })}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {(mobileTab === 'saved' || !isMobile) && (
        <div className="workspace-section">
          <div className="workspace-section-header">
            <div>
              <div className="section-title">Saved places ({savedLocations.length})</div>
              <p className="panel-hint">Shortlisted points and bookmarks you want to revisit quickly.</p>
            </div>
          </div>
          {savedLocations.length === 0 && <p className="panel-hint">No saved points yet. Save a feature from the detail panel to keep it in this workspace.</p>}
          {savedGroups.map((group) => (
            <div key={group.key} className="workspace-group">
              <div className="workspace-group-title">{group.title}</div>
              {group.items.map((location) => (
                <div key={location.id} className="workspace-item workspace-item--saved">
                  <div className="workspace-item-main">
                    <div className="workspace-item-title">{location.name}</div>
                    <div className="workspace-meta">{location.metadata?.sourceName || location.metadata?.type || 'Saved point'}</div>
                  </div>
                  <div className="workspace-actions workspace-actions--saved">
                    <button className="primary-btn" onClick={() => onJumpToSavedLocation(location)}>Open</button>
                    <button
                      className="secondary-btn"
                      onClick={() => openNameDialog({
                        kind: 'rename-location',
                        title: 'Rename saved location',
                        description: 'Use a label that helps you find this point later.',
                        submitLabel: 'Save',
                        initialValue: location.name,
                        onSubmit: async (name) => {
                          const trimmed = name.trim();
                          if (!trimmed) return;
                          await onRenameSavedLocation(location.id, trimmed);
                          setDialog(null);
                        },
                      })}
                    >
                      <Pencil size={14} />
                      Rename
                    </button>
                    <button
                      className="secondary-btn icon-only-btn"
                      onClick={() => openNameDialog({
                        kind: 'delete-location',
                        title: 'Delete saved location?',
                        description: `${location.name} will be removed from this workspace.`,
                        submitLabel: 'Delete',
                        danger: true,
                        onSubmit: async () => {
                          await onDeleteSavedLocation(location.id);
                          setDialog(null);
                        },
                      })}
                      aria-label="Delete saved location"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {(mobileTab === 'recent' || !isMobile) && (
        <div className="workspace-section">
          <div className="workspace-section-header">
            <div>
              <div className="section-title">History ({recentSelections.length})</div>
              <p className="panel-hint">Recently inspected map features you may want to reopen or save.</p>
            </div>
            {!isMobile && (
              <button className="secondary-btn" onClick={() => setShowRecentSelections((current) => !current)}>
                {showRecentSelections ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
          {(isMobile || showRecentSelections) && (
            <>
              {recentSelections.length === 0 && <p className="panel-hint">Tap the map to build a quick history here.</p>}
              {recentSelections.map((selection) => (
                <div key={selection.id} className="workspace-item">
                  <div className="workspace-item-main">
                    <div className="workspace-item-title">{selection.name}</div>
                    <div className="workspace-meta">{selection.meta}</div>
                  </div>
                  <div className="workspace-actions workspace-actions--saved">
                    <button className="secondary-btn" onClick={() => onJumpToRecent(selection.feature)}>
                      <MapPinned size={14} />
                      Open
                    </button>
                    <button className="secondary-btn" onClick={() => onSaveRecent(selection.feature)}>
                      <Plus size={14} />
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          {!isMobile && !showRecentSelections && recentSelections.length > 0 && (
            <p className="panel-hint">Recent selections are hidden by default to keep workspace management focused.</p>
          )}
        </div>
      )}

      {dialog && (
        <InlineDialog
          title={dialog.title}
          description={dialog.description}
          value={dialog.initialValue !== undefined ? dialogValue : null}
          onChange={setDialogValue}
          onSubmit={() => dialog.onSubmit(dialogValue)}
          onClose={() => setDialog(null)}
          submitLabel={dialog.submitLabel}
          danger={dialog.danger}
        />
      )}
    </section>
  );
}
