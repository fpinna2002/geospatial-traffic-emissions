// js/panel/dom.js
import { META_KEY, meta, ALIAS, MAX } from './panelState.js';

export const q = (root, s) => root.querySelector(s);

export const log = (root, m) => {
  const el = q(root, '#log');
  if (el){ el.textContent += String(m)+'\n'; el.scrollTop = el.scrollHeight; }
};

export const saveMeta = () => { try{ localStorage.setItem(META_KEY, JSON.stringify(meta)); }catch{} };

export const showMeta = (root, needs) => {
  const box = q(root, '#metaBox'), msg = q(root, '#metaMsg'); if(!box||!msg) return;
  const miss = [];
  if(needs.needLat) miss.push('Latitudine');
  if(needs.needLon) miss.push('Longitudine');
  if(needs.needStart) miss.push('Ora inizio');
  if(needs.needCountry) miss.push('Nazione (ISO-2)');
  if(needs.needTz) miss.push('Fuso orario');
  if(needs.needCity) miss.push('Città');
  if(needs.needRoad) miss.push('Strada');

  if(miss.length){
    msg.textContent = 'Mancano: ' + miss.join(', ') + '. Inserisci qui sotto:';
    box.style.setProperty('display','block','important');
    const setIf = (id, v) => { const el=q(root, id); if (el && v!=null) el.value = v; };
    setIf('#metaLat', meta.lat);
    setIf('#metaLon', meta.lon);
    setIf('#metaStart', meta.start);
    setIf('#metaCountry', meta.country);
    setIf('#metaTz', meta.tz);
    setIf('#metaCity', meta.city);
    setIf('#metaRoad', meta.road);
  } else {
    box.style.removeProperty('display');
  }
};


