export default function NearestAssetPanel({ result, onJumpTo }) {
  if (!result) return null;

  return (
    <div className="panel-scroll">
      <div className="detail-list">
        {result.items.map((item) => (
          <button key={`${item.label}-${item.name}`} className="list-row" onClick={() => onJumpTo(item.feature)}>
            <div>
              <div className="list-title">{item.label}</div>
              <div className="list-subtitle">{item.name}</div>
            </div>
            <strong>{item.distanceText}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
