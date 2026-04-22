import { useCallback, useEffect, useMemo, useState } from 'react';
import { DATASET_MANIFEST } from '../config/datasets.js';

const CRITICAL_KEYS = Object.values(DATASET_MANIFEST)
  .filter((dataset) => dataset.stage === 'critical')
  .map((dataset) => dataset.key);

async function loadDataset(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }

  return response.json();
}

export function useStaticDatasets() {
  const [datasets, setDatasets] = useState({
    lines: null,
    substations: null,
    plants: null,
    hydro: null,
    boundaries: null,
  });
  const [loadingKeys, setLoadingKeys] = useState(new Set(CRITICAL_KEYS));
  const [loadedKeys, setLoadedKeys] = useState(new Set());
  const [errorKeys, setErrorKeys] = useState(new Set());

  const ensureDataset = useCallback(async (key) => {
    const manifest = DATASET_MANIFEST[key];
    if (!manifest) return null;

    let alreadyLoaded = false;
    setDatasets((current) => {
      if (current[key]) alreadyLoaded = true;
      return current;
    });
    if (alreadyLoaded) return null;

    setLoadingKeys((current) => new Set(current).add(key));

    try {
      const data = await loadDataset(manifest.url);
      setDatasets((current) => ({ ...current, [key]: data }));
      setLoadedKeys((current) => new Set(current).add(key));
      return data;
    } catch (error) {
      console.error(error);
      setErrorKeys((current) => new Set(current).add(key));
      return null;
    } finally {
      setLoadingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    CRITICAL_KEYS.forEach((key) => {
      ensureDataset(key);
    });
  }, [ensureDataset]);

  const adjacencyMap = useMemo(() => {
    const adjacency = {};
    (datasets.lines?.features || []).forEach((feature) => {
      const { from_sub_id: fromSubId, to_sub_id: toSubId } = feature.properties;
      if (!fromSubId || !toSubId) return;

      if (!adjacency[fromSubId]) adjacency[fromSubId] = [];
      if (!adjacency[toSubId]) adjacency[toSubId] = [];

      adjacency[fromSubId].push({ lineFeature: feature, otherSubId: toSubId });
      adjacency[toSubId].push({ lineFeature: feature, otherSubId: fromSubId });
    });
    return adjacency;
  }, [datasets.lines]);

  const progress = useMemo(() => ({
    loaded: loadedKeys.size,
    total: Object.keys(DATASET_MANIFEST).length,
    criticalLoaded: CRITICAL_KEYS.every((key) => loadedKeys.has(key) || datasets[key]),
  }), [datasets, loadedKeys]);

  return {
    datasets,
    adjacencyMap,
    ensureDataset,
    loadingKeys,
    errorKeys,
    progress,
  };
}
