// js/saved_view.js 
import { getMap } from './map.js';
import { createCircleMarker } from './heat_scale.js';
import { fetchJSON, qs, getLatLon } from './utils.js';
import {
  valueFromDay, valueFromPoint, setVehicle, setPollutant, getPollutant,
  loadEF, pollutantOptions, getEF
} from './metrics.js';
import { makePopupContent } from './popups.js';
import { startSavedPie, hideSavedPie } from './saved_pie.js';

let layer = null;
let LAST  = { items: [] };
let SEARCHING = false;

if (typeof window !== 'undefined') {
  window.LAST = LAST;
}

const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const isYYYYMMDD = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'').trim());

function ensurePlayerHosts(section){
  const host = section || $('#savedSection') || document.body;
  if (!$('#savedDailyUI')) {
    const d = document.createElement('div');
    d.id = 'savedDailyUI';
    d.style.cssText = 'display:flex;gap:.5rem;align-items:center;margin:.75rem 0;flex-wrap:wrap;';
    host.prepend(d);
  }
  if (!$('#savedTlUI')) {
    const d = document.createElement('div');
    d.id = 'savedTlUI';
    d.style.cssText = 'display:none;';
    host.prepend(d);
  }
}

function toISODateFlexible(raw){
  const s = String(raw||'').trim();
  if (!s) return '';
  if (isYYYYMMDD(s)) return s;
  const t = s.replace(/[./]/g,'-').replace(/\s+/g,'');
  let m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [_, yyyy, mm, dd] = m;
    return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }
  return '';
}

function findDateInputs(section){
  const scope = section || document;
  const from = $('#savedDateFrom', scope) || $('#dateFrom', scope);
  const to   = $('#savedDateTo',   scope) || $('#dateTo',   scope);
  if (from && to) return { from, to };
  const pool = $$('#savedSection input', scope).filter(e => e.type==='date' || e.type==='text');
  return { from: from || pool[0] || null, to: to || pool[1] || null };
}

function readISOFromInput(el){
  if (!el) return { raw:'', iso:'' };
  const raw = String(el.value||'').trim();
  if (!raw && 'valueAsDate' in el && el.valueAsDate instanceof Date && !isNaN(el.valueAsDate)){
    const d = el.valueAsDate;
    return {
      raw:'(valueAsDate)',
      iso:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    };
  }
  return { raw, iso: toISODateFlexible(raw) };
}

function currentTZ(){
  const sel = $('#tzSel');
  if (sel && sel.value?.trim()) return sel.value.trim();
  if (typeof window !== 'undefined' && typeof window.appTZ === 'string' && window.appTZ.trim()) {
    return window.appTZ.trim();
  }
  return 'Europe/Rome';
}

function flattenForPopup(it, lat, lon) {
  const n = it.day || it.cum || it.counts || it.totals || {};
  return { ...it, ...n, lat, lon };
}

async function buildPollutantSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">Caricamento…</option>';
  try {
    if (!Object.keys(getEF()).length)
      await loadEF('./api/emission_factor.php?action=list&t='+Date.now());
    sel.innerHTML = '';
    for (const { value, label } of pollutantOptions())
      sel.appendChild(new Option(label, value));
    const cur = getPollutant() || 'count';
    sel.value = [...sel.options].some(o=>o.value===cur) ? cur : 'count';
  } catch {
    sel.innerHTML = '<option value="">Errore nel caricamento</option>';
  }
}

export function initSavedView() {
  const section = $('#savedSection');
  const toggle  = $('#btnToggleSaved');
  const btn     = section?.querySelector('#btnSavedSearch') || $('#btnSavedSearch');
  const list    = section?.querySelector('#savedResults')   || $('#savedResults');
  const placeEl = section?.querySelector('#savedPlace')     || $('#savedPlace');
  const dateEl  = section?.querySelector('#savedDate')      || $('#savedDate');
  const vehSel  = section?.querySelector('#vehSel')         || $('#vehSel');
  const polSel  = section?.querySelector('#polSel')         || $('#polSel');

  ensurePlayerHosts(section);
  buildPollutantSelect(polSel);

  if (vehSel) vehSel.onchange = e => {
    setVehicle(e.target.value);
    document.dispatchEvent(new CustomEvent('saved:vehicle-changed'));
  };

  if (polSel) polSel.onchange = e => {
    setPollutant(e.target.value);
    document.dispatchEvent(new CustomEvent('saved:pollutant-changed'));
  };

  if (toggle) {
    toggle.onclick = () => {
      const hidden = section.classList.toggle('is-hidden');
      toggle.textContent = hidden ? 'Visualizza dati salvati' : 'Nascondi dati salvati';
      if (hidden) {
        fullResetSavedView(section); 
        SEARCHING = false;         
      } else {
        buildPollutantSelect(polSel);
        document.dispatchEvent(new CustomEvent('saved:open'));
      }
    };
  }

  const runRange = async () => {
    if (SEARCHING) return;
    SEARCHING = true;
    document.dispatchEvent(new CustomEvent('saved:close')); 

    const { from: dateFromEl, to: dateToEl } = findDateInputs(section);
    const fromObj = readISOFromInput(dateFromEl);
    const toObj   = readISOFromInput(dateToEl);
    const oneObj  = readISOFromInput(dateEl);
    const place   = (placeEl?.value || '').trim();

    let df = fromObj.iso || (oneObj.iso || '');
    let dt = toObj.iso   || (oneObj.iso || '');

    if (!df || !dt) {
      if (list) {
        list.innerHTML = `<li style="color:#c00">
          Intervallo non valido (da: <code>${fromObj.raw || '—'}</code>,
          a: <code>${toObj.raw || '—'}</code>). Usa <strong>YYYY-MM-DD</strong>.
        </li>`;
      }
      SEARCHING = false;
      return;
    }
    if (df > dt) [df, dt] = [dt, df];

    const url = `./api/cameras.php?${qs({
      date_from: df, date_to: dt, place,
      metrics: 'both', daily: 1, series: 1, tz: currentTZ()
    })}`;

    const searchBtns = [btn, $('#btnSavedRange')].filter(Boolean);
    searchBtns.forEach(b => b.disabled = true);

    try {
      if (list) list.innerHTML = '<li class="muted-text">Caricamento…</li>';
      const data     = await fetchJSON(url);
      const rawItems = Array.isArray(data.items) ? data.items : [];

      const items = rawItems.map(it => {
        const pm = +it.path_m;
        if (!pm || Number.isNaN(pm)) return it; 
        const addPath = p =>
          (p && typeof p === 'object') ? { ...p, path_m: pm } : p;

        const series = Array.isArray(it.series)
          ? it.series.map(addPath)
          : it.series;

        const series_by_day = it.series_by_day && typeof it.series_by_day === 'object'
          ? Object.fromEntries(
              Object.entries(it.series_by_day).map(([k, arr]) => [
                k,
                Array.isArray(arr) ? arr.map(addPath) : arr
              ])
            )
          : it.series_by_day;

        const day = it.day ? addPath(it.day) : it.day;

        return {
          ...it,
          day,
          series,
          series_by_day
        };
      });

      LAST.items = items;
      if (list) renderList(items, list);  

      if (!items.length) {
        clearSaved();               
        hideSavedPie();             
        document.dispatchEvent(new CustomEvent('saved:close')); 
        return;                     
      }

      const plotInfo = plot(items);
      await startSavedPie(items, {
        date_from: df,
        date_to: dt,
        tz: currentTZ()
      }).catch(() => {});

      const detail = { date_from: df, date_to: dt, place, items, plotInfo, tz: currentTZ() };
      document.dispatchEvent(new CustomEvent('saved:daily:init',  { detail }));
      document.dispatchEvent(new CustomEvent('saved:daily-data', { detail }));
      document.dispatchEvent(new CustomEvent('saved:range',      { detail }));
    } catch (err) {
      if (list) list.innerHTML = `<li style="color:#c00">Errore: ${err.message}</li>`;
    } finally {
      SEARCHING = false;
      searchBtns.forEach(b => b.disabled = false);
    }
  };

  btn?.addEventListener('click', runRange);
  $('#btnSavedRange')?.addEventListener('click', runRange);

  placeEl?.addEventListener('keydown',  e => { if (e.key==='Enter') runRange(); });
  dateEl?.addEventListener('keydown',   e => { if (e.key==='Enter') runRange(); });
  $('#savedDateFrom')?.addEventListener('keydown', e => { if (e.key==='Enter') runRange(); });
  $('#savedDateTo')?.addEventListener('keydown',   e => { if (e.key==='Enter') runRange(); });
}

function renderList(items, list) {
  list.innerHTML = items.length
    ? items.map(it => `<li>${it.label || it.city || 'Sconosciuto'}</li>`).join('')
    : '<li class="muted-text">Nessun risultato</li>';
}

function totalForItem(it){
  const pol = getPollutant();

  let total = 0;
  const path_m = it.path_m ?? null;

  const withPath = p => (
    path_m != null
      ? { ...p, path_m }  
      : p
  );

  if (Array.isArray(it.series) && it.series.length) {
    for (const p of it.series) {
      total += +valueFromPoint(withPath(p)) || 0;
    }
  }
  else if (it.series_by_day && typeof it.series_by_day === 'object') {
    for (const arr of Object.values(it.series_by_day)) {
      if (!Array.isArray(arr)) continue;
      for (const p of arr) {
        total += +valueFromPoint(withPath(p)) || 0;
      }
    }
  }

  if (!total) {
    const day = it.day || {};
    const dayWithPath = path_m != null ? { ...day, path_m } : day;
    total = +valueFromDay(dayWithPath) || 0;
  }

  return total;
}

export function plot(items) {
  const map = getMap();
  if (!map) {
    return { markers:new Map(), layer:null, bounds:[], min:0, max:1 };
  }

  if (layer && map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
  layer = L.layerGroup().addTo(map);

  const vals = items.map(totalForItem);
  const max  = Math.max(1, ...vals);

  const markers = new Map();
  const bounds  = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const [lat, lon] = getLatLon(it);
    if (lat == null || lon == null) {
      continue;
    }

    const v = vals[i];

    const mk = createCircleMarker([lat, lon], v, 0, max).addTo(layer);
    mk.bindPopup(
      makePopupContent({
        item : flattenForPopup(it, lat, lon),
        value: v,
        mode : 'snapshot'
      })
    );

    if (it.id != null) markers.set(it.id, mk);
    bounds.push([lat, lon]);
  }

  if (bounds.length) {
    const bb = L.latLngBounds(bounds).pad(0.15);
    map.fitBounds(bb);
  }

  return { markers, layer, bounds, min:0, max };
}

export function clearSaved(list) {
  const map = getMap();
  if (layer) {
    if (map && map.hasLayer(layer)) map.removeLayer(layer);
    layer = null;
  }
  if (list) list.innerHTML = '';
}

function clearSavedList(section){
  const list = section?.querySelector('#savedResults') || $('#savedResults');
  if (list) list.innerHTML = '';
}

export function resetSavedAll(section) {
  const root = section || $('#savedSection') || document;
  clearSavedList(root);
  clearSaved($('#savedResults'));

  const setVal = (id, v) => { const el = $(id, root); if (el) el.value = v; };
  setVal('#savedDate',''); setVal('#savedDateFrom',''); setVal('#savedDateTo',''); setVal('#savedPlace','');

  const vehSel = $('#vehSel', root), polSel = $('#polSel', root);
  if (vehSel) { vehSel.value = 'total';  setVehicle('total'); }
  if (polSel) { polSel.value = 'count';  setPollutant('count'); }

  LAST.items = [];
}

function fullResetSavedView(section){
  resetSavedAll(section);
  hideSavedPie();
  clearSaved();
  document.dispatchEvent(new CustomEvent('saved:close'));
  SEARCHING = false;
}



