const DB_NAME = 'myanmar-grid-workspace';
const DB_VERSION = 1;
const STORES = ['workspaces', 'datasets', 'savedLocations'];

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(storeName, mode, handler) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = handler(store);

    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function getAllRecords(storeName) {
  return withStore(storeName, 'readonly', (store) => store.getAll());
}

export function putRecord(storeName, value) {
  return withStore(storeName, 'readwrite', (store) => store.put(value));
}

export function bulkPutRecords(storeName, values) {
  return withStore(storeName, 'readwrite', (store) => {
    values.forEach((value) => store.put(value));
    return values;
  });
}

export function deleteRecord(storeName, id) {
  return withStore(storeName, 'readwrite', (store) => store.delete(id));
}
