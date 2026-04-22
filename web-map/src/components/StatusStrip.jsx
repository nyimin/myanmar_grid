import { Home, Menu } from 'lucide-react';

export default function StatusStrip({ stats, activeTool, onResetHome, regionFilter, onOpenSidebar }) {
  const toolColors = { measure: '#34d399', proximity: '#a78bfa' };
  const toolLabels = { measure: 'Measuring', proximity: 'Proximity Mode' };

  return (
    <div className="status-strip glass-panel" role="status" aria-live="polite">
      <button className="status-icon-btn status-mobile-only" onClick={onOpenSidebar} aria-label="Open controls">
        <Menu size={16} />
      </button>
      <div className="status-stats">
        <div className="stat-item">
          <span className="stat-dot" style={{ background: '#facc15' }} />
          <div>
            <div className="stat-value">{stats.totalCapMW.toLocaleString()} MW</div>
            <div className="stat-label">Capacity</div>
          </div>
        </div>
        <div className="stat-item">
          <span className="stat-dot" style={{ background: '#3b82f6' }} />
          <div>
            <div className="stat-value">{stats.totalLinKm.toLocaleString()} km</div>
            <div className="stat-label">Lines</div>
          </div>
        </div>
        <div className="stat-item">
          <span className="stat-dot" style={{ background: '#94a3b8' }} />
          <div>
            <div className="stat-value">{stats.subCount}</div>
            <div className="stat-label">Subs</div>
          </div>
        </div>
      </div>
      {regionFilter !== 'All' && <span className="status-chip">{regionFilter}</span>}
      {activeTool ? (
        <span className="status-chip" style={{ borderColor: toolColors[activeTool], color: toolColors[activeTool] }}>
          {toolLabels[activeTool]} · Esc to cancel
        </span>
      ) : (
        <span className="status-chip">Tap map to inspect or save a point</span>
      )}
      <button className="status-icon-btn" onClick={onResetHome} aria-label="Reset map">
        <Home size={16} />
      </button>
    </div>
  );
}
