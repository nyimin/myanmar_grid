import re

path = "/Users/nyimin/Library/CloudStorage/OneDrive-SharedLibraries-Triune/Stack Space - Documents/Code/MM Grid/web-map/src/App.jsx"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the component entirely from function AnalysisDashboard to just before function ViabilityContent
start_idx = content.find("function AnalysisDashboard({")
end_idx = content.find("// ── Viability Content (state machine dispatcher)")

if start_idx == -1 or end_idx == -1:
    print("Could not find start or end index.")
    exit(1)

new_func = """function AnalysisDashboard({ result, meteoData, meteoLoading, config, onReconfigure, onNewPin }) {
  const { tech, capMW } = config;

  // ── Monthly chart state — Phase 5: moved out of useMemo to local state ──
  const [solarMonthlyDisplay, setSolarMonthlyDisplay] = useState(null);
  const [windMonthlyDisplay,  setWindMonthlyDisplay]  = useState(null);
  const [chartVersion, setChartVersion] = useState(0);

  useEffect(() => {
    if (meteoData?.solarMonthly?.length) {
      const scaled = meteoData.solarMonthly.map(v => v ? Math.round((v * capMW * 1000) / 1e3 * 10) / 10 : 0);
      setSolarMonthlyDisplay(scaled);
      setChartVersion(v => v + 1);
    }
  }, [meteoData?.solarMonthly, capMW]);

  useEffect(() => {
    if (meteoData?.windMonthly?.length) {
      const scaled = meteoData.windMonthly.map(m =>
        m ? Math.round(capMW * 8760 / 12 * windCF(m) * 0.85 / 1000 * 10) / 10 : 0
      );
      setWindMonthlyDisplay(scaled);
      setChartVersion(v => v + 1);
    }
  }, [meteoData?.windMonthly, capMW]);

  // ── Derived values ────────────────────────────────────────────────────────
  const solarYield   = meteoData?.solarYield ?? null;
  const ws100        = meteoData?.ws100 ?? null;
  const slopeMax     = meteoData?.slopeMax ?? null;
  const roadDistKm   = meteoData?.roadDistKm ?? null;

  const cf           = windCF(ws100);
  const solarGWhYr   = solarYield ? (capMW * 1000 * solarYield) / 1e6 : null;
  const windGWhYr    = ws100 ? Math.round(capMW * 8760 * cf * 0.85 / 1000 * 10) / 10 : null;
  const solarLandHa  = Math.round(capMW * 1.5);
  const windLeaseHa  = Math.round(capMW * 25);

  // ── Score modules ─────────────────────────────────────────────────────────
  const resourceScore = result ? Math.round(scoreResource(tech, solarYield, ws100)) : 0;
  const gridScores    = result ? scoreGridIntegration(result.subDist, result.lineDist, result.subVoltage, capMW) : null;
  const siteScores    = result ? scoreSite(tech, slopeMax, roadDistKm) : null;
  const composite     = Math.round(gridScores && siteScores ? resourceScore + gridScores.total + siteScores.total : 0);
  const grade         = getGrade(composite);

  // ── Flags ─────────────────────────────────────────────────────────────────
  const flags = [];
  if (result) {
    const minV = minVoltageForCapacity(capMW);
    if (result.subDist > 20)       flags.push({ type: 'red',    text: `Nearest substation ${result.subDist.toFixed(1)} km — high interconnection capex` });
    else if (result.subDist > 15)  flags.push({ type: 'yellow', text: `Grid distance ${result.subDist.toFixed(1)} km — line upgrades likely needed` });
    if (result.subVoltage && result.subVoltage < minV)
                                   flags.push({ type: 'yellow', text: `Nearest sub ${result.subVoltage} kV — below ${minV} kV minimum for ${capMW} MW` });
    if (slopeMax !== null) {
      const slopeLimit = tech === 'wind' ? 20 : 12;
      if (slopeMax > slopeLimit)   flags.push({ type: 'red',    text: `Slope ${slopeMax}% — exceeds ${slopeLimit}% earthworks threshold` });
      else if (slopeMax <= 5)      flags.push({ type: 'green',  text: `Slope ${slopeMax}% — excellent, minimal earthworks` });
      else                         flags.push({ type: 'yellow', text: `Slope ${slopeMax}% — manageable but review terrain` });
    }
    if (tech === 'solar' && solarYield) {
      if (solarYield >= 1700)      flags.push({ type: 'green',  text: `Solar yield ${Math.round(solarYield).toLocaleString()} kWh/kWp/yr — Class I (Excellent)` });
      else if (solarYield >= 1500) flags.push({ type: 'yellow', text: `Solar yield ${Math.round(solarYield).toLocaleString()} kWh/kWp/yr — Class II (Good)` });
      else                         flags.push({ type: 'red',    text: `Solar yield ${Math.round(solarYield).toLocaleString()} kWh/kWp/yr — marginal resource` });
    }
    if (tech === 'wind' && ws100) {
      if (ws100 >= 7.0)            flags.push({ type: 'green',  text: `Wind ${ws100.toFixed(1)} m/s @ 100m — viable resource` });
      else if (ws100 >= 5.5)       flags.push({ type: 'yellow', text: `Wind ${ws100.toFixed(1)} m/s @ 100m — marginal, check micro-siting` });
      else                         flags.push({ type: 'red',    text: `Wind ${ws100.toFixed(1)} m/s @ 100m — below commercial threshold` });
    }
  }

  const flagColor = { red:'#ef4444', yellow:'#facc15', green:'#34d399' };
  const flagIcon  = { red:'⛔', yellow:'⚠️', green:'✅' };

  return (
    <div className="viability-root">
      {/* ── Header ── */}
      <div className="dash-header">
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
          <div>
            <div className="dash-coords">{result?.targetPoint ? `${result.targetPoint.lat.toFixed(4)}°N, ${result.targetPoint.lng.toFixed(4)}°E` : '—'}</div>
            <div className="dash-config-line">
              {tech === 'solar' ? '☀️ Solar PV' : '🌬️ Onshore Wind'} · {capMW} MW
            </div>
          </div>
          <div style={{ display:'flex', gap:4 }}>
            <button className="dash-action-btn" onClick={onReconfigure} title="Reconfigure">⚙️</button>
            <button className="dash-action-btn" onClick={onNewPin} title="New location">📍</button>
          </div>
        </div>
      </div>

      {/* ── Loading state ── */}
      {meteoLoading && (
        <div className="dash-loading">
          <div className="dash-loading-stages">
            {['Fetching resource data…','Analysing grid proximity…','Computing scores…'].map((s, i) => (
              <div key={i} className="dash-loading-stage">
                <span className="meteo-spinner" style={{ borderTopColor: i === 0 ? '#facc15' : i === 1 ? '#60a5fa' : '#34d399' }} />
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Scores ── */}
      {!meteoLoading && (
        <div className="viability-modal-body">
          
          <div className="viability-modal-left">
            {/* Overall grade */}
            <div className="dash-overall">
              <div className="dash-grade-ring" style={{ borderColor: grade.color }}>
                <span className="dash-grade-num" style={{ color: grade.color }}>{composite}</span>
                <span className="dash-grade-denom">/100</span>
              </div>
              <div>
                <div className="dash-grade-label" style={{ color: grade.color }}>{grade.symbol} {grade.label}</div>
                <div className="dash-grade-sub">Composite score across 3 modules</div>
              </div>
            </div>

            {/* Sub-scores detail */}
            {gridScores && (
              <div className="dash-section">
                <div className="vsec-title">Grid Integration Breakdown</div>
                {[
                  { label:'Sub Distance', score: Math.round(gridScores.subScore),  max:20, color:'#60a5fa' },
                  { label:'Line Distance',score: Math.round(gridScores.lineScore), max:10, color:'#a78bfa' },
                  { label:'Voltage Match',score: Math.round(gridScores.voltScore), max:10, color:'#34d399', canBeNeg: true },
                ].map(b => (
                  <div key={b.label} className="viability-bar-row">
                    <span className="viability-bar-label">{b.label}</span>
                    <div className="viability-bar-track">
                      <div className="viability-bar-fill" style={{
                        width:`${(Math.max(0,b.score)/b.max)*100}%`,
                        background: b.score < 0 ? '#ef4444' : b.color,
                      }} />
                    </div>
                    <span className="viability-bar-pts" style={{ color: b.score < 0 ? '#ef4444' : b.color }}>
                      {b.canBeNeg && b.score > 0 ? '+' : ''}{b.score}/{b.max}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Flags */}
            {flags.length > 0 && (
              <div className="dash-section">
                <div className="vsec-title">Site Assessment</div>
                <div className="dash-flags">
                  {flags.map((f, i) => (
                    <div key={i} className="dash-flag" style={{ borderColor: flagColor[f.type]+'55' }}>
                      <span>{flagIcon[f.type]}</span>
                      <span style={{ color: f.type === 'green' ? '#94a3b8' : flagColor[f.type] }}>{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Infrastructure */}
            {result && (
              <div className="dash-section" style={{ borderBottom: 'none' }}>
                <div className="vsec-title">Grid Infrastructure</div>
                <div className="detail-row">
                  <span className="detail-label">Nearest Substation</span>
                  <span className="detail-value" style={{ color:'#60a5fa' }}>{result.subName || 'Unknown'} — {result.subDist.toFixed(1)} km</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Substation Voltage</span>
                  <span className="detail-value">{result.subVoltage ? `${result.subVoltage} kV` : '?'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Nearest Line</span>
                  <span className="detail-value" style={{ color:'#a78bfa' }}>{result.lineDist.toFixed(1)} km @ {result.lineVoltage ? `${result.lineVoltage} kV` : '? kV'}</span>
                </div>
              </div>
            )}
          </div>

          <div className="viability-modal-right">
            {/* Module cards */}
            <div className="dash-modules">
              {[
                { label:'Resource Quality',  score: resourceScore, max:30, color:'#facc15',  confidence:'High',   icon: tech==='solar'?'☀️':'🌬️' },
                { label:'Grid Integration', score: gridScores ? Math.round(gridScores.total) : 0, max:40, color:'#60a5fa', confidence:'Medium', icon:'⚡' },
                { label:'Site Feasibility', score: siteScores ? Math.round(siteScores.total) : 0, max:30, color:'#34d399', confidence:'Medium', icon:'⛰️' },
              ].map(m => (
                <div key={m.label} className="dash-module-card">
                  <div className="dash-module-top">
                    <span className="dash-module-icon">{m.icon}</span>
                    <span className="dash-module-label">{m.label}</span>
                    <span className="dash-confidence" title={`Confidence: ${m.confidence}`}>{m.confidence === 'High' ? '🟢' : '🟡'}</span>
                  </div>
                  <div className="dash-module-score" style={{ color: m.color }}>{m.score}<span className="dash-module-max">/{m.max}</span></div>
                  <div className="dash-module-bar-track">
                    <div className="dash-module-bar-fill" style={{ width:`${(m.score/m.max)*100}%`, background: m.color }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Key Metrics */}
            <div className="dash-section">
              <div className="vsec-title">Key Metrics</div>
              <div className="dash-metrics-grid">
                {tech === 'solar' && solarGWhYr && (
                  <><div className="dash-metric"><span className="dash-metric-val" style={{color:'#facc15'}}>{solarGWhYr.toFixed(1)}</span><span className="dash-metric-label">GWh/yr</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{Math.round(solarYield).toLocaleString()}</span><span className="dash-metric-label">kWh/kWp/yr</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{solarLandHa}</span><span className="dash-metric-label">ha land</span></div>
                  </>
                )}
                {tech === 'wind' && windGWhYr && (
                  <><div className="dash-metric"><span className="dash-metric-val" style={{color:'#a7f3d0'}}>{windGWhYr}</span><span className="dash-metric-label">GWh/yr</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{Math.round(cf*100)}%</span><span className="dash-metric-label">Cap. Factor</span></div>
                  <div className="dash-metric"><span className="dash-metric-val">{windLeaseHa}</span><span className="dash-metric-label">ha lease</span></div>
                  </>
                )}
                {roadDistKm !== null && (
                  <div className="dash-metric"><span className="dash-metric-val">{roadDistKm}</span><span className="dash-metric-label">km road</span></div>
                )}
                {slopeMax !== null && (
                  <div className="dash-metric"><span className="dash-metric-val" style={{color: slopeMax > (tech==='wind'?20:12) ? '#ef4444':'#34d399'}}>{slopeMax}%</span><span className="dash-metric-label">max slope</span></div>
                )}
              </div>
            </div>

            {/* Monthly chart */}
            {tech === 'solar' && solarMonthlyDisplay && (
              <div className="dash-section">
                <div className="vsec-title">Monthly Generation (MWh)</div>
                <MiniBarChart key={`solar-${chartVersion}`} data={solarMonthlyDisplay} color="#facc15" />
              </div>
            )}
            {tech === 'wind' && windMonthlyDisplay && (
              <div className="dash-section">
                <div className="vsec-title">Monthly Wind Speed (m/s)</div>
                <MiniBarChart key={`wind-${chartVersion}`} data={meteoData?.windMonthly} color="#a7f3d0" />
              </div>
            )}

            <div style={{ flex: 1 }} />
            <p className="panel-hint" style={{margin:'16px 16px 12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px'}}>
              Scores derived from PVGIS/ERA5 meteorological data, MIMU road network, and local GeoJSON grid data. For indicative purposes only.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

"""

new_content = content[:start_idx] + new_func + content[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"Successfully replaced AnalysisDashboard")
