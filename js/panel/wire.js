// js/panel/wire.js
import { q, log, saveMeta, showMeta } from './dom.js';
import { setupUploader } from './uploader.js';
import { initGeoSearch } from '../geosearch.js';
import { initSavedView } from '../saved_view.js';
import { meta, numFrom, timeFrom } from './panelState.js';
import '../saved_daily_player.js';
import { initMap, resetMapPointer } from '../map.js';

function resetUploadState(root) {

  const fi = q(root, '#fileInput');
  if (fi) fi.value = '';

  const fl = q(root, '#fileList');
  if (fl) fl.innerHTML = '';

  const info = q(root, '#fileInfo');
  if (info) info.textContent = 'Nessun file';

  const lg = q(root, '#log');
  if (lg) lg.textContent = '';

  ['Lat','Lon','Start','Country','Tz','City','Prov','Reg','Road','Fps'].forEach(key => {
    const el = q(root, `#meta${key}`);
    if (el) el.value = '';
  });

  meta.lat = null;
  meta.lon = null;
  meta.start = '';
  meta.country = '';
  meta.tz = '';
  meta.city = '';
  meta.road = '';

  try {
    resetMapPointer();
  } catch (e) {}

  showMeta(root, {
    needLat: true,
    needLon: true,
    needStart: true,
    needCountry: true,
    needTz: true,
    needCity: true,
    needRoad: true
  });

  log(root, '[RESET] fatto');
}

function setupUploadToggle(root){
  const btn   = q(root, '#btnToggleUpload');
  const panel = q(root, '#uploadSection');

  if (!btn || !panel) return;
  if (panel.dataset.toggleInit === '1') return;
  panel.dataset.toggleInit = '1';

  let open = false;

  function openPanel(){
    panel.classList?.remove('is-hidden');
    panel.style.display = '';
    panel.setAttribute('aria-hidden','false');
    btn.setAttribute('aria-expanded','true');
    btn.textContent = 'Chiudi';
    open = true;
  }

  function closePanel(){
    panel.classList?.add('is-hidden');
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden','true');
    btn.setAttribute('aria-expanded','false');
    btn.textContent = 'Aggiungi nuovi dati';
    open = false;
  }

  btn.addEventListener('click', () => {
    if (open) {
      closePanel();
      resetUploadState(root);
    } else {
      openPanel();
    }
  });
}

export function wirePanel(root) {

  initMap({ hostId: 'map', center: [41.90, 12.49], zoom: 12 });

  log(root, '[INIT] Mini panel pronto');

  setupUploadToggle(root);

  const fi = q(root,'#fileInput');
  if (!fi) return;

  fi.addEventListener('change', () => {
    const fs = fi.files || [];
    const info = q(root,'#fileInfo');
    const fl   = q(root,'#fileList');

    if (info)
      info.textContent = fs.length
        ? (fs.length===1 ? fs[0].name : `${fs.length} file selezionati`)
        : 'Nessun file';

    if (fl) {
      fl.innerHTML = '';
      Array.from(fs).forEach(f => {
        const li = document.createElement('li');
        li.textContent = f.name;
        fl.appendChild(li);
      });
    }
  });

  q(root,'#btnReset')?.addEventListener('click', () => {
    resetUploadState(root);
  });

  q(root,'#btnSaveMeta')?.addEventListener('click', () => {
    const lat = numFrom(q(root,'#metaLat')?.value);
    const lon = numFrom(q(root,'#metaLon')?.value);
    const st  = timeFrom(q(root,'#metaStart')?.value);

    if (lat!=null) meta.lat = lat;
    if (lon!=null) meta.lon = lon;
    if (st)        meta.start = st;

    const country = (q(root,'#metaCountry')?.value || '').trim().toUpperCase();
    const tz      = (q(root,'#metaTz')?.value || '').trim();
    const city    = (q(root,'#metaCity')?.value || '').trim();
    const road    = (q(root,'#metaRoad')?.value || '').trim();

    if (country) meta.country = country;
    if (tz)      meta.tz = tz;
    if (city)    meta.city = city;
    if (road)    meta.road = road;

    saveMeta();
    log(root, '[META] salvati');
  });

  ['Lat','Lon','Start','Country','Tz','City','Road'].forEach(key=>{
    q(root, `#meta${key}`)?.addEventListener('input', () => {});
  });

  setupUploader(root);

  try { initGeoSearch(); } catch (e) {}
  try {
    initSavedView();
    log(root, '[SAVED] Sezione dati salvati pronta');
  } catch (e) {}

  showMeta(root, {
    needLat:true,
    needLon:true,
    needStart:true,
    needCountry:true,
    needTz:true,
    needCity:true,
    needRoad:true
  });
}
