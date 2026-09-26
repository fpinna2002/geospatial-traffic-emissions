
// js/geosearch.js
import { getMap, addMarker, flyTo } from './map.js';
const GEOAPIFY_KEY = "06d81671ea594ad1a8baa03ea0ad9887";

export function initGeoSearch(){
  const $ = (id) => document.getElementById(id);
  const map = getMap();
  if (!map) { console.warn('[geosearch] mappa non pronta'); return; }

  const q = $('geoQuery'), go = $('geoSearch'), results = $('geoResults');
  if (!q || !go || !results) return;

  const SEARCH_URL = 'https://api.geoapify.com/v1/geocode/search';
  const REVERSE_URL = 'https://api.geoapify.com/v1/geocode/reverse';
  let dragMarker = null, t;

  const escapeHtml = (s='') => String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };

  function setMarker(lat, lon){

    if (!dragMarker) {
      dragMarker = addMarker(lat, lon, { draggable:true });
      if (dragMarker) {
        dragMarker.on('dragend', (e) => {
          const { lat, lng } = e.target.getLatLng();
          reverse(lat, lng);
        });
      }
      return;
    }

    if (!map.hasLayer(dragMarker)) {
      dragMarker.addTo(map);
    }

    dragMarker.setLatLng([lat, lon]);
  }


  async function reverse(lat, lon){
    setVal('metaLat', lat.toFixed(6));
    setVal('metaLon', lon.toFixed(6));

    const params = new URLSearchParams({ lat, lon, lang:'it', limit:'1', apiKey: GEOAPIFY_KEY });
    try{
      const r = await fetch(`${REVERSE_URL}?${params.toString()}`);
      if (!r.ok) return;
      const data = await r.json();
      const p = data.features?.[0]?.properties || {};
      setVal('metaCity',    p.city || p.town || p.village || p.locality || '');
      setVal('metaRoad',    p.street || p.name || '');
      setVal('metaCountry', (p.country_code || '').toUpperCase());
    }catch{}
  }

  async function search(term){
    const s = term?.trim();
    if (!s || s.length < 3) { results.innerHTML = ''; return; }

    const params = new URLSearchParams({ text:s, lang:'it', limit:'8', apiKey: GEOAPIFY_KEY });
    const c = map.getCenter();
    params.set('bias', `proximity:${c.lng},${c.lat}`);

    try{
      const r = await fetch(`${SEARCH_URL}?${params.toString()}`);
      if (!r.ok) { results.innerHTML = '<li style="color:var(--muted)">Nessun risultato</li>'; return; }

      const data = await r.json();
      const items = (data.features || []).map(f => {
        const p = f.properties || {};
        const lat = p.lat, lon = p.lon;
        const label = [
          p.name,
          p.street && p.housenumber ? `${p.street} ${p.housenumber}` : p.street,
          p.city || p.town || p.village || p.locality,
          p.state,
          p.country
        ].filter(Boolean).join(', ');
        return { lat, lon, label: label || p.formatted || `${lat}, ${lon}` };
      });

      results.innerHTML = items.map(it =>
        `<li data-lat="${it.lat}" data-lon="${it.lon}">${escapeHtml(it.label)}</li>`
      ).join('');
    }catch{
      results.innerHTML = '<li style="color:var(--muted)">Errore di rete</li>';
    }
  }

  go.addEventListener('click', () => search(q.value));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(q.value); });
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(q.value), 300); });

  results.addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li) return;
    const lat = parseFloat(li.dataset.lat), lon = parseFloat(li.dataset.lon);
    setMarker(lat, lon);
    flyTo(lat, lon, Math.max(map.getZoom(), 15));
    reverse(lat, lon);
  });
}




