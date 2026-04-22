export default function ProximityPanel({ results, radius, onRadiusChange, onJumpTo, onExportBuffer }) {
  const substations = results.filter((result) => result.props.type === 'substation');

  return (
    <div className="panel-scroll">
      <div className="radius-control">
        <div className="radius-header">
          <span>Search radius</span>
          <strong>{radius} km</strong>
        </div>
        <input
          className="radius-slider"
          type="range"
          min="2"
          max="100"
          step="1"
          value={radius}
          onChange={(event) => onRadiusChange(Number(event.target.value))}
        />
        <button className="secondary-btn" onClick={onExportBuffer}>Export buffer</button>
      </div>
      <div className="metric-grid">
        <div className="metric-card">
          <strong>{results.length}</strong>
          <span>Assets</span>
        </div>
        <div className="metric-card">
          <strong>{substations.length}</strong>
          <span>Substations</span>
        </div>
        <div className="metric-card">
          <strong>{results[0] ? `${results[0].dist.toFixed(1)} km` : '—'}</strong>
          <span>Nearest</span>
        </div>
      </div>
      <div className="proximity-list">
        {results.map((result) => (
          <button key={`${result.props.id}-${result.dist}`} className="list-row" onClick={() => onJumpTo(result.feature)}>
            <div>
              <div className="list-title">{result.props.name || 'Unnamed asset'}</div>
              <div className="list-subtitle">{result.props.state_region || result.props.region || 'Unknown region'}</div>
            </div>
            <strong>{result.dist.toFixed(1)} km</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
