import { Crosshair, LocateFixed, LogOut, Ruler, Search, X } from 'lucide-react';
import { Suspense, lazy } from 'react';

const WorkspacePanel = lazy(() => import('../workspace/WorkspacePanel.jsx'));

function VoltageChips({ voltageFilters, onToggle, onReset }) {
  const chips = [
    { key: '500', color: 'rgb(255,105,180)' },
    { key: '230', color: 'rgb(239,68,68)' },
    { key: '132', color: 'rgb(59,130,246)' },
    { key: '66', color: 'rgb(34,197,94)' },
    { key: '33', color: 'rgb(156,163,175)' },
  ];

  return (
    <div className="chip-row">
      <button className={`chip ${voltageFilters.has('All') ? 'chip--active' : ''}`} onClick={onReset}>All</button>
      {chips.map((chip) => (
        <button
          key={chip.key}
          className={`chip ${voltageFilters.has(chip.key) ? 'chip--active' : ''}`}
          style={voltageFilters.has(chip.key) ? { borderColor: chip.color, background: `${chip.color}22` } : undefined}
          onClick={() => onToggle(chip.key)}
        >
          {chip.key} kV
        </button>
      ))}
    </div>
  );
}

export default function Sidebar(props) {
  const {
    open,
    onClose,
    searchQuery,
    onSearchChange,
    searchResults,
    onJumpToFeature,
    regionFilter,
    setRegionFilter,
    fuelFilter,
    setFuelFilter,
    statusFilter,
    setStatusFilter,
    voltageFilters,
    toggleVoltageChip,
    resetVoltageChips,
    activeTool,
    switchTool,
    visibleLayers,
    setVisibleLayers,
    showBoundaries,
    setShowBoundaries,
    logout,
    workspace,
    sectionRefs,
  } = props;

  return (
    <>
      <aside className={`sidebar glass-panel ${open ? 'sidebar--open' : ''}`}>
        <div className="sidebar-header">
          <div>
            <h1>Myanmar Power Grid</h1>
            <p>Explore grid assets, sites, and saved workspaces</p>
          </div>
          <button className="icon-btn mobile-only" onClick={onClose} aria-label="Close controls">
            <X size={16} />
          </button>
        </div>

        <div className="sidebar-scroll">
          <section ref={sectionRefs?.search} className="sidebar-section">
            <label className="field-label">
              Search assets
              <div className="search-shell">
                <Search size={14} />
                <input
                  type="text"
                  className="search-input"
                  value={searchQuery}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="Substations, plants, saved locations…"
                />
              </div>
            </label>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((feature) => (
                  <button key={`${feature.properties.id}-${feature.properties.name}`} className="list-row" onClick={() => onJumpToFeature(feature)}>
                    <div>
                      <div className="list-title">{feature.properties.name}</div>
                      <div className="list-subtitle">{feature.properties.state_region || feature.properties.datasetName || 'Workspace feature'}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section ref={sectionRefs?.filters} className="sidebar-section">
            <div className="section-title">Filters</div>
            <label className="field-label">
              Region / State
              <select className="dropdown" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
                <option value="All">All Regions / States</option>
                {['Ayeyarwady', 'Bago', 'Chin', 'Kachin', 'Kayah', 'Kayin', 'Magway', 'Mandalay', 'Mon', 'Naypyitaw', 'Rakhine', 'Sagaing', 'Shan', 'Tanintharyi', 'Yangon'].map((region) => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Generation type
              <select className="dropdown" value={fuelFilter} onChange={(event) => setFuelFilter(event.target.value)}>
                <option value="All">All</option>
                {['gas', 'hydro', 'solar', 'coal', 'wind'].map((fuel) => (
                  <option key={fuel} value={fuel}>{fuel[0].toUpperCase()}{fuel.slice(1)}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Status
              <select className="dropdown" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="All">All Statuses</option>
                <option value="operational">Operational</option>
                <option value="planned">Planned</option>
                <option value="under_construction">Under Construction</option>
              </select>
            </label>
            <label className="field-label">
              Voltage
              <VoltageChips voltageFilters={voltageFilters} onToggle={toggleVoltageChip} onReset={resetVoltageChips} />
            </label>
          </section>

          <section ref={sectionRefs?.tools} className="sidebar-section">
            <div className="section-title">Tools</div>
            <div className="tool-grid">
              <button className={`tool-btn ${activeTool === 'proximity' ? 'tool-btn--active' : ''}`} onClick={() => switchTool('proximity')}>
                <Crosshair size={14} />
                {activeTool === 'proximity' ? 'Cancel scan' : 'Proximity scan'}
              </button>
              <button className={`tool-btn ${activeTool === 'measure' ? 'tool-btn--active' : ''}`} onClick={() => switchTool('measure')}>
                <Ruler size={14} />
                {activeTool === 'measure' ? 'Stop measure' : 'Measure'}
              </button>
              <button className={`tool-btn ${activeTool === 'nearest' ? 'tool-btn--active' : ''}`} onClick={() => switchTool('nearest')}>
                <LocateFixed size={14} />
                {activeTool === 'nearest' ? 'Cancel nearest' : 'Nearest asset'}
              </button>
            </div>
          </section>

          <section ref={sectionRefs?.layers} className="sidebar-section">
            <div className="section-title">Layers</div>
            <div className="layer-list">
              {[
                ['lines', 'Transmission Lines'],
                ['substations', 'Substations'],
                ['plants', 'Power Plants'],
                ['hydro', 'Hydro Dams'],
              ].map(([key, label]) => (
                <label key={key} className="toggle-row">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={visibleLayers[key]}
                    onChange={(event) => setVisibleLayers((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                </label>
              ))}
              <label className="toggle-row">
                <span>Admin Boundaries</span>
                <input type="checkbox" checked={showBoundaries} onChange={(event) => setShowBoundaries(event.target.checked)} />
              </label>
            </div>
          </section>

          <Suspense fallback={<section className="workspace-card"><p className="panel-hint">Loading workspace…</p></section>}>
            <div ref={sectionRefs?.workspace}>
            <WorkspacePanel {...workspace} />
            </div>
          </Suspense>

          <button className="logout-btn" onClick={logout}>
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </aside>
      {open && <button className="sidebar-overlay" aria-label="Close controls" onClick={onClose} />}
    </>
  );
}
