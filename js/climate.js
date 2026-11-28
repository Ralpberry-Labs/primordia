// Climate: wind, drifting clouds, rain, soil moisture, temperature and wildfire.
//
// * Clouds are a noise field blown along by the wind; where they are thick it rains.
// * Rain soaks the soil; sun and heat dry it (evaporation). Plants grow with moisture,
//   so wet spells green the land and droughts brown it.
// * Temperature falls with altitude (lapse rate), swings with day/night and seasons,
//   and is moderated near water.
// * Wildfire is a probabilistic cellular automaton in the style of Alexandridis et al.:
//   p = p0 · fuel · dryness · e^(c_w · wind·dir) · e^(c_s · slope). Thunderstorms throw
//   lightning; dry fuel ignites; fire runs downwind and uphill, rain puts it out,
//   and the ash left behind fertilises the soil.
import { TAU, rand, rr, ri, randn, chance, clamp, makeNoise } from './util.js?v=6f9903a0547';

export const WC = 32; // world units per climate cell

export class Climate {
  constructor(w) {
    this.w = w;
    this.cw = Math.ceil(w.W / WC); this.ch = Math.ceil(w.H / WC);
    const n = this.cw * this.ch;
    this.moist = new Float32Array(n);
    this.cloud = new Float32Array(n);
    this.rain = new Float32Array(n);
    this.fire = new Float32Array(n);
    this.ash = new Float32Array(n);
    this.fuel = new Float32Array(n);
    this.elev = new Float32Array(n);
    this.water = new Float32Array(n);
    this.noise = makeNoise(w.seed + 31);
    this.ox = rand() * 100; this.oy = rand() * 100; this.oz = 0;
    this.windA = rand() * TAU; this.windS = 0.6;
    this.humidity = 0.55;
    this.bolts = [];
    this.burning = 0; this.rainFrac = 0; this.landMoist = 0.5; this.dryDays = 0;
    this.state = 'clear';
    this.version = 0;
    // per-cell terrain averages
    const tw = w.tw, th = w.th, R = WC / 2; // terrain px per climate cell = 16 (TERRAIN_RES 2)
    const cnt = new Float32Array(n);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const c = Math.min(this.ch - 1, (y / R) | 0) * this.cw + Math.min(this.cw - 1, (x / R) | 0);
      const i = y * tw + x;
      this.elev[c] += w.elev[i]; this.water[c] += w.ttype[i] <= 1 ? 1 : 0; this.moist[c] += w.fert[i]; cnt[c]++;
    }
    for (let c = 0; c < n; c++) { this.elev[c] /= cnt[c] || 1; this.water[c] /= cnt[c] || 1; this.moist[c] = clamp(this.moist[c] / (cnt[c] || 1) * 0.8 + this.water[c], 0, 1); }
  }
  cellAt(x, y) {
    return clamp((y / WC) | 0, 0, this.ch - 1) * this.cw + clamp((x / WC) | 0, 0, this.cw - 1);
  }
  // °C at a point
  temp(x, y) {
    const w = this.w, c = this.cellAt(x, y);
    const R = w.rules;
    let T = 15 + (R.seasons ? (w.season - 1) / 0.65 * 13 : 0) + (R.dayNight ? (w.light - 0.65) * 12 : 0);
    T -= Math.max(0, this.elev[c] - 0.46) * 70;          // lapse rate: mountains are cold
    T -= this.cloud[c] * 3 * w.light;                     // clouds shade the day
    const wf = this.water[c]; T = T * (1 - wf * 0.4) + 12 * wf * 0.4; // water moderates
    T += this.fire[c] * 30;
    return T + (R.tempShift || 0);
  }
  moistAt(x, y) { return this.moist[this.cellAt(x, y)]; }

  update(dt) {
    const w = this.w, R = w.rules, cw = this.cw, ch = this.ch;
    // wind wanders
    this.windA += randn() * 0.05; this.windS = clamp(this.windS + randn() * 0.04, 0.15, 1.6) * R.wind + (1 - R.wind) * 0.15;
    // humidity: wetter in spring, drier late summer, plus random weather fronts
    const yearPhase = (w.tick / (R.dayLength * 8)) * TAU;
    const target = (R.seasons ? 0.58 + 0.2 * Math.cos(yearPhase) : 0.58) * R.rainfall;
    this.humidity = clamp(this.humidity + randn() * 0.012 + (target - this.humidity) * 0.01, 0.05, 1.2);
    this.ox += Math.cos(this.windA) * this.windS * 0.012 * dt / 8;
    this.oy += Math.sin(this.windA) * this.windS * 0.012 * dt / 8;
    this.oz += 0.0015 * dt / 8;
    const thr = 1.0 - this.humidity * 0.7;
    let rainCells = 0, landM = 0, landN = 0, burning = 0;
    const evapBase = 0.0028 * dt / 8 * R.evaporation;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const c = y * cw + x;
      const nz = this.noise(x * 0.09 + this.ox + this.oz * 0.3, y * 0.09 + this.oy - this.oz * 0.2, 4);
      const cl = clamp((nz - thr + 0.25) * 2.6, 0, 1);
      this.cloud[c] = cl;
      const rn = cl > 0.55 ? (cl - 0.55) / 0.45 : 0;
      this.rain[c] = rn;
      if (rn > 0) rainCells++;
      if (this.water[c] > 0.6) { this.moist[c] = 1; }
      else {
        const T = 15 + (w.season - 1) * 20 - Math.max(0, this.elev[c] - 0.46) * 70;
        const evap = evapBase * clamp((T + 5) / 25, 0.2, 1.8) * (1 - cl * 0.7) * (0.5 + w.light);
        this.moist[c] = clamp(this.moist[c] + rn * 0.01 * dt / 8 * R.rainfall - evap + this.water[c] * 0.002, 0, 1);
        landM += this.moist[c]; landN++;
      }
      this.ash[c] *= 0.9985;
      if (this.fire[c] > 0) {
        burning++;
        this.fire[c] -= 0.03 + rn * 0.4 + this.moist[c] * 0.05;
        this.fuel[c] *= 0.85;
        this.moist[c] *= 0.95;
        if (this.fire[c] <= 0) { this.fire[c] = 0; this.ash[c] = 1; }
      }
    }
    this.rainFrac = rainCells / (cw * ch);
    this.landMoist = landN ? landM / landN : 0.5;
    this.burning = burning;
    // fire spreads (synchronous update so it doesn't race across the map in one pass)
    if (burning && R.fire > 0) {
      const ign = [];
      const wx = Math.cos(this.windA), wy = Math.sin(this.windA);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const c = y * cw + x, f = this.fire[c];
        if (f <= 0.15) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue;
          const n = Y * cw + X;
          if (this.fire[n] > 0 || this.water[n] > 0.4 || this.fuel[n] < 0.08) continue;
          const len = Math.hypot(dx, dy);
          const align = (dx * wx + dy * wy) / len;
          const slope = (this.elev[n] - this.elev[c]) * 20;
          const dry = Math.pow(1 - this.moist[n], 2);
          const p = 0.3 * R.fire * f * Math.min(1, this.fuel[n] * 2) * dry * Math.exp(1.3 * align * this.windS) * Math.exp(clamp(slope, -1.5, 1.5)) / len;
          if (chance(p)) ign.push(n);
        }
      }
      for (const n of ign) this.fire[n] = 1;
    }
    // lightning from thunderheads
    this.bolts = this.bolts.filter((b) => --b.life > 0);
    if (R.lightning > 0) {
      const storms = this.humidity > 0.6 ? 0.06 : 0.02;
      if (chance(storms * R.lightning * dt / 8)) {
        for (let k = 0; k < 30; k++) {
          const c = (rand() * cw * ch) | 0;
          if (this.cloud[c] < 0.6 && !(this.landMoist < 0.25 && chance(0.4))) continue; // "dry lightning" in droughts
          const x = ((c % cw) + rand()) * WC, y = (((c / cw) | 0) + rand()) * WC;
          this.bolts.push({ x, y, life: 6, seed: ri(0, 1e6) });
          w.flash = Math.max(w.flash || 0, 0.35);
          if (this.moist[c] < 0.4 && this.fuel[c] > 0.08 && this.water[c] < 0.3 && R.fire > 0) {
            this.fire[c] = 1;
            if (!this._fireLogged || w.tick - this._fireLogged > 3000) { this._fireLogged = w.tick; w.log('Lightning sparks a wildfire!', 15); }
          }
          break;
        }
      }
    }
    // weather state + drought tracking
    const prev = this.state;
    this.state = burning > 6 ? 'wildfire' : this.rainFrac > 0.25 ? (this.humidity > 0.8 ? 'storm' : 'rain') : this.landMoist < 0.18 ? 'drought' : this.rainFrac > 0.05 ? 'showers' : 'clear';
    if (this.state === 'drought' && prev !== 'drought' && w.tick - (this._droughtLogged || -1e9) > 4000) { this._droughtLogged = w.tick; w.log('Drought: the land is parched and plants wither', 40); }
    if (this.state === 'storm' && prev !== 'storm' && w.tick - (this._stormLogged || -1e9) > 4000) { this._stormLogged = w.tick; w.log('A great storm rolls in', 220); }
    this.version++;
  }

  // fuel = plant biomass + trees per cell (recomputed each update)
  computeFuel() {
    const f = this.fuel; f.fill(0);
    for (const p of this.w.food) if (p.type === 0 && !p.aqua) f[this.cellAt(p.x, p.y)] += p.e / 25;
    for (const t of this.w.trees) f[this.cellAt(t.x, t.y)] += 1.2 * (t.r / 25);
    for (let c = 0; c < f.length; c++) f[c] = Math.min(1, f[c] / 3 + (this.water[c] < 0.3 ? 0.08 : 0));
  }
  ignite(x, y) { const c = this.cellAt(x, y); if (this.water[c] < 0.5) { this.fire[c] = 1; this.fuel[c] = Math.max(this.fuel[c], 0.6); } }
  storm() { this.humidity = 1.15; }
  drought() { this.humidity = 0.08; for (let c = 0; c < this.moist.length; c++) if (this.water[c] < 0.6) this.moist[c] *= 0.4; }
}
