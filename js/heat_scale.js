//heat_scale.js

export function normalize01(v, min, max) {
  const V = Number.isFinite(+v) ? +v : 0;
  const lo = Number.isFinite(+min) ? +min : 0;
  const hi = Number.isFinite(+max) ? +max : lo + 1;

  if (hi <= lo) return 0; 
  let t = (V - lo) / (hi - lo);
  if (!Number.isFinite(t)) t = 0;
  return Math.max(0, Math.min(1, t));
}

export function styleForValue(v, min, max) {
  const t = normalize01(v, min, max); // 0..1

  let hue;
  if (t < 0.33) {
    hue = 120 - (120 - 60) * (t / 0.33);        
  } else if (t < 0.66) {
    hue = 60 - (60 - 30) * ((t - 0.33) / 0.33); 
  } else {
    hue = 30 - (30 - 0) * ((t - 0.66) / 0.34);  
  }
  const hueInt = Math.round(hue);             


  const radius = 8 + Math.sqrt(t) * 10;         
  const fillOpacity = 0.5 + t * 0.4;           

  return { radius, color: `hsl(${hueInt}, 85%, 45%)`, fillOpacity };
}

export function createCircleMarker([lat, lon], v, min, max) {
  const { radius, color, fillOpacity } = styleForValue(v, min, max);
  return L.circleMarker([lat, lon], {
    radius,
    color,
    fillColor: color,
    weight: 1,
    opacity: 0.9,
    fillOpacity
  });
}

export function restyleMarker(mk, v, min, max) {
  if (!mk) return;
  const { radius, color, fillOpacity } = styleForValue(v, min, max);

  if (typeof mk.setRadius === 'function') {
    mk.setRadius(radius);
  } else if (mk._radius != null) {
    mk._radius = radius;
    if (mk._update) mk._update();
  }

  if (typeof mk.setStyle === 'function') {
    mk.setStyle({
      color,
      fillColor: color,
      fillOpacity,
      opacity: 0.9,
      weight: 1
    });
  } else if (mk._path) {
    mk._path.setAttribute('stroke', color);
    mk._path.setAttribute('fill', color);
    mk._path.setAttribute('fill-opacity', String(fillOpacity));
    mk._path.setAttribute('stroke-opacity', '0.9');
    mk._path.setAttribute('stroke-width', '1');
  }
}
