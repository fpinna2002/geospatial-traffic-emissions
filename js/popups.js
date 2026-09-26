// popups.js
import { getPollutant, labelForMetric, formatValue } from './metrics.js';

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pickNum = (...xs) => {
  for (const x of xs) {
    const n = num(x);
    if (n !== 0 || (typeof x !== 'undefined' && x !== null)) return n;
  }
  return 0;
};

const fmtCount = v => String(Math.round(num(v)));

export function makePopupContent({ item = {}, value = 0, mode = 'snapshot' } = {}) {
  const road    = item.road || item.label || '';
  const city    = item.city || '';
  const country = item.country || item.country_iso2 || '';
  const title   = [road, city, country ? `(${country})` : '']
    .filter(Boolean)
    .join(', ') || 'Sconosciuto';

  const lat = num(item.lat ?? item.latitude);
  const lon = num(item.lon ?? item.lng ?? item.longitude);
  const coord = (Number.isFinite(lat) && Number.isFinite(lon))
    ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
    : '';

  const currentPoll = getPollutant();
  const isCount     = currentPoll === 'count';
  const metricValue = num(value);

  const base = (item.day && typeof item.day === 'object' ? item.day :
               (item.cum && typeof item.cum === 'object' ? item.cum :
               (item.counts || item.totals || item)));

  const carsCount   = pickNum(
    item.cars,
    base.cars,
    base.counts?.cars,
    base.totals?.cars
  );

  const motosCount  = pickNum(
    item.motos,
    item.motorcycles,
    base.motos,
    base.motorcycles,
    base.counts?.motos,
    base.counts?.motorcycles,
    base.totals?.motos,
    base.totals?.motorcycles
  );

  const busesCount  = pickNum(
    item.buses,
    base.buses,
    base.counts?.buses,
    base.totals?.buses
  );

  const trucksCount = pickNum(
    item.trucks,
    item.heavy_duty_trucks,
    base.trucks,
    base.heavy_duty_trucks,
    base.counts?.trucks,
    base.totals?.trucks
  );

  let totalVal;
  if (isCount) {
    const totalCount = carsCount + motosCount + busesCount + trucksCount;
    totalVal = totalCount || metricValue;
  } else {
    totalVal = metricValue;
  }

  const label  = labelForMetric();
  const dayStr =
    item.day_str ||
    (typeof item.day === 'string' ? item.day : '') ||
    item.date ||
    '';

  const headline =
    mode === 'timeline'
      ? `${label} — cumulato del giorno${dayStr ? ` <b>${dayStr}</b>` : ''}: <b>${formatValue(metricValue)}</b>`
      : `${label}: <b>${formatValue(metricValue)}</b>`;

  return `
    <div style="line-height:1.35">
      <b>${title}</b><br>
      ${coord ? `${coord}<br>` : ''}
      <div style="margin:.25rem 0 .35rem 0">
        <span style="opacity:.8">Totale (cumulato)</span>:
        <b>${formatValue(totalVal)}</b><br>
        auto: ${fmtCount(carsCount)} ·
        moto: ${fmtCount(motosCount)} ·
        bus: ${fmtCount(busesCount)} ·
        pesanti: ${fmtCount(trucksCount)}
      </div>
      <div>${headline}</div>
    </div>
  `;
}
