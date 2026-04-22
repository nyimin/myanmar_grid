export function parseKmlText(text) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./kml.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const { ok, parsed, error } = event.data;
      worker.terminate();
      if (!ok) {
        reject(new Error(error));
        return;
      }
      resolve(parsed);
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error || new Error('KML parsing failed.'));
    };

    worker.postMessage({ text });
  });
}
