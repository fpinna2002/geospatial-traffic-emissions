//saved_pie.js
import { getMap } from './map.js';
import {
  valueFromDay,
  setPollutant,
  getPollutant,
  loadEF,
  pollutantOptions,
  niceLabel,
  getEF
} from './metrics.js';
import { getLatLon } from './utils.js';

let PIE = null;
let HOURLY = null;
let drawerEl = null; 

const EMISSION_UNIT = ' kg'; 

const parseTs = iso =>
  new Date(/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');

const hourFromTs = (ts, tz) => {
  const fmt = new Intl.DateTimeFormat('it-IT', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false
  });
  return Number(fmt.format(parseTs(ts))); 
};

const dateKeyFromPoint = (p, tz) => {
  if (p.date) return String(p.date);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(parseTs(p.ts));
};

const rawCountsFromPoint = (p = {}) => ({
  cars:   Number(p.cars   ?? 0),
  motos:  Number(p.motos  ?? p.motorcycles ?? 0),
  buses:  Number(p.buses  ?? 0),
  trucks: Number(p.trucks ?? p.heavy_duty_trucks ?? 0)
});

function ensureDrawer() {
  if (drawerEl) return drawerEl;

  drawerEl = document.createElement('aside');
  drawerEl.id = 'savedDrawer';
  drawerEl.innerHTML = `
    <div id="savedDrawerHandle" aria-label="Apri/chiudi grafici"></div>
    <header>
      <span class="drawer-title">Grafici emissioni e traffico</span>
    </header>
    <div class="drawer-body">
      <canvas id="savedPie" width="320" height="320"></canvas>
      <canvas id="savedHourly" width="320" height="220" style="margin-top:16px;"></canvas>
      <p class="muted" style="margin-top:8px; color:#111;">
        Il grafico orario mostra la media dei conteggi (auto, moto, bus, pesanti)
        per ogni fascia oraria, sull intervallo di date selezionato e per le telecamere visibili.
      </p>

    </div>`;


  document.body.appendChild(drawerEl);

  drawerEl.classList.add('hidden');

  const handle = drawerEl.querySelector('#savedDrawerHandle');

  if (handle) {
    handle.addEventListener('click', (e) => {
      e.stopPropagation(); 

      if (drawerEl.classList.contains('hidden')) return;

      if (drawerEl.classList.contains('open')) {
        drawerEl.classList.remove('open');
        drawerEl.classList.add('closed');
      } else {
        drawerEl.classList.remove('closed');
        drawerEl.classList.add('open');
      }
    });
  }
  return drawerEl;
}

function visible(items = []) {
  const map = getMap(); if (!map) return [];
  const b = map.getBounds();
  return items.filter(it => {
    const [lat, lon] = getLatLon(it);
    return lat != null && lon != null && b.contains([lat, lon]);
  });
}

function fromFields(items) {
  const efKeys = Object.keys(getEF() || {});
  const keys = efKeys.length
    ? efKeys
    : Array.from(new Set(items.flatMap(it => {
        const src = it.day?.emissions || it.day || it || {};
        return Object.keys(src).map(k => String(k).toLowerCase());
      }))).filter(k => k !== 'count');

  const out = Object.fromEntries(keys.map(k => [k, 0]));
  for (const it of items) {
    const src = it.day?.emissions || it.day || it || {};
    for (const k of keys) {
      const v = +src[k] || +src[String(k).toUpperCase()] || 0;
      out[k] += v;
    }
  }
  return out;
}

async function viaMetrics(items) {
  if (!Object.keys(getEF()).length) {
    await loadEF('api/emission_factor.php?action=list&t=' + Date.now());
  }
  const prev = getPollutant();
  const out = {};
  for (const { value: pol } of pollutantOptions()) {
    if (pol === 'count') continue;
    setPollutant(pol);

    const outPol = items.reduce((a, it) => {
      const day = it.day || {};
      const dayWithPath = (it.path_m != null)
        ? { ...day, path_m: it.path_m }
        : day;

      return a + (+valueFromDay(dayWithPath) || 0);
    }, 0);

    out[pol] = outPol;
  }
  setPollutant(prev);
  return out;
}

function buildHourlyStats(items, tz = 'Europe/Rome') {
  const hours = Array.from({ length: 24 }, (_, h) =>
    String(h).padStart(2, '0') + ':00'
  );

  const sums = {
    cars:   Array(24).fill(0),
    motos:  Array(24).fill(0),
    buses:  Array(24).fill(0),
    trucks: Array(24).fill(0)
  };

  const days = new Set();

  for (const cam of items) {
    const seriesChunks = [];

    if (cam.series_by_day && typeof cam.series_by_day === 'object') {
      for (const day of Object.keys(cam.series_by_day)) {
        const arr = cam.series_by_day[day] || [];
        for (const p of arr) {
          if (!p) continue;
          const dk = String(p.date || day);
          days.add(dk);
          seriesChunks.push(p);
        }
      }
    } else if (Array.isArray(cam.series)) {
      for (const p of cam.series) {
        if (!p) continue;
        const dk = dateKeyFromPoint(p, tz);
        days.add(dk);
        seriesChunks.push(p);
      }
    }

    for (const p of seriesChunks) {
      if (!p.ts) continue;
      const h = hourFromTs(p.ts, tz);
      if (Number.isNaN(h) || h < 0 || h > 23) continue;
      const c = rawCountsFromPoint(p);
      sums.cars[h]   += c.cars;
      sums.motos[h]  += c.motos;
      sums.buses[h]  += c.buses;
      sums.trucks[h] += c.trucks;
    }
  }

  const nDays = days.size || 1;
  const avg = {
    cars:   sums.cars.map(v => v / nDays),
    motos:  sums.motos.map(v => v / nDays),
    buses:  sums.buses.map(v => v / nDays),
    trucks: sums.trucks.map(v => v / nDays)
  };

  return { hours, avg };
}

async function drawHourlyChart(items, tz = 'Europe/Rome') {
  if (!window.Chart) return;

  const { hours, avg } = buildHourlyStats(items, tz);
  const ctx = document.getElementById('savedHourly')?.getContext('2d');
  if (!ctx) return;

  if (HOURLY) { HOURLY.destroy(); HOURLY = null; }

  HOURLY = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hours,
      datasets: [
        { label: 'Bus',             data: avg.buses,  tension: 0.3 },
        { label: 'Auto',            data: avg.cars,   tension: 0.3 },
        { label: 'Moto',            data: avg.motos,  tension: 0.3 },
        { label: 'Veicoli pesanti', data: avg.trucks, tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        title: {
          display: true,
          text: 'Media conteggi per fascia oraria'
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const raw = +ctx.raw || 0;
              const tot = ctx.dataset.data.reduce((a, b) => a + (+b || 0), 0);
              const pctNum = tot ? (raw / tot * 100) : 0;
              const pctStr = pctNum.toLocaleString('it-IT', {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3
              });

              const valStr = raw.toLocaleString('it-IT') + ' veicoli';
              return `${ctx.label}: ${valStr} (${pctStr}%)`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Ora del giorno' },
          grid: {
            color: 'rgba(0,0,0,0.25)',   
            lineWidth: 1
          }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Veicoli (media per giorno)' },
          grid: {
            color: 'rgba(0,0,0,0.30)',  
            lineWidth: 1
          }
        }
      }

    }
  });
}

async function ensureChart() {
  if (window.Chart) return;
  await new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.onload = ok;
    s.onerror = () => err(new Error('Errore caricamento Chart.js'));
    document.head.appendChild(s);
  });
}

export async function startSavedPie(all = [], meta = {}) {
  const drawer = ensureDrawer();

  drawer.classList.remove('hidden', 'closed');
  drawer.classList.add('open');

  const tz = meta.tz || 'Europe/Rome';
  const items = visible(all);

  let totals = fromFields(items);
  if (!Object.values(totals).some(v => v > 0)) {
    totals = await viaMetrics(items);
  }

  await ensureChart();

  const keys = Object.keys(totals).filter(k => (+totals[k] || 0) > 0);
  if (!keys.length) {
    if (PIE) { PIE.destroy(); PIE = null; }
  } else {
    const data   = keys.map(k => totals[k]);
    const labels = keys.map(k => niceLabel(k));
    const ctxPie = document.getElementById('savedPie')?.getContext('2d');

    if (ctxPie) {
      if (PIE) { PIE.destroy(); PIE = null; }

      PIE = new Chart(ctxPie, {
        type: 'pie',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: [
              '#4caf50','#2196f3','#ff9800',
              '#f44336','#9c27b0','#009688'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            title: {
              display: true,
              text: 'Emissioni totali (area visibile)'
            },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const raw = +ctx.raw || 0;
                  const tot = ctx.dataset.data
                    .reduce((a, b) => a + (+b || 0), 0);

                  const pctNum = tot ? (raw / tot * 100) : 0;
                  const pctStr = pctNum.toLocaleString('it-IT', {
                    minimumFractionDigits: 3,
                    maximumFractionDigits: 3
                  });

                  const valStr = raw.toLocaleString('it-IT');
                  return `${ctx.label}: ${valStr}${EMISSION_UNIT} (${pctStr}%)`;
                }
              }
            }
          }
        }
      });
    }
  }

  await drawHourlyChart(items, tz);
}

export function hideSavedPie() {
  if (!drawerEl) return;

  drawerEl.classList.remove('open', 'closed');
  drawerEl.classList.add('hidden');

  if (PIE)    { PIE.destroy(); PIE = null; }
  if (HOURLY) { HOURLY.destroy(); HOURLY = null; }
}
