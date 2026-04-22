import { ClipboardCopy, Trash2, Undo2 } from 'lucide-react';
import { useMemo } from 'react';
import { formatDist, haversineKm } from '../../lib/geo.js';

export default function MeasurePanel({ points, mousePos, onUndo, onClear }) {
  const segments = useMemo(() => {
    const allPoints = mousePos ? [...points, mousePos] : points;
    return allPoints.slice(1).map((point, index) => {
      const from = allPoints[index];
      return {
        dist: haversineKm(from.lat, from.lng, point.lat, point.lng),
        isPreview: !!mousePos && index === allPoints.length - 2,
      };
    });
  }, [mousePos, points]);

  const totalDistance = segments.reduce((sum, segment) => sum + segment.dist, 0);

  return (
    <div className="panel-scroll">
      <div className="panel-toolbar">
        <button className="secondary-btn" onClick={onUndo} disabled={!points.length}>
          <Undo2 size={14} />
          Undo
        </button>
        <button className="secondary-btn" onClick={onClear}>
          <Trash2 size={14} />
          Clear
        </button>
        <button
          className="secondary-btn"
          disabled={!segments.length}
          onClick={() => {
            const text = [
              ...segments
                .filter((segment) => !segment.isPreview)
                .map((segment, index) => `Leg ${index + 1}: ${formatDist(segment.dist)}`),
              `Total: ${formatDist(totalDistance)}`,
            ].join('\n');
            navigator.clipboard.writeText(text);
          }}
        >
          <ClipboardCopy size={14} />
          Copy
        </button>
      </div>
      <div className="detail-list">
        {segments.length === 0 && <p className="panel-hint">Tap the map to place measurement points.</p>}
        {segments.map((segment, index) => (
          <div key={`${index}-${segment.dist}`} className="detail-row">
            <span className="detail-label">{segment.isPreview ? 'Cursor preview' : `Leg ${index + 1}`}</span>
            <span className="detail-value">{formatDist(segment.dist)}</span>
          </div>
        ))}
      </div>
      <div className="panel-footer">
        <strong>{formatDist(totalDistance)}</strong>
        <span>Total live distance</span>
      </div>
    </div>
  );
}
