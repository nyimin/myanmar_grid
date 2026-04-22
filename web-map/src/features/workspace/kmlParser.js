function parseCoordinates(raw) {
  return raw
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').slice(0, 2).map(Number))
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

function textFrom(node, selector) {
  return node.querySelector(selector)?.textContent?.trim() ?? '';
}

function featureFromGeometry(name, placemark, geometryType, geometryNode) {
  if (!geometryNode) return [];

  if (geometryType === 'Point') {
    const coords = parseCoordinates(textFrom(geometryNode, 'coordinates'))[0];
    if (!coords) return [];
    return [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { name },
    }];
  }

  if (geometryType === 'LineString') {
    const coords = parseCoordinates(textFrom(geometryNode, 'coordinates'));
    if (coords.length < 2) return [];
    return [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { name },
    }];
  }

  if (geometryType === 'Polygon') {
    const coords = parseCoordinates(textFrom(geometryNode, 'outerBoundaryIs coordinates'));
    if (coords.length < 3) return [];
    const closed = coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1];
    const ring = closed ? coords : [...coords, coords[0]];
    return [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { name },
    }];
  }

  if (geometryType === 'MultiGeometry') {
    return [
      ...Array.from(placemark.querySelectorAll(':scope > MultiGeometry > Point')).flatMap((node) =>
        featureFromGeometry(name, placemark, 'Point', node)
      ),
      ...Array.from(placemark.querySelectorAll(':scope > MultiGeometry > LineString')).flatMap((node) =>
        featureFromGeometry(name, placemark, 'LineString', node)
      ),
      ...Array.from(placemark.querySelectorAll(':scope > MultiGeometry > Polygon')).flatMap((node) =>
        featureFromGeometry(name, placemark, 'Polygon', node)
      ),
    ];
  }

  return [];
}

export function isProbablyKmz(text) {
  return text.startsWith('PK');
}

export function parseKml(text, DomParserImpl = globalThis.DOMParser) {
  if (isProbablyKmz(text)) {
    throw new Error('KMZ files are not supported yet. Please export or convert the file to plain .kml first.');
  }

  if (!DomParserImpl) {
    throw new Error('KML parsing is unavailable in this browser context.');
  }

  const parser = new DomParserImpl();
  const xml = parser.parseFromString(text, 'application/xml');
  const parserError = xml.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid KML file.');
  }

  const placemarks = Array.from(xml.querySelectorAll('Placemark'));
  const features = placemarks.flatMap((placemark, index) => {
    const name = textFrom(placemark, 'name') || `Placemark ${index + 1}`;
    const geometryNode = (
      placemark.querySelector(':scope > Point') ||
      placemark.querySelector(':scope > LineString') ||
      placemark.querySelector(':scope > Polygon') ||
      placemark.querySelector(':scope > MultiGeometry')
    );

    if (!geometryNode) return [];
    return featureFromGeometry(name, placemark, geometryNode.tagName, geometryNode).map((feature, featureIndex) => ({
      ...feature,
      properties: {
        ...feature.properties,
        source: 'kml',
        geometryIndex: featureIndex,
      },
    }));
  });

  if (!features.length) {
    throw new Error('No supported geometries were found in the KML.');
  }

  const geometrySummary = features.reduce((summary, feature) => {
    summary.total += 1;
    summary[feature.geometry.type] = (summary[feature.geometry.type] || 0) + 1;
    return summary;
  }, { total: 0 });

  return {
    type: 'FeatureCollection',
    features,
    geometrySummary,
  };
}
