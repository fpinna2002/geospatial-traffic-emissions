// js/panel/state.js
export const META_KEY = 'miniPanel.meta.v1';
export const MAX = 2000;
export const PBASE = { dynamicTyping:true, skipEmptyLines:'greedy', worker:true };

export const ALIAS = {
  LAT:   ['lat','latitude','y','latitudine'],
  LON:   ['lon','lng','longitude','x','longitudine'],
  START: ['start','start_time','ora_inizio','orainizio','timestamp_inizio','ts_start'],
  COUNTRY: ['country','country_iso2','nation','paese'],
  TZ:      ['timezone','tz','time_zone'],
  CITY:    ['city','città','citta','comune','town','place'],
  ROAD:    ['road','street','via','address','indirizzo'],
};

export const meta = { lat:null, lon:null, start:null, country:null, tz:null, city:null, road:null };

export const numFrom = v => {
  if (v==null || v==='') return null;
  const n = Number(String(v).replace(',','.').trim());
  return Number.isFinite(n) ? n : null;
};
export const timeFrom = v => {
  if(!v) return null;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = m[1].padStart(2,'0'), mm = m[2].padStart(2,'0'), ss = m[3]?.padStart(2,'0');
  return ss ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
};
export const pad2 = n => String(n).padStart(2,'0');

export const guessDateFromString = s => {
  s = String(s);
  let m = s.match(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})\b/);
  if (m){ let d=+m[1], mo=+m[2], y=+m[3]; if (y<100) y+=2000; return `${y}-${pad2(mo)}-${pad2(d)}`; }
  m = s.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
};
export const buildIso = (dateYYYYMMDD, timeHHMM) => {
  const [y,m,d] = dateYYYYMMDD.split('-').map(Number);
  let [hh,mm,ss='00'] = timeHHMM.split(':');
  const dt = new Date(y, m-1, d, +hh, +mm, +ss);
  return dt.toISOString().replace('.000','');
};
