export default function LoadingOverlay({ progress, errorKeys }) {
  const loadingLabel = progress.loaded < 3 ? 'Loading core grid layers…' : 'Preparing app shell…';

  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <span className="loading-logo">⚡</span>
        <h2 className="loading-title">Myanmar Power Grid</h2>
        <p className="loading-subtitle">{loadingLabel}</p>
        <div className="loading-progress-track">
          <div
            className="loading-progress-bar"
            style={{ width: `${Math.max(8, (progress.loaded / progress.total) * 100)}%` }}
          />
        </div>
        <p className="loading-step-label">
          {progress.loaded}/{progress.total} datasets ready
        </p>
        {errorKeys.size > 0 && (
          <div className="loading-error">
            Some optional layers failed to load and may be unavailable.
          </div>
        )}
      </div>
    </div>
  );
}
