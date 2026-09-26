//metric.js
let currentVehicle = 'total';
let currentPollutant = 'count';
export const setVehicle = v => (currentVehicle = v, dispatch());
export const setPollutant = p => (currentPollutant = p, dispatch());
export const getVehicle = () => currentVehicle;
export const getPollutant = () => currentPollutant;
const dispatch = () => document.dispatchEvent(new CustomEvent('metric:change'));

let EF = {};                          
export const getEF = () => EF;

const VEH_REMAP = { motorcycles: 'motos', heavy_duty_trucks: 'trucks' };
const normVeh = k => VEH_REMAP[k] || k;
const normPol = s => String(s || '').toLowerCase();

export const niceLabel = k => {
  const x = String(k || '').toUpperCase();
  return x.replace('PM2.5', 'PM₂.₅')
          .replace('PM25', 'PM₂.₅')
          .replace('PM10', 'PM₁₀')
          .replace('NOX', 'NOₓ')
          .replace('PM_EXHAUST', 'PM (SCARICO)');
};

export async function loadEF(src) {
  const rows = Array.isArray(src) ? src
              : await (await fetch(src, { headers:{ Accept:'application/json' }})).json();
  const tmp = {};
  for (const r of rows) {
    const pol = normPol(r.categoria);
    tmp[pol] = {
      cars:   +r.cars || 0,
      motos:  +r.motorcycles || 0,
      trucks: +r.heavy_duty_trucks || 0,
      buses:  +r.buses || 0,
    };
  }
  EF = tmp; 
  dispatch();
}

export function pollutantOptions() {
  const keys = Object.keys(EF).sort();         
  return [{ value:'count', label:'CONTEGGI' }, ...keys.map(k => ({ value:k, label:niceLabel(k) }))];
}

//calcolo metriche
const WEIGHTS = { cars:1, motos:0.5, buses:3, trucks:2 };
const weightedCount = c =>
  (+c.cars || 0)   * WEIGHTS.cars +
  (+c.motos || 0)  * WEIGHTS.motos +
  (+c.buses || 0)  * WEIGHTS.buses +
  (+c.trucks || 0) * WEIGHTS.trucks;

const fmt = g => (
  g >= 1e6 ? (g / 1e6).toFixed(2) + ' t' :
  g >= 1e3 ? (g / 1e3).toFixed(1) + ' kg' :
  Math.round(g) + ' g'
);

export const labelForMetric = () => {
  const vmap = {
    total: 'Tutti',
    cars: 'Auto',
    motos: 'Moto',
    buses: 'Bus',
    trucks: 'Veicoli pesanti',
    weighted: 'Ponderata'
  };
  const v = vmap[currentVehicle] || currentVehicle;
  const p = (currentPollutant === 'count') ? 'Conteggi' : niceLabel(currentPollutant);
  return `${v} · ${p}`;
};

const pathKmFromCounts = counts => {
  const pm = +counts?.path_m;
  if (!pm || Number.isNaN(pm) || pm <= 0) {
    return 0;
  }
  const km = pm / 1000;
  return km;
};

function emissionOf(counts, pol, veh) {
  const ef = EF[normPol(pol)];
  if (!ef) {
    return 0;
  }

  const pathKm = pathKmFromCounts(counts);
  if (!pathKm) {
    return 0;
  }

  const c = {
    cars:   +counts.cars   || 0,
    motos:  +counts.motos  || 0,
    buses:  +counts.buses  || 0,
    trucks: +counts.trucks || 0
  };

  if (veh && veh !== 'total' && veh !== 'weighted') {
    const k = normVeh(veh);
    return pathKm * (c[k] * (ef[k] || 0)); 
  }

  return pathKm * (
    c.cars   * (ef.cars   || 0) +
    c.motos  * (ef.motos  || 0) +
    c.buses  * (ef.buses  || 0) +
    c.trucks * (ef.trucks || 0)
  );
}

export function emissionBreakdown(counts, pol) {
  const ef = EF[normPol(pol)];
  if (!ef) return { cars:0, motos:0, buses:0, trucks:0, total:0 };

  const pathKm = pathKmFromCounts(counts);
  if (!pathKm) return { cars:0, motos:0, buses:0, trucks:0, total:0 };

  const c = {
    cars:   +counts.cars   || 0,
    motos:  +counts.motos  || 0,
    buses:  +counts.buses  || 0,
    trucks: +counts.trucks || 0
  };

  const cars   = pathKm * c.cars   * (ef.cars   || 0);
  const motos  = pathKm * c.motos  * (ef.motos  || 0);
  const buses  = pathKm * c.buses  * (ef.buses  || 0);
  const trucks = pathKm * c.trucks * (ef.trucks || 0);
  const total  = cars + motos + buses + trucks;

  return { cars, motos, buses, trucks, total };
}

export function valueFromDay(day) {
  if (!day) return 0;
  if (currentPollutant !== 'count') return emissionOf(day, currentPollutant, currentVehicle);
  if (currentVehicle === 'weighted') return weightedCount(day);
  if (currentVehicle === 'total')    return +day.total || 0;
  return +(day[currentVehicle] || 0);
}

export function valueFromPoint(p) {
  if (!p) return 0;
  if (currentPollutant !== 'count') return emissionOf(p, currentPollutant, currentVehicle);
  if (currentVehicle === 'weighted') return weightedCount(p);
  if (currentVehicle === 'total') {
    const cars   = +p.cars   || 0;
    const motos  = +p.motos  || 0;
    const buses  = +p.buses  || 0;
    const trucks = +p.trucks || 0;
    return +p.total || (cars + motos + buses + trucks);
  }

  return +(p[currentVehicle] || 0);
}

export const formatValue = v =>
  (currentPollutant === 'count' ? String(Math.round(+v || 0)) : fmt(+v || 0));
