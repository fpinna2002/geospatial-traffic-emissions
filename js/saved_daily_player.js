// js/saved_daily_player.js 
import { plot } from './saved_view.js';
import { restyleMarker } from './heat_scale.js';
import { valueFromPoint } from './metrics.js';
import { makePopupContent } from './popups.js';

const UI_ID       = 'dailyPlayerUI';
const SPEED_BOOST = 4;

const clamp   = (v,a,b)=>Math.max(a,Math.min(b,v));
const parseTs = iso => new Date(/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(iso)?iso:iso+'Z');
const fmtTime = (iso,tz) => new Intl.DateTimeFormat('it-IT',{
  timeZone:tz, hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'
}).format(parseTs(iso));
const toDate  = s => {
  const [y,m,d]=String(s||'').split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d));
};
const addDays = (s,n)=>{
  const d=toDate(s);
  d.setUTCDate(d.getUTCDate()+n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
};
const baseDelayMs = (a,b)=>{
  if (!a) return 1000;
  const ta  = parseTs(a);
  const tb  = b ? parseTs(b) : null;
  const dtH = tb ? (tb - ta) / 3600000 : 1;
  return Math.max(0.05, dtH) * 1000;
};

function rawCountsFromPoint(p = {}) {
  return {
    cars   : Number(p.cars)                          || 0,
    motos  : Number(p.motos ?? p.motorcycles)        || 0,
    buses  : Number(p.buses)                         || 0,
    trucks : Number(p.trucks ?? p.heavy_duty_trucks) || 0
  };
}

let UI = null;
let UI_BOUND = false;
let MARKERS  = null;

function ensureUI(){
  if (UI) return UI;

  const host = document.getElementById(UI_ID);
  if (!host){
    console.warn('[dailyPlayer] Elemento #' + UI_ID + ' mancante nell’HTML');
    return null;
  }

  UI = {
    host,
    start: host.querySelector('[data-role="start"]'),
    play : host.querySelector('[data-role="play"]'),
    speed: host.querySelector('[data-role="speed"]'),
    prev : host.querySelector('[data-role="prev"]'),
    next : host.querySelector('[data-role="next"]'),
    day  : host.querySelector('[data-role="day"]'),
    now  : host.querySelector('[data-role="now"]'),
    show(){
      this.host.style.display = '';
      this.host.classList.remove('is-hidden');
    },
    hide(){
      this.host.style.display = 'none';
      this.host.classList.add('is-hidden');
    },
    enable(on){
      if (this.play)  this.play.disabled  = !on;
      if (this.speed) this.speed.disabled = !on;
      if (this.prev)  this.prev.disabled  = !on;
      if (this.next)  this.next.disabled  = !on;
    }
  };

  if (UI.day) UI.day.textContent = 'YYYY-MM-DD';
  if (UI.now) UI.now.textContent = '--:--:--';

  return UI;
}


function bindUI(){
  if (UI_BOUND) return;
  const ui = ensureUI();
  if (!ui) return;

  ui.start?.addEventListener('click', async ()=>{
    await DP.prepareDay(0);
    await DP.play();
  });
  ui.play?.addEventListener('click',  async ()=>{ await DP.togglePlay(); });
  ui.speed?.addEventListener('click', ()=>{ DP.cycleSpeed(); });
  ui.prev?.addEventListener('click', ()=>{ DP.gotoDay(DP.dayIdx - 1, true,  true); });
  ui.next?.addEventListener('click', ()=>{ DP.gotoDay(DP.dayIdx + 1, true,  true); });

  UI_BOUND = true;
}

const DP = {
  tz:'Europe/Rome',
  items:[],
  days:[],
  byDayByCam:new Map(),

  dayIdx:0,
  tsList:[],
  i:0,

  incByCamTs:new Map(),
  cumByCam:new Map(),

  vmaxDay:1,
  playing:false,
  timer:null,
  speed:1,
  runToken:0,

  resetState(){
    this.items = [];
    this.days  = [];
    this.byDayByCam.clear();
    this.tsList = [];
    this.i      = 0;
    this.incByCamTs.clear();
    this.cumByCam.clear();
    this.vmaxDay   = 1;
    this.playing   = false;
    this.timer     = null;
    this.dayIdx    = 0;
    this.speed     = 1;
    this.runToken++;
    MARKERS = null;
  },

  async resetUI(){
    const ui = ensureUI();
    if (!ui) return;
    ui.hide();
    ui.enable(false);
    if (ui.day)  ui.day.textContent   = 'YYYY-MM-DD';
    if (ui.now)  ui.now.textContent   = '--:--:--';
    if (ui.play) ui.play.textContent  = '▶︎ Play';
    if (ui.speed)ui.speed.textContent = '⏩ ×1';
  },

  async buildIndex(items, tz){
    await this.stop(false);
    this.resetState();
    await this.resetUI();

    this.items = Array.isArray(items) ? items : [];
    this.tz    = tz || this.tz;

    const present = new Set();
    const dayFmt  = new Intl.DateTimeFormat('en-CA',{
      timeZone:this.tz, year:'numeric', month:'2-digit', day:'2-digit'
    });
    const dayFromPoint = p => p.date || dayFmt.format(parseTs(p.ts));

    for (const cam of this.items){
      if (cam.series_by_day){
        Object.keys(cam.series_by_day).forEach(d => present.add(d));
      } else if (Array.isArray(cam.series)){
        for (const p of cam.series) if (p?.ts) present.add(dayFromPoint(p));
      }
    }
    if (!present.size) return;

    const arr   = Array.from(present).sort();
    const first = arr[0], last = arr[arr.length-1];

    this.days = [];
    for (let d=first; d<=last; d=addDays(d,1)) this.days.push(d);

    this.byDayByCam.clear();
    for (const d of this.days){
      const perCam = new Map();
      for (const cam of this.items){
        const id = String(cam.id);
        let pts  = [];

        if (cam.series_by_day?.[d]) {
          pts = cam.series_by_day[d].slice();
        } else if (Array.isArray(cam.series)) {
          pts = cam.series.filter(p => p?.ts && dayFromPoint(p) === d);
        }

        pts.sort((a,b)=>parseTs(a.ts)-parseTs(b.ts));
        perCam.set(id, pts);
      }
      this.byDayByCam.set(d, perCam);
    }

    bindUI();
    const ui = ensureUI();
    if (!ui) return;

    ui.show();
    ui.enable(true);
    if (ui.day) ui.day.textContent = this.days[0] || 'YYYY-MM-DD';
  },

  cumulativeCountsFor(camId, ts){
    const day    = this.days[this.dayIdx];
    const perCam = this.byDayByCam.get(day);
    if (!perCam) return {cars:0,motos:0,buses:0,trucks:0};

    const arr  = perCam.get(camId) || [];
    const tRef = parseTs(ts);

    let cars=0,motos=0,buses=0,trucks=0;
    for (const p of arr){
      if (!p?.ts) continue;
      if (parseTs(p.ts) > tRef) break;
      const c = rawCountsFromPoint(p);
      cars   += c.cars;
      motos  += c.motos;
      buses  += c.buses;
      trucks += c.trucks;
    }
    return {cars,motos,buses,trucks};
  },

  async _prepareDayCore(idx){
    this.dayIdx = clamp(idx, 0, this.days.length-1);
    const day   = this.days[this.dayIdx];
    const perCam= this.byDayByCam.get(day) || new Map();

    const tsSet = new Set();
    for (const arr of perCam.values()){
      for (const p of arr) if (p?.ts) tsSet.add(p.ts);
    }
    this.tsList = Array.from(tsSet).sort((a,b)=>parseTs(a)-parseTs(b));
    this.i = 0;

    this.incByCamTs.clear();
    this.cumByCam = new Map(this.items.map(c=>[String(c.id),0]));

    for (const [camId, arr] of perCam.entries()){
      const mm = new Map();
      for (const p of arr){
        if (!p?.ts) continue;
        const inc = +valueFromPoint(p) || 0;
        mm.set(p.ts, (mm.get(p.ts)||0) + inc);
      }
      this.incByCamTs.set(String(camId), mm);
    }

    let vmax = 1;
    for (const [,mm] of this.incByCamTs.entries()){
      let acc = 0;
      for (const ts of this.tsList) acc += (mm.get(ts) || 0);
      vmax = Math.max(vmax, acc);
    }
    this.vmaxDay = vmax;

    if (!MARKERS) MARKERS = plot(this.items).markers;

    for (const [camId, mk] of MARKERS){
      restyleMarker(mk, 0, 0, this.vmaxDay);
      const cam = this.items.find(c => String(c.id) === String(camId));
      if (cam){
        mk.setPopupContent(makePopupContent({
          item: { ...cam, day, cars:0, motos:0, buses:0, trucks:0, total:0 },
          value: 0,
          mode: 'timeline'
        }));
      }
    }

    const ui = ensureUI();
    if (ui){
      if (ui.day) ui.day.textContent = day;
      if (ui.now) ui.now.textContent = this.tsList.length
        ? fmtTime(this.tsList[0], this.tz)
        : '00:00:00';
    }

    return this.tsList.length > 0;
  },

  async prepareDay(idx){
    return this._prepareDayCore(idx);
  },

  async prepareDayAutoFrom(idx) {
    const n = this.days.length;
    if (!n) return false;

    for (let k = 0; k < n; k++) {
      const i = (idx + k) % n;          
      if (await this._prepareDayCore(i)) return true;
    }

    return false;
  },

  async prepareDayAutoBackwardFrom(idx) {
    const n = this.days.length;
    if (!n) return false;

    for (let k = 0; k < n; k++) {
      const i = (idx - k + n) % n;   
      if (await this._prepareDayCore(i)) return true;
    }
    return false;
  },

  _updateMarkersForTs(ts){
    const day = this.days[this.dayIdx];

    for (const cam of this.items){
      const id     = String(cam.id);
      const inc    = (this.incByCamTs.get(id)?.get(ts) || 0);
      const metric = (this.cumByCam.get(id) || 0) + inc;
      this.cumByCam.set(id, metric);

      const counts     = this.cumulativeCountsFor(id, ts);
      const totalCount = counts.cars + counts.motos + counts.buses + counts.trucks;
      const mk         = MARKERS?.get(id);
      if (!mk) continue;

      restyleMarker(mk, metric, 0, this.vmaxDay);
      mk.setPopupContent(makePopupContent({
        item: { ...cam, day, ...counts, total: totalCount },
        value: metric,
        mode : 'timeline'
      }));
    }

    const ui = ensureUI();
    if (ui && ui.now){
      ui.now.textContent = fmtTime(ts, this.tz);
    }
  },

  async gotoDay(idx, skipEmpty = true, autoplay = true) {
    await this.stop(false);

    let ok;
    if (skipEmpty) {
      
      if (idx >= this.dayIdx) {
        ok = await this.prepareDayAutoFrom(idx);          
      } else {
        ok = await this.prepareDayAutoBackwardFrom(idx);   
      }
    } else {
      ok = await this._prepareDayCore(clamp(idx, 0, this.days.length - 1));
    }

    const ui = ensureUI();
    if (!ui) return;

    if (!ok) {
      if (ui.now)  ui.now.textContent  = '--:--:--';
      if (ui.play) ui.play.textContent = '▶︎ Fine';
      return;
    }

    if (autoplay){
      await this.play();
      clearTimeout(this.timer);
      const first  = this.tsList[this.i];
      const second = this.tsList[this.i+1];
      const base   = baseDelayMs(first, second);
      this._schedule(base/(this.speed*SPEED_BOOST));
    }
  },

  async frame(){
    const myToken = this.runToken;
    if (!this.playing || myToken !== this.runToken) return;

    let ts = this.tsList[this.i];

    if (!ts){
      const ok = await this.prepareDayAutoFrom(this.dayIdx + 1);
      if (!this.playing || myToken !== this.runToken) return;
      if (!ok) return this.stop(true);

      ts = this.tsList[this.i];
      const next = this.tsList[this.i+1];
      const base = baseDelayMs(ts, next);
      return this._schedule(base/(this.speed*SPEED_BOOST));
    }

    this._updateMarkersForTs(ts);

    const nextTs = this.tsList[this.i + 1];
    this.i++;

    if (!this.playing || myToken !== this.runToken) return;

    if (!nextTs){
      const advanced = await this.prepareDayAutoFrom(this.dayIdx + 1);
      if (!this.playing || myToken !== this.runToken) return;
      if (!advanced) return this.stop(true);
      this.i = 0; 
      const a   = this.tsList[this.i];
      const b   = this.tsList[this.i+1];
      const base= baseDelayMs(a, b);
      return this._schedule(base/(this.speed*SPEED_BOOST));
    }

    const base = baseDelayMs(ts, nextTs);
    this._schedule(base/(this.speed*SPEED_BOOST));
  },

  _schedule(ms){
    clearTimeout(this.timer);
    if (!this.playing) return;
    const token = this.runToken;
    this.timer = setTimeout(()=>{
      if (!this.playing || token !== this.runToken) return;
      this.frame();
    }, Math.max(0, ms|0));
  },

  async play(){
    if (this.playing) return;
    if (!this.tsList.length){
      const ok = await this.prepareDayAutoFrom(this.dayIdx);
      if (!ok) return this.stop(true);
    }
    this.playing = true;
    this.runToken++;
    const ui = ensureUI();
    if (ui && ui.play){
      ui.play.textContent = '⏸ Pausa';
    }

    const first  = this.tsList[this.i];
    const second = this.tsList[this.i+1];
    const base   = baseDelayMs(first, second);
    this._schedule(base/(this.speed*SPEED_BOOST));
  },

  async stop(end){
    this.playing = false;
    this.runToken++;
    clearTimeout(this.timer);
    this.timer = null;
    const ui = ensureUI();
    if (ui && ui.play){
      ui.play.textContent = end ? '▶︎ Fine' : '▶︎ Play';
    }
  },

  async togglePlay(){
    this.playing ? await this.stop(false) : await this.play();
  },

  cycleSpeed(){
    this.speed = this.speed===1 ? 2 : this.speed===2 ? 4 : 1;
    const ui = ensureUI();
    if (ui && ui.speed){
      ui.speed.textContent = `⏩ ×${this.speed}`;
    }
  }
};

document.addEventListener('saved:daily-data', async ev => {
  const { items, tz, plotInfo } = ev.detail || {};
  MARKERS = (plotInfo && plotInfo.markers) || null;

  ensureUI();
  bindUI();
  await DP.buildIndex(items || [], tz);
});

document.addEventListener('saved:close', async ()=>{
  await DP.stop(false);
  DP.resetState();
  await DP.resetUI();
});

document.addEventListener('saved:open', async () => {
  await DP.stop(false);
  await DP.resetUI();
});

function initDailyPlayerUIOnce() {
  if (UI || UI_BOUND) return;

  const host = document.getElementById(UI_ID);
  if (!host) return;      
  
  const ui = ensureUI();
  if (ui) bindUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDailyPlayerUIOnce, { once: true });
} else {
  initDailyPlayerUIOnce();
}
