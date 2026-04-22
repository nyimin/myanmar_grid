export const DATASET_MANIFEST = {
  lines: {
    key: 'lines',
    label: 'Transmission Lines',
    url: '/data/myanmar_transmission_lines_final.geojson',
    stage: 'critical',
  },
  substations: {
    key: 'substations',
    label: 'Substations',
    url: '/data/myanmar_substations_final.geojson',
    stage: 'critical',
  },
  plants: {
    key: 'plants',
    label: 'Power Plants',
    url: '/data/myanmar_powerplants_final.geojson',
    stage: 'critical',
  },
  hydro: {
    key: 'hydro',
    label: 'Hydro Dams',
    url: '/data/myanmar_hydrodams_final.geojson',
    stage: 'deferred',
  },
  boundaries: {
    key: 'boundaries',
    label: 'Admin Boundaries',
    url: '/data/myanmar_admin1_boundaries.geojson',
    stage: 'deferred',
  },
};
