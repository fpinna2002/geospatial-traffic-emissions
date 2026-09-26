// js/map.js

let map = null;
let baseLayer = null;
let heatLayer = null;
let currentMarker = null;   

export function initMap({
  hostId = 'map',
  center = [41.90, 12.49],
  zoom = 12,
  tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution = '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
} = {}) {
  if (map) return map;

  if (typeof L === 'undefined') {
    throw new Error('[map] Leaflet non è caricato. Includi leaflet.js PRIMA di questo modulo.');
  }

  const host = document.getElementById(hostId);
  if (!host) throw new Error(`[map] container #${hostId} non trovato`);

  const cs = getComputedStyle(host);
  if ((parseFloat(cs.height) || 0) < 10) {
    console.warn('[map] #'+hostId+' sembra senza altezza. Imposta un height via CSS.');
  }

  const worldBounds = L.latLngBounds([-85, -180], [85, 180]);

  map = L.map(hostId, {
    maxBounds: worldBounds,
    maxBoundsViscosity: 1.0,
    scrollWheelZoom: true
  });

  function applyMinZoom() {
    const minZ = map.getBoundsZoom(worldBounds, true);
    map.setMinZoom(minZ);
    if (map.getZoom() < minZ) map.setZoom(minZ);
    return minZ;
  }

  const minZ = applyMinZoom();

  baseLayer = L.tileLayer(tileUrl, {
    attribution: tileAttribution,
    minZoom: minZ,
    maxZoom: 19,
    noWrap: true,
    bounds: worldBounds
  }).addTo(map);

  map.fitBounds(worldBounds);

  map.on('resize', () => {
    const nz = applyMinZoom();
    if (baseLayer && baseLayer.options) baseLayer.options.minZoom = nz;
  });

  if (center && typeof zoom === 'number') {
    map.setView(center, Math.max(map.getZoom(), zoom));
  }

  return map;
}

export function getMap() { return map; }

export function addMarker(lat, lon, options = {}) {
  if (!map) return null;

  if (currentMarker) {
    map.removeLayer(currentMarker);
  }

  currentMarker = L.marker([lat, lon], options).addTo(map);
  return currentMarker;
}

export function flyTo(lat, lon, z = 16) {
  if (!map) return;
  map.flyTo([lat, lon], z);
}

export function resetMapPointer() {
  if (map && currentMarker) {
    map.removeLayer(currentMarker);
    currentMarker = null;
  } else {
  }
}
