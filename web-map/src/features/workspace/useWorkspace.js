import { useCallback, useEffect, useMemo, useState } from 'react';
import { bulkPutRecords, deleteRecord, getAllRecords, putRecord } from '../../lib/indexedDb.js';
import { parseKmlText } from './kmlImport.js';

function nowIso() {
  return new Date().toISOString();
}

function localId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function mapRemoteWorkspace(record) {
  return {
    id: record.id,
    remoteId: record.id,
    name: record.name,
    ownerId: record.owner,
    pendingSync: false,
    updatedAt: record.updated,
    createdAt: record.created,
  };
}

function mapRemoteDataset(record) {
  return {
    id: record.id,
    remoteId: record.id,
    workspaceId: record.workspace_local_id || record.workspace || '',
    workspaceRemoteId: record.workspace || '',
    name: record.name,
    sourceType: record.source_type || 'kml',
    featureCollection: record.normalized_geojson || { type: 'FeatureCollection', features: [] },
    geometrySummary: record.geometry_summary || {},
    visible: record.visible !== false,
    sortOrder: record.sort_order ?? 0,
    pendingSync: false,
    updatedAt: record.updated,
    createdAt: record.created,
  };
}

function mapRemoteLocation(record) {
  return {
    id: record.id,
    remoteId: record.id,
    workspaceId: record.workspace_local_id || record.workspace || '',
    datasetId: record.dataset_local_id || record.dataset || null,
    name: record.name,
    geometry: record.geometry,
    metadata: record.metadata || {},
    sortOrder: record.sort_order ?? 0,
    pendingSync: false,
    updatedAt: record.updated,
    createdAt: record.created,
  };
}

async function syncWorkspaceRecord(pb, user, workspace) {
  if (!pb || !user) return workspace;
  const payload = {
    owner: user.id,
    name: workspace.name,
  };

  if (workspace.remoteId) {
    const updated = await pb.collection('workspaces').update(workspace.remoteId, payload);
    return { ...workspace, remoteId: updated.id, pendingSync: false, updatedAt: updated.updated };
  }

  const created = await pb.collection('workspaces').create(payload);
  return {
    ...workspace,
    remoteId: created.id,
    pendingSync: false,
    updatedAt: created.updated,
  };
}

async function syncDatasetRecord(pb, user, dataset, workspaces, file) {
  if (!pb || !user) return dataset;
  const workspace = workspaces.find((item) => item.id === dataset.workspaceId);
  const workspaceRemoteId = workspace?.remoteId || workspace?.id;
  if (!workspaceRemoteId) throw new Error('Workspace must sync before datasets.');

  let payload = {
    owner: user.id,
    workspace: workspaceRemoteId,
    workspace_local_id: dataset.workspaceId,
    name: dataset.name,
    source_type: dataset.sourceType,
    normalized_geojson: dataset.featureCollection,
    geometry_summary: dataset.geometrySummary,
    visible: dataset.visible,
    sort_order: dataset.sortOrder ?? 0,
  };

  if (file) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      formData.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
    });
    formData.append('original_file', file);
    payload = formData;
  }

  if (dataset.remoteId) {
    const updated = await pb.collection('workspace_datasets').update(dataset.remoteId, payload);
    return {
      ...dataset,
      remoteId: updated.id,
      workspaceRemoteId,
      pendingSync: false,
      updatedAt: updated.updated,
    };
  }

  const created = await pb.collection('workspace_datasets').create(payload);
  return {
    ...dataset,
    remoteId: created.id,
    workspaceRemoteId,
    pendingSync: false,
    updatedAt: created.updated,
  };
}

async function syncLocationRecord(pb, user, location, workspaces, datasets) {
  if (!pb || !user) return location;
  const workspace = workspaces.find((item) => item.id === location.workspaceId);
  const dataset = datasets.find((item) => item.id === location.datasetId);
  const payload = {
    owner: user.id,
    workspace: workspace?.remoteId || workspace?.id,
    workspace_local_id: location.workspaceId,
    dataset: dataset?.remoteId || dataset?.id || '',
    dataset_local_id: location.datasetId || '',
    name: location.name,
    geometry: location.geometry,
    metadata: location.metadata,
    sort_order: location.sortOrder ?? 0,
  };

  if (location.remoteId) {
    const updated = await pb.collection('saved_locations').update(location.remoteId, payload);
    return { ...location, remoteId: updated.id, pendingSync: false, updatedAt: updated.updated };
  }

  const created = await pb.collection('saved_locations').create(payload);
  return { ...location, remoteId: created.id, pendingSync: false, updatedAt: created.updated };
}

export function useWorkspace({ user, pb }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [savedLocations, setSavedLocations] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [status, setStatus] = useState({ loading: true, sync: 'local', message: 'Loading workspace…' });

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const [localWorkspaces, localDatasets, localLocations] = await Promise.all([
          getAllRecords('workspaces'),
          getAllRecords('datasets'),
          getAllRecords('savedLocations'),
        ]);

        if (!mounted) return;

        let nextWorkspaces = localWorkspaces;
        if (!nextWorkspaces.length) {
          nextWorkspaces = [{
            id: localId('workspace'),
            name: 'My Workspace',
            ownerId: user?.id || 'local',
            pendingSync: !!user,
            sortOrder: 0,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          }];
          await bulkPutRecords('workspaces', nextWorkspaces);
        }

        setWorkspaces(nextWorkspaces);
        setDatasets(localDatasets);
        setSavedLocations(localLocations);
        setActiveWorkspaceId((current) => current || nextWorkspaces[0]?.id || '');
        setStatus({ loading: false, sync: user ? 'syncing' : 'local', message: user ? 'Syncing workspace…' : 'Stored on this device.' });

        if (user && pb) {
          try {
            const [remoteWorkspaces, remoteDatasets, remoteLocations] = await Promise.all([
              pb.collection('workspaces').getFullList({ sort: '-updated' }),
              pb.collection('workspace_datasets').getFullList({ sort: '-updated' }),
              pb.collection('saved_locations').getFullList({ sort: '-updated' }),
            ]);

            if (!mounted) return;

            const mergedWorkspaces = remoteWorkspaces.length ? remoteWorkspaces.map(mapRemoteWorkspace) : nextWorkspaces;
            const mergedDatasets = remoteDatasets.map(mapRemoteDataset);
            const mergedLocations = remoteLocations.map(mapRemoteLocation);

            setWorkspaces(mergedWorkspaces);
            setDatasets(mergedDatasets);
            setSavedLocations(mergedLocations);
            setActiveWorkspaceId((current) => current || mergedWorkspaces[0]?.id || '');
            await Promise.all([
              bulkPutRecords('workspaces', mergedWorkspaces),
              bulkPutRecords('datasets', mergedDatasets),
              bulkPutRecords('savedLocations', mergedLocations),
            ]);
            setStatus({ loading: false, sync: 'ready', message: 'Workspace synced with PocketBase.' });
          } catch (error) {
            console.warn('Workspace sync unavailable:', error);
            if (mounted) {
              setStatus({
                loading: false,
                sync: 'degraded',
                message: 'PocketBase workspace sync is unavailable; local offline mode is active.',
              });
            }
          }
        }
      } catch (error) {
        console.error(error);
        if (mounted) {
          setStatus({ loading: false, sync: 'error', message: 'Workspace failed to load.' });
        }
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [pb, user]);

  const persistWorkspace = useCallback(async (workspace) => {
    setWorkspaces((current) => {
      const others = current.filter((item) => item.id !== workspace.id);
      return [workspace, ...others].sort((a, b) => a.name.localeCompare(b.name));
    });
    await putRecord('workspaces', workspace);
    return workspace;
  }, []);

  const persistDataset = useCallback(async (dataset) => {
    setDatasets((current) => {
      const others = current.filter((item) => item.id !== dataset.id);
      return [dataset, ...others].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
    await putRecord('datasets', dataset);
    return dataset;
  }, []);

  const persistLocation = useCallback(async (location) => {
    setSavedLocations((current) => {
      const others = current.filter((item) => item.id !== location.id);
      return [location, ...others].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
    await putRecord('savedLocations', location);
    return location;
  }, []);

  const createWorkspace = useCallback(async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const draft = {
      id: localId('workspace'),
      name: trimmed,
      ownerId: user?.id || 'local',
      pendingSync: !!user,
      sortOrder: workspaces.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await persistWorkspace(draft);
    setActiveWorkspaceId(draft.id);

    if (user && pb) {
      try {
        const synced = await syncWorkspaceRecord(pb, user, draft);
        await persistWorkspace(synced);
        setStatus({ loading: false, sync: 'ready', message: 'Workspace synced with PocketBase.' });
      } catch (error) {
        console.warn(error);
        setStatus({ loading: false, sync: 'degraded', message: 'Workspace saved locally and queued for sync.' });
      }
    }

    return draft;
  }, [pb, persistWorkspace, user, workspaces.length]);

  const renameWorkspace = useCallback(async (workspaceId, name) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const trimmed = name.trim();
    if (!workspace || !trimmed) return null;

    const next = {
      ...workspace,
      name: trimmed,
      pendingSync: !!user,
      updatedAt: nowIso(),
    };

    await persistWorkspace(next);

    if (user && pb) {
      try {
        const synced = await syncWorkspaceRecord(pb, user, next);
        await persistWorkspace(synced);
        return synced;
      } catch (error) {
        console.warn(error);
      }
    }

    return next;
  }, [pb, persistWorkspace, user, workspaces]);

  const renameDataset = useCallback(async (datasetId, name) => {
    const dataset = datasets.find((item) => item.id === datasetId);
    if (!dataset || !name.trim()) return;
    const next = {
      ...dataset,
      name: name.trim(),
      pendingSync: !!user,
      updatedAt: nowIso(),
    };
    await persistDataset(next);

    if (user && pb) {
      try {
        const synced = await syncDatasetRecord(pb, user, next, workspaces);
        await persistDataset(synced);
      } catch (error) {
        console.warn(error);
      }
    }
  }, [datasets, pb, persistDataset, user, workspaces]);

  const deleteDataset = useCallback(async (datasetId) => {
    const dataset = datasets.find((item) => item.id === datasetId);
    if (!dataset) return;
    setDatasets((current) => current.filter((item) => item.id !== datasetId));
    await deleteRecord('datasets', datasetId);
    if (user && pb && dataset.remoteId) {
      try {
        await pb.collection('workspace_datasets').delete(dataset.remoteId);
      } catch (error) {
        console.warn(error);
      }
    }
  }, [datasets, pb, user]);

  const reorderDataset = useCallback(async (datasetId, direction) => {
    const ordered = [...datasets]
      .filter((dataset) => dataset.workspaceId === activeWorkspaceId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const index = ordered.findIndex((dataset) => dataset.id === datasetId);
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ordered.length) return;
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
    const remapped = ordered.map((dataset, orderIndex) => ({
      ...dataset,
      sortOrder: orderIndex,
      updatedAt: nowIso(),
      pendingSync: !!user,
    }));

    for (const dataset of remapped) {
      await persistDataset(dataset);
      if (user && pb) {
        try {
          const synced = await syncDatasetRecord(pb, user, dataset, workspaces);
          await persistDataset(synced);
        } catch (error) {
          console.warn(error);
        }
      }
    }
  }, [activeWorkspaceId, datasets, pb, persistDataset, user, workspaces]);

  const toggleWorkspaceDataset = useCallback(async (datasetId, visible) => {
    const dataset = datasets.find((item) => item.id === datasetId);
    if (!dataset) return;
    const next = {
      ...dataset,
      visible,
      pendingSync: !!user,
      updatedAt: nowIso(),
    };
    await persistDataset(next);
    if (user && pb) {
      try {
        const synced = await syncDatasetRecord(pb, user, next, workspaces);
        await persistDataset(synced);
      } catch (error) {
        console.warn(error);
      }
    }
  }, [datasets, pb, persistDataset, user, workspaces]);

  const importKml = useCallback(async (file, workspaceId) => {
    const text = await file.text();
    const parsed = await parseKmlText(text);
    const draft = {
      id: localId('dataset'),
      workspaceId,
      name: file.name.replace(/\.kml$/i, '') || 'Imported KML',
      sourceType: 'kml',
      featureCollection: parsed,
      geometrySummary: parsed.geometrySummary,
      visible: true,
      sortOrder: datasets.filter((item) => item.workspaceId === workspaceId).length,
      pendingSync: !!user,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await persistDataset(draft);

    if (user && pb) {
      try {
        let syncedWorkspaces = workspaces;
        const workspace = syncedWorkspaces.find((item) => item.id === workspaceId);
        if (workspace && !workspace.remoteId) {
          const syncedWorkspace = await syncWorkspaceRecord(pb, user, workspace);
          await persistWorkspace(syncedWorkspace);
          syncedWorkspaces = syncedWorkspaces.map((item) => item.id === workspace.id ? syncedWorkspace : item);
        }
        const syncedDataset = await syncDatasetRecord(pb, user, draft, syncedWorkspaces, file);
        await persistDataset(syncedDataset);
        setStatus({ loading: false, sync: 'ready', message: 'KML synced with PocketBase.' });
      } catch (error) {
        console.warn(error);
        setStatus({ loading: false, sync: 'degraded', message: 'KML saved locally and queued for sync.' });
      }
    }

    return draft;
  }, [datasets, pb, persistDataset, persistWorkspace, user, workspaces]);

  const saveLocation = useCallback(async (workspaceId, geometry, metadata = {}) => {
    const draft = {
      id: localId('location'),
      workspaceId,
      datasetId: metadata.datasetId || null,
      name: metadata.name || 'Saved Location',
      geometry,
      metadata,
      sortOrder: savedLocations.filter((item) => item.workspaceId === workspaceId).length,
      pendingSync: !!user,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await persistLocation(draft);
    if (user && pb) {
      try {
        const synced = await syncLocationRecord(pb, user, draft, workspaces, datasets);
        await persistLocation(synced);
      } catch (error) {
        console.warn(error);
      }
    }
    return draft;
  }, [datasets, pb, persistLocation, savedLocations, user, workspaces]);

  const renameSavedLocation = useCallback(async (locationId, name) => {
    const location = savedLocations.find((item) => item.id === locationId);
    if (!location || !name.trim()) return;
    const next = {
      ...location,
      name: name.trim(),
      pendingSync: !!user,
      updatedAt: nowIso(),
    };
    await persistLocation(next);
    if (user && pb) {
      try {
        const synced = await syncLocationRecord(pb, user, next, workspaces, datasets);
        await persistLocation(synced);
      } catch (error) {
        console.warn(error);
      }
    }
  }, [datasets, pb, persistLocation, savedLocations, user, workspaces]);

  const deleteSavedLocation = useCallback(async (locationId) => {
    const location = savedLocations.find((item) => item.id === locationId);
    if (!location) return;
    setSavedLocations((current) => current.filter((item) => item.id !== locationId));
    await deleteRecord('savedLocations', locationId);
    if (user && pb && location.remoteId) {
      try {
        await pb.collection('saved_locations').delete(location.remoteId);
      } catch (error) {
        console.warn(error);
      }
    }
  }, [pb, savedLocations, user]);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null,
    [activeWorkspaceId, workspaces],
  );

  const activeWorkspaceDatasets = useMemo(
    () => datasets
      .filter((dataset) => dataset.workspaceId === activeWorkspace?.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [activeWorkspace, datasets],
  );

  const activeSavedLocations = useMemo(
    () => savedLocations
      .filter((location) => location.workspaceId === activeWorkspace?.id)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [activeWorkspace, savedLocations],
  );

  const activeWorkspacePendingSync = useMemo(() => {
    if (!activeWorkspace) return false;
    return Boolean(
      activeWorkspace.pendingSync
      || activeWorkspaceDatasets.some((dataset) => dataset.pendingSync)
      || activeSavedLocations.some((location) => location.pendingSync),
    );
  }, [activeSavedLocations, activeWorkspace, activeWorkspaceDatasets]);

  const mapDatasetFeatures = useMemo(() => activeWorkspaceDatasets.flatMap((dataset) => {
    if (!dataset.visible) return [];
    return (dataset.featureCollection?.features || []).map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        type: feature.properties?.type || 'workspace',
        datasetName: dataset.name,
        __workspace: true,
      },
    }));
  }), [activeWorkspaceDatasets]);

  const savedLocationFeatures = useMemo(() => activeSavedLocations.map((location) => ({
    type: 'Feature',
    geometry: location.geometry,
    properties: {
      ...location.metadata,
      id: location.id,
      name: location.name,
      datasetName: 'Saved Locations',
      type: 'saved_location',
      __workspace: true,
      workspaceId: location.workspaceId,
    },
  })), [activeSavedLocations]);

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspaceDatasets,
    activeSavedLocations,
    activeWorkspacePendingSync,
    mapDatasetFeatures,
    savedLocationFeatures,
    createWorkspace,
    renameWorkspace,
    renameDataset,
    deleteDataset,
    reorderDataset,
    toggleWorkspaceDataset,
    importKml,
    saveLocation,
    renameSavedLocation,
    deleteSavedLocation,
    status,
  };
}
