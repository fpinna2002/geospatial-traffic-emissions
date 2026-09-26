// js/utils.js



export const getLatLon = it => {
  const lat = +it.lat || +it.latitude;
  const lon = +it.lon || +it.lng || +it.longitude;
  return (Number.isFinite(lat) && Number.isFinite(lon)) ? [lat, lon] : [null, null];
};



export function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k,v]) => {
    if (v !== undefined && v !== null && String(v) !== '') p.set(k, String(v));
  });
  return p.toString();
}

export async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

