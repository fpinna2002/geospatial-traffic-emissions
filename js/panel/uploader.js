// js/panel/uploader.js 
import { meta, numFrom, timeFrom, guessDateFromString, buildIso } from './panelState.js';
import { q } from './dom.js';

const logAccodo = {
  pre(name, key, already, explicitTime, dateStr, minutes) {
    if (already && !explicitTime) {
      console.info(
        `[UPLOAD][AUTO-ACCODA] File: "%s" | Chiave: %s | Giorno: %s | Bucket: %d min → ` +
        `il server accoderà dopo l’ultimo intervallo del giorno e allineerà alla griglia.`,
        name, key, dateStr, minutes
      );
    }
  },
  post(json, name, key) {
    if (!json) return;
    const eff   = json.t0_effective || null;
    const effI  = json.t0_effective_iso || null;
    const base  = json.accoda_base || null;
    const baseI = json.accoda_base_iso || null;
    const snap  = !!json.snapped_to_bucket;
    const any   = !!json.has_any_this_day;
    const buck  = +json.bucket_s || NaN;

    console.info(
      `[UPLOAD][RISPOSTA] "%s" | Chiave: %s | hasAnyThisDay=%s | bucket=%s | t0_effective=%s (%s)`,
      name, key, any, Number.isFinite(buck)?`${buck}s`:'?', eff || '—', effI || '—'
    );

    if (base || baseI) {
      console.info(
        `[UPLOAD][ACCODA] "%s" → accoda_base=%s (%s) %s`,
        name, base || '—', baseI || '—', snap ? '→ snapped to bucket' : ''
      );
    } else if (snap) {
      console.info(`[UPLOAD][SNAP] "%s" → applicato snap alla griglia del bucket.`, name);
    }
  }
};

export function setupUploader(root){
  const fi  = q(root,'#fileInput');
  const btn = q(root,'#btnParse');
  const btnReset = q(root,'#btnReset');

  const ui = (() => {
    function ensure(){
      const host = q(root, '#statusBox') || q(root, '#fileInfo') || root;
      let banner = host.querySelector('.status-banner');
      let list   = host.querySelector('.status-list');
      if (!banner){
        banner = document.createElement('div');
        banner.className = 'status-banner';
        banner.style.cssText = 'margin:6px 0;';
        host.appendChild(banner);
      }
      if (!list){
        list = document.createElement('ul');
        list.className = 'status-list';
        list.style.cssText = 'list-style:none;margin:8px 0;padding:0;display:flex;flex-direction:column;gap:8px;';
        host.appendChild(list);
      }
      return { banner, list };
    }
    function banner(text, type='info'){
      const { banner } = ensure();
      const C = { info:'#1976d2', success:'#2e7d32', warn:'#ed6c02' };
      banner.innerHTML = `<div style="background:${C[type]||C.info};color:#fff;padding:8px 12px;border-radius:8px;">${text}</div>`;
    }
    function errorBtn(text){
      const { list } = ensure();
      const li = document.createElement('li');
      const b  = document.createElement('button');
      b.type='button'; b.className='error-btn'; b.textContent=text;
      b.style.cssText='background:#d32f2f;color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.2);text-align:left;';
      b.addEventListener('click', ()=> li.remove());
      li.appendChild(b); list.appendChild(li);
    }

    function clear(){
      const { banner, list } = ensure();
      banner.innerHTML = '';  
      list.innerHTML   = '';  
    }

    return { banner, errorBtn, clear };
  })();

  const isValidHHMM = s => !!(s && /^\d{2}:\d{2}$/.test(String(s).trim()));
  const isCoordFile = n => /(coord|camera|camere)/i.test(String(n||''));
  const slug = s => String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w]+/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  const extractPlace = n => {
    const m = String(n||'').match(/\d{1,2}[._-]\d{1,2}[._-]\d{2}_(.+?)_(?:\d|$)/);
    return m ? slug(m[1]) : '';
  };
  const dateFromFilename = name => {               
    const m = String(name||'').match(/(\d{1,2})[._-](\d{1,2})[._-](\d{2})(?!\d)/);
    if(!m) return null;
    const d=+m[1], mo=+m[2], y2=+m[3], y = y2>=70 ? 1900+y2 : 2000+y2;
    if (mo>=1 && mo<=12 && d>=1 && d<=31){
      const pad=n=>String(n).padStart(2,'0');
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
    return null;
  };

  async function fetchJSONwithTimeout(url, options={}, ms=45000){
    const ctrl = new AbortController(); const id = setTimeout(()=>ctrl.abort(), ms);
    try{
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      const raw = await res.text();
      let json=null; try{ json = raw ? JSON.parse(raw) : null; }catch{}
      return { res, json, raw };
    } finally { clearTimeout(id); }
  }

  (function initIntervalSelect(){
    const sel = q(root, '#metaIntervalMin'); if (!sel) return;
    sel.innerHTML = Array.from({length:60}, (_,i)=>`<option value="${i+1}">${i+1} min</option>`).join('');
    if (!sel.value) sel.value = '1';
  })();

  async function loadCoordsMap(files){
    const map = {};
    for (const f of files){
      if (!isCoordFile(f.name)) continue;
      const text = (await f.text()).replace(/\r\n?/g,'\n');
      let pending=null;
      for (const raw of text.split('\n')){
        const line = raw.trim(); if (!line) continue;
        const m = line.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
        if (m && pending){
          const lat = parseFloat(m[1].replace(',','.'));
          const lon = parseFloat(m[2].replace(',','.'));
          if (Number.isFinite(lat) && Number.isFinite(lon)){
            map[slug(pending)] = { lat, lon, label: pending.trim() };
          }
          pending=null;
        } else {
          pending=line;
        }
      }
    }
    return map;
  }

  async function hasIntervalsForDay({ lat, lon, road, date, interval_s }){
    const fd = new FormData();
    if (Number.isFinite(lat)) fd.append('lat', String(lat));
    if (Number.isFinite(lon)) fd.append('lon', String(lon));
    if (road) fd.append('road', road);
    fd.append('date', date);
    if (interval_s) fd.append('interval_s', String(interval_s));
    const { res, json, raw } = await fetchJSONwithTimeout('api/day_status.php', { method:'POST', body: fd }, 20000);
    if (!res.ok) throw new Error((json && json.message) || raw || `${res.status} ${res.statusText}`);
    return !!(json && json.status === 'ok' && json.has_intervals === true);
  }

  btnReset?.addEventListener('click', () => {

  ui.clear();
  if (fi) fi.value = '';

  const form = root.querySelector('form');
  if (form) form.reset();
  meta.start = '';

  console.info('[UPLOAD][RESET] Stato del pannello completamente azzerato');
});

  btn?.addEventListener('click', async () => {
    const fs = Array.from(fi?.files || []);
    if (!fs.length){ ui.banner(' Seleziona almeno un file YOLO (.txt) prima di procedere.','warn'); return; }
    btn.disabled = true;

    const latForm = numFrom((q(root,'#metaLat')?.value ?? '').trim());
    const lonForm = numFrom((q(root,'#metaLon')?.value ?? '').trim());
    const startRaw = (q(root,'#metaStart')?.value ?? '').trim();
    meta.start     = isValidHHMM(startRaw) ? timeFrom(startRaw) : '';

    const country = (q(root,'#metaCountry')?.value || '').trim().toUpperCase();
    const tz      = (q(root,'#metaTz')?.value || '').trim();
    const city    = (q(root,'#metaCity')?.value || '').trim();
    const province= (q(root,'#metaProv')?.value || '').trim();
    const region  = (q(root,'#metaReg')?.value || '').trim();
    const roadIn  = (q(root,'#metaRoad')?.value || '').trim();
    const fpsRaw  = (q(root,'#metaFps')?.value || '').trim();
    const pathMRaw = (q(root,'#metaPathM')?.value || '').trim();  


    const minutes = Math.max(1, parseInt((q(root,'#metaIntervalMin')?.value || '1'), 10) || 1);
    const interval_s = minutes * 60;

    const isIso2   = s => /^[A-Z]{2}$/.test(s||'');
    const isTz     = s => /^[A-Za-z]+(?:\/[A-Za-z0-9_\-+]+)+$/.test(s||'');
    const isPosNum = s => s && isFinite(+s) && +s > 0;

    const coordsMap = await loadCoordsMap(fs);

    const startPerKey = {};        
    const hasIntervalsCache = {};   
    let lastDay = null;
    const multiDayMode = q(root, '#metaMultiDay')?.checked ?? true;

    function makeKey({ dateStr, roadVal, coord, interval_s }){
      const placeToken = roadVal
        ? slug(roadVal)
        : `@${(coord.lat??0).toFixed(5)},${(coord.lon??0).toFixed(5)}`;
      return `${dateStr}|${placeToken}|${interval_s}`;
    }

    for (const f of fs) {
      const name = f.name || '';

      if (isCoordFile(name)) { ui.banner(`"${name}" riconosciuto come file per le coordinate`,'info'); continue; }
      if (!/\.txt$|\.csv$/i.test(name)) { ui.banner(`⚠️ "${name}" non è un file valido (.txt o .csv).`,'warn'); continue; }

      const place = extractPlace(name);
      const coord = (place && coordsMap[place]) ? { ...coordsMap[place] }
                  : (Number.isFinite(latForm) && Number.isFinite(lonForm) && latForm>=-90 && latForm<=90 && lonForm>=-180 && lonForm<=180)
                  ? { lat: latForm, lon: lonForm }
                  : null;

      if (!coord) { ui.errorBtn(`Coordinate mancanti per "${name}". Inseriscile nel form o in "coordinate_camere.txt".`); continue; }

      // data & ora
      const dateStr = dateFromFilename(name) || guessDateFromString(name) || new Date().toISOString().slice(0,10);
      if (multiDayMode && lastDay && dateStr !== lastDay) {
        if (!isValidHHMM(meta.start)) meta.start = '00:00';
        lastDay = dateStr;
      } else if (!lastDay) {
        lastDay = dateStr;
      }

      const roadVal = roadIn || coordsMap[place]?.label || '';
      const key = makeKey({ dateStr, roadVal, coord, interval_s });

      if (!startPerKey[key]) {
        startPerKey[key] = isValidHHMM(meta.start) ? meta.start : '';
      }
      const timeStr = startPerKey[key] || '';               
      const t0_iso  = buildIso(dateStr, timeStr || '00:00'); 

      try{
        if (!(key in hasIntervalsCache)) {
          hasIntervalsCache[key] = await hasIntervalsForDay({ lat:coord.lat, lon:coord.lon, road:roadVal, date:dateStr, interval_s });
        }
        const already = hasIntervalsCache[key];

        if (!already && !isValidHHMM(startPerKey[key])) {
          ui.errorBtn(` Primo import del ${dateStr} per "${roadVal || place}". Inserisci l’ora di inizio (HH:MM).`);
          continue;
        }
      }catch{
        ui.banner(' Impossibile verificare lo stato del giorno. Proseguo...','warn');
      }

      const already = !!hasIntervalsCache[key];

      const explicitTime = isValidHHMM(startPerKey[key]);

      logAccodo.pre(name, key, already, explicitTime, dateStr, minutes);

      const fd = new FormData();
      fd.append('file', f);
      fd.append('lat', String(coord.lat));
      fd.append('lon', String(coord.lon));
      fd.append('t0_iso', t0_iso);
      fd.append('t0_explicit', (!already && explicitTime) ? '1' : '0');
      fd.append('date', dateStr);
      fd.append('interval_s', String(interval_s));
      if (city)     fd.append('city', city);
      if (province) fd.append('province', province);
      if (region)   fd.append('region', region);
      if (roadVal)  fd.append('road', roadVal);
      if (country && isIso2(country)) fd.append('country_iso2', country);
      if (tz && isTz(tz))             fd.append('timezone', tz);
      if (isPosNum(fpsRaw))           fd.append('fps', fpsRaw);
      if (isPosNum(pathMRaw))         fd.append('path_m', pathMRaw);  


      ui.banner(`📤 Caricamento di "${name}" in corso...`,'info');

      try{
        const { res, json, raw } = await fetchJSONwithTimeout('api/upload_csv.php', { method:'POST', body: fd });
        if (res.ok && json && json.status === 'ok') {
          hasIntervalsCache[key] = true;

          startPerKey[key] = '';
          meta.start = '';
          const input = q(root,'#metaStart'); if (input) input.value = '';

          const msg = json.message || 'Import completato';
          ui.banner(` ${msg} — "${name}" (${json.intervals ?? 0} intervalli, ${json.events ?? 0} veicoli).`,'success');

          logAccodo.post(json, name, key);
        } else {
          const msg = (json && json.message) ? json.message : (raw?.trim() || `${res.status} ${res.statusText}`);

          if (/Sovrapposizione/i.test(msg) && !already && explicitTime) {
            console.warn('[UPLOAD][RETRY] Sovrapposizione: ritento con t0_explicit=0 (auto-accodo).');
            const fd2 = new FormData(fd);
            fd2.set('t0_explicit', '0');
            const r2 = await fetchJSONwithTimeout('api/upload_csv.php', { method:'POST', body: fd2 });
            if (r2.res.ok && r2.json && r2.json.status === 'ok') {
              hasIntervalsCache[key] = true;
              startPerKey[key] = '';
              meta.start = '';
              const input2 = q(root,'#metaStart'); if (input2) input2.value = '';
              const msg2 = r2.json.message || 'Import completato';
              ui.banner(` ${msg2} — "${name}" (${r2.json.intervals ?? 0} intervalli, ${r2.json.events ?? 0} veicoli).`,'success');
              logAccodo.post(r2.json, name, key);
            } else {
              const m2 = (r2.json && r2.json.message) ? r2.json.message : (r2.raw?.trim() || `${r2.res.status} ${r2.res.statusText}`);
              ui.errorBtn(`Errore durante il caricamento di "${name}" (retry): ${m2}`);
            }
          } else {
            ui.errorBtn(`Errore durante il caricamento di "${name}": ${msg}`);
          }
        }
      }catch(e){
        ui.errorBtn(`Connessione fallita per "${name}": ${(e?.name==='AbortError') ? 'timeout del server' : e.message}`);
      }
    }

    btn.disabled = false;
  });
}
