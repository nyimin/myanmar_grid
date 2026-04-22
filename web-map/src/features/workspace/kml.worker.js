import { parseKml } from './kmlParser.js';

self.onmessage = async (event) => {
  try {
    const { text } = event.data;
    const parsed = parseKml(text);
    self.postMessage({ ok: true, parsed });
  } catch (error) {
    self.postMessage({ ok: false, error: error.message || 'KML import failed.' });
  }
};
