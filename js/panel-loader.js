// js/panel-loader.js
import { wirePanel } from './panel/wire.js';

export async function loadPanelInto(hostSelector = "#panel-host", url = "./panel.html") {
  const host = document.querySelector(hostSelector);
  if (!host) throw new Error(`Host "${hostSelector}" non trovato`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Impossibile caricare ${url}: ${res.status} ${res.statusText}`);
  host.innerHTML = await res.text();
  wirePanel(host);
  return host; 
}
