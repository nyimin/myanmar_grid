import { parseKml } from './kmlParser.js';

export function parseKmlText(text) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./kml.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const { ok, parsed, error } = event.data;
      worker.terminate();
      if (!ok) {
        if (error === 'KML parsing is unavailable in this browser context.') {
          try {
            resolve(parseKml(text));
          } catch (fallbackError) {
            reject(fallbackError);
          }
          return;
        }
        reject(new Error(error));
        return;
      }
      resolve(parsed);
    };

    worker.onerror = (event) => {
      worker.terminate();
      try {
        resolve(parseKml(text));
      } catch (fallbackError) {
        reject(event.error || fallbackError || new Error('KML parsing failed.'));
      }
    };

    worker.postMessage({ text });
  });
}
