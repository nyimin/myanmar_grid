import { ArrowDown, ArrowUp, Download, FolderPlus, Pencil, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

function geometrySummaryLabel(summary = {}) {
  const labels = Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .map(([key, value]) => `${value} ${key}`);

  return labels.join(' · ') || 'No geometry summary';
}

export default function WorkspacePanel({
  workspaces = [],
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  status,
  datasets = [],
  savedLocations = [],
  onRenameDataset,
  onDeleteDataset,
  onReorderDataset,
  onToggleDataset,
  onImportKml,
  onExportDataset,
  onRenameSavedLocation,
  onDeleteSavedLocation,
  recentSelections = [],
  onJumpToRecent,
  onSaveRecent,
}) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [importFeedback, setImportFeedback] = useState([]);

  const handleFiles = async (files) => {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.kml')) {
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

  return (
    <section className="workspace-card">
      <div className="workspace-header">
        <div>
          <h2>Workspace</h2>
          <p>{status.message}</p>
        </div>
        <button
          className="secondary-btn"
          onClick={() => {
            const name = window.prompt('Name the new workspace');
            if (name) onCreateWorkspace(name);
          }}
        >
          <FolderPlus size={14} />
          New
        </button>
      </div>

      <label className="field-label">
        Active workspace
        <select className="dropdown" value={activeWorkspaceId} onChange={(event) => onSelectWorkspace(event.target.value)}>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
      </label>

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
        <p className="panel-hint">Drag and drop `.kml` files here or use upload.</p>
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

      <div className="workspace-section">
        <div className="section-title">Datasets</div>
        {datasets.length === 0 && <p className="panel-hint">No uploaded datasets yet.</p>}
        {datasets.map((dataset) => (
          <div key={dataset.id} className="workspace-item">
            <label className="workspace-toggle">
              <input
                type="checkbox"
                checked={dataset.visible}
                onChange={(event) => onToggleDataset(dataset.id, event.target.checked)}
              />
              <span>{dataset.name}</span>
            </label>
            <div className="workspace-meta">{geometrySummaryLabel(dataset.geometrySummary)}</div>
            <div className="workspace-actions">
              <button className="secondary-btn icon-only-btn" onClick={() => onReorderDataset(dataset.id, 'up')} aria-label="Move dataset up">
                <ArrowUp size={14} />
              </button>
              <button className="secondary-btn icon-only-btn" onClick={() => onReorderDataset(dataset.id, 'down')} aria-label="Move dataset down">
                <ArrowDown size={14} />
              </button>
              <button
                className="secondary-btn"
                onClick={() => {
                  const name = window.prompt('Rename dataset', dataset.name);
                  if (name && name !== dataset.name) onRenameDataset(dataset.id, name);
                }}
              >
                Rename
              </button>
              <button className="secondary-btn icon-only-btn" onClick={() => onExportDataset(dataset.id)} aria-label="Export dataset">
                <Download size={14} />
              </button>
              <button className="secondary-btn icon-only-btn" onClick={() => onDeleteDataset(dataset.id)} aria-label="Delete dataset">
                <Trash2 size={14} />
              </button>
              {dataset.pendingSync && <span className="sync-pill">Pending sync</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="workspace-section">
        <div className="section-title">Saved locations</div>
        {savedLocations.length === 0 && <p className="panel-hint">No saved points yet.</p>}
        {savedLocations.map((location) => (
          <div key={location.id} className="workspace-item">
            <div className="workspace-item-title">{location.name}</div>
            <div className="workspace-meta">{location.metadata?.sourceName || location.metadata?.type || 'Saved point'}</div>
            <div className="workspace-actions">
              <button
                className="secondary-btn icon-only-btn"
                onClick={() => {
                  const name = window.prompt('Rename saved location', location.name);
                  if (name && name !== location.name) onRenameSavedLocation(location.id, name);
                }}
                aria-label="Rename saved location"
              >
                <Pencil size={14} />
              </button>
              <button className="secondary-btn icon-only-btn" onClick={() => onDeleteSavedLocation(location.id)} aria-label="Delete saved location">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="workspace-section">
        <div className="section-title">Recent selections</div>
        {recentSelections.length === 0 && <p className="panel-hint">Tap the map to build a quick history here.</p>}
        {recentSelections.map((selection) => (
          <div key={selection.id} className="workspace-item">
            <div className="workspace-item-title">{selection.name}</div>
            <div className="workspace-meta">{selection.meta}</div>
            <div className="workspace-actions">
              <button className="secondary-btn" onClick={() => onJumpToRecent(selection.feature)}>Open</button>
              <button className="secondary-btn" onClick={() => onSaveRecent(selection.feature)}>Save</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
