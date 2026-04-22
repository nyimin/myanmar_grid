import { ChevronDown, ChevronUp, Layers3 } from 'lucide-react';

const legendItems = [
  { swatchClass: 'legend-swatch legend-swatch--line-500', label: '500 kV transmission' },
  { swatchClass: 'legend-swatch legend-swatch--line-230', label: '230 kV transmission' },
  { swatchClass: 'legend-swatch legend-swatch--line-132', label: '132 kV transmission' },
  { swatchClass: 'legend-swatch legend-swatch--substation', label: 'Substation' },
  { swatchClass: 'legend-swatch legend-swatch--plant', label: 'Power plant' },
  { swatchClass: 'legend-swatch legend-swatch--hydro', label: 'Hydro dam' },
  { swatchClass: 'legend-swatch legend-swatch--workspace', label: 'Workspace point' },
  { swatchClass: 'legend-swatch legend-swatch--saved', label: 'Saved location' },
];

export default function MapLegend({ open, onToggle }) {
  return (
    <div className={`map-legend glass-panel ${open ? 'map-legend--open' : ''}`}>
      <button className="map-legend-toggle" onClick={onToggle} aria-expanded={open} aria-label="Toggle legend">
        <span className="map-legend-title">
          <Layers3 size={15} />
          Legend
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
      {open && (
        <div className="map-legend-list">
          {legendItems.map((item) => (
            <div key={item.label} className="map-legend-row">
              <span className={item.swatchClass} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
