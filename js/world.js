// The world: terrain, plants, trees, creatures, species, and all the rules.
import { TAU, rand, rr, ri, randn, chance, clamp, angleDiff, makeNoise, genusName, epithetName, pick } from './util.js';
import {
  randomGenome, mutate, crossover, distance, brainStats,
  MAX_EYES, CH, N_IN, H_MAX, N_OUT, O_IH, O_HH, O_HO, O_BH, O_BO,
} from './genome.js';

export const RULES = {
  // [default, min, max, step, label, group, help]
  plantRate:     [1.0, 0, 4, 0.05, 'Plant growth', 'Environment', 'How fast new plants sprout.'],
  maxPlants:     [1600, 100, 4000, 50, 'Max plants', 'Environment', 'Carrying capacity of the land.'],
  fruitRate:     [1.0, 0, 4, 0.05, 'Fruit drop', 'Environment', 'How often trees drop rich fruit.'],
  seasons:       [1, 0, 1, 1, 'Seasons', 'Environment', 'Plant growth rises and falls over a year.'],
  dayNight:      [1, 0, 1, 1, 'Day & night', 'Environment', 'Vision shrinks at night; glowing signals show.'],
  dayLength:     [3000, 600, 12000, 100, 'Day length', 'Environment', 'Ticks per day.'],
  mutRate:       [1.0, 0, 5, 0.05, 'Mutation rate ×', 'Evolution', 'Multiplies each genome’s own (evolving) mutation rate.'],
  mutAmt:        [1.0, 0.1, 4, 0.05, 'Mutation size ×', 'Evolution', 'How big each mutation step is.'],
  reproMode:     [2, 0, 2, 1, 'Reproduction', 'Evolution', '0 asexual, 1 sexual only, 2 both (mate if possible).'],
  neurogenesis:  [0.65, 0, 1, 0.01, 'Neurogenesis bias', 'Evolution', 'Chance a brain mutation adds a neuron rather than removes one. Push it up to breed bigger minds.'],
  speciesGap:    [1.0, 0.4, 3, 0.05, 'Species threshold', 'Evolution', 'Genetic distance that splits off a new species.'],
  metabolism:    [1.0, 0.2, 3, 0.05, 'Metabolism ×', 'Life', 'Energy every body burns just to live.'],
  brainCost:     [0.2, 0, 4, 0.05, 'Brain cost ×', 'Life', 'Energy cost of each neuron. Lower it to evolve smarter minds.'],
  herbGain:      [1.0, 0.2, 3, 0.05, 'Plant nutrition ×', 'Life', 'Energy from plants and fruit.'],
  carnGain:      [1.0, 0.2, 3, 0.05, 'Meat nutrition ×', 'Life', 'Energy from hunting and scavenging.'],
  attack:        [1.0, 0, 3, 0.05, 'Bite strength ×', 'Life', 'Damage of attacks.'],
  agingCost:     [1.0, 0, 3, 0.05, 'Aging ×', 'Life', 'How fast creatures grow old.'],
  maxPop:        [700, 50, 1500, 10, 'Max creatures', 'Life', 'Hard cap on population.'],
  autoSeed:      [1, 0, 1, 1, 'Auto re-seed', 'Life', 'If life dies out, new founders arrive.'],
  migration:     [1, 0, 1, 1, 'Migration', 'Life', 'If grazers or hunters vanish, a few migrants of that kind wander in.'],
};
export function defaultRules() {
  const r = {}; for (const k in RULES) r[k] = RULES[k][0]; return r;
}

const CELL = 64;
export const TERRAIN_RES = 2; // world units per terrain pixel

export class World {
  constructor(opts = {}) {
    this.W = opts.W || 2400;
    this.H = opts.H || 1600;
    this.rules = opts.rules || defaultRules();
    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    this.tick = 0;
    this.creatures = [];
    this.food = [];
    this.trees = [];
    this.species = new Map();
    this.speciesOrder = [];
    this.groups = [];
    this.history = [];
    this.events = [];
    this.nextId = 1;
    this.nextSpecies = 1;
    this.births = 0; this.deaths = 0; this.kills = 0;
    this.maxGen = 0;
    this.particles = [];
    this.light = 1; this.season = 1;
    this.cols = Math.ceil(this.W / CELL); this.rows = Math.ceil(this.H / CELL);
    this.cGrid = Array.from({ length: this.cols * this.rows }, () => []);
    this.fGrid = Array.from({ length: this.cols * this.rows }, () => []);
    this._in = new Float32Array(N_IN);
    this._h = new Float32Array(H_MAX);
    this.genTerrain();
  }

  // ---------- terrain ----------
  genTerrain() {
    const tw = Math.ceil(this.W / TERRAIN_RES), th = Math.ceil(this.H / TERRAIN_RES);
    this.tw = tw; this.th = th;
    const elev = new Float32Array(tw * th), fert = new Float32Array(tw * th), type = new Uint8Array(tw * th);
    const n1 = makeNoise(this.seed), n2 = makeNoise(this.seed + 7), n3 = makeNoise(this.seed + 13);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = y * tw + x;
      const nx = x / tw, ny = y / th;
      let e = n1(nx * 4.2, ny * 4.2 * (th / tw) * 1.5, 5);
      // gentle island falloff near the borders
      const bx = Math.min(nx, 1 - nx), by = Math.min(ny, 1 - ny);
      const edge = Math.min(bx, by);
      e = e * 0.85 + 0.15 - (edge < 0.06 ? (0.06 - edge) * 3.5 : 0);
      const m = n2(nx * 6, ny * 6, 4);
      elev[i] = e;
      let t, f;
      if (e < 0.36) { t = 0; f = 0; }                       // deep water
      else if (e < 0.41) { t = 1; f = 0.05; }               // shallows
      else if (e < 0.44) { t = 2; f = 0.25; }               // sand
      else if (e > 0.79) { t = 5; f = 0.08; }               // rock
      else if (m > 0.55) { t = 4; f = 0.8 + (m - 0.55) * 0.6; } // forest / lush
      else { t = 3; f = 0.35 + m * 0.6; }                   // meadow
      f *= 0.85 + n3(nx * 20, ny * 20, 2) * 0.3;
      type[i] = t; fert[i] = clamp(f, 0, 1);
    }
    this.elev = elev; this.fert = fert; this.ttype = type;
    // fertile cells list for fast plant spawning
    const fc = [];
    for (let i = 0; i < tw * th; i++) if (fert[i] > 0.15) fc.push(i);
    this.fertCells = fc;
    this.terrainVersion = (this.terrainVersion || 0) + 1;
  }
  tAt(x, y) {
    const tx = clamp((x / TERRAIN_RES) | 0, 0, this.tw - 1), ty = clamp((y / TERRAIN_RES) | 0, 0, this.th - 1);
    return ty * this.tw + tx;
  }
  isWater(x, y) { return this.ttype[this.tAt(x, y)] <= 1; }

  // ---------- seeding ----------
  populate(nSpecies = 6, perSpecies = 22) {
    // trees in lush areas
    let tries = 0;
    while (this.trees.length < 26 && tries++ < 4000) {
      const x = rr(60, this.W - 60), y = rr(60, this.H - 60);
      const i = this.tAt(x, y);
      if (this.ttype[i] !== 4 && !(this.ttype[i] === 3 && chance(0.08))) continue;
      if (this.trees.some((t) => Math.hypot(t.x - x, t.y - y) < 120)) continue;
      this.addTree(x, y);
    }
    for (let i = 0; i < this.rules.maxPlants * 0.6; i++) this.spawnPlant();
    for (let s = 0; s < nSpecies; s++) {
      const diet = s < Math.ceil(nSpecies * 0.66) ? rr(0, 0.2) : rr(0.65, 0.95);
      this.foundSpecies(perSpecies, { diet });
    }
  }
  addTree(x, y) {
    this.trees.push({ x, y, r: rr(18, 30), timer: ri(0, 300), seed: ri(0, 1e6), hue: rr(85, 140), fruitHue: pick([8, 20, 330, 45, 280]) });
  }
  foundSpecies(n, opts = {}) {
    const base = randomGenome(opts);
    let x, y, t = 0;
    do { x = rr(80, this.W - 80); y = rr(80, this.H - 80); } while (this.isWater(x, y) && t++ < 200);
    const sp = this.newSpecies(base, null);
    for (let i = 0; i < n; i++) {
      const g = mutate(base, 0.6, 0.6);
      this.spawn(g, x + rr(-60, 60), y + rr(-60, 60), sp, 0, null);
    }
    return sp;
  }
  newSpecies(genome, parent) {
    const id = this.nextSpecies++;
    const genus = parent && chance(0.75) ? parent.genus : genusName();
    const sp = {
      id, genus, name: `${genus} ${epithetName()}`, rep: genome, parent: parent ? parent.id : null,
      born: this.tick, extinct: null, count: 0, peak: 0, total: 0, hue: genome.hue, depth: parent ? parent.depth + 1 : 0,
      diet: genome.diet,
    };
    this.species.set(id, sp);
    this.speciesOrder.push(id);
    if (parent) this.log(`New species ${sp.name} split from ${parent.name}`, sp.hue);
    return sp;
  }
  log(msg, hue = 200) {
    this.events.unshift({ t: this.tick, msg, hue });
    if (this.events.length > 60) this.events.pop();
  }

  spawn(g, x, y, sp, gen, parent, energy) {
    x = clamp(x, 5, this.W - 5); y = clamp(y, 5, this.H - 5);
    const maxE = 70 * g.size * g.size;
    const c = {
      id: this.nextId++, g, x, y, a: rand() * TAU, vx: 0, vy: 0,
      maxE, energy: energy ?? maxE * 0.5,
      maxHp: 30 * g.size * g.size * (1 + g.armor * 1.5), hp: 0,
      age: 0, life: g.lifespan * rr(0.85, 1.15), gen, sp: sp.id, parent: parent ? parent.id : null,
      h: new Float32Array(H_MAX), out: new Float32Array(N_OUT), eyes: new Float32Array(MAX_EYES * CH),
      wHO: null,
      signal: 0, pain: 0, heard: 0, crowd: 0, children: 0, killsN: 0, eatenE: 0,
      brain: brainStats(g), radius: g.size * 3.6, gain: 0, think: ri(0, 1), dead: false, biting: 0,
      cool: 0, birthTick: this.tick,
    };
    c.hp = c.maxHp;
    // lifetime-learnable copy of hidden→output weights
    c.wHO = g.w.slice(O_HO, O_HO + H_MAX * N_OUT);
    this.creatures.push(c);
    sp.count++; sp.total++; if (sp.count > sp.peak) sp.peak = sp.count;
    if (gen > this.maxGen) this.maxGen = gen;
    this.births++;
    return c;
  }

  spawnPlant(nearX, nearY) {
    if (this.food.length >= this.rules.maxPlants) return;
    let x, y, i;
    if (nearX !== undefined) {
      x = nearX + randn() * 26; y = nearY + randn() * 26;
      if (x < 2 || y < 2 || x > this.W - 2 || y > this.H - 2) return;
      i = this.tAt(x, y);
      if (rand() > this.fert[i]) return;
    } else {
      const ci = this.fertCells[(rand() * this.fertCells.length) | 0];
      if (rand() > this.fert[ci]) return;
      x = ((ci % this.tw) + rand()) * TERRAIN_RES; y = (((ci / this.tw) | 0) + rand()) * TERRAIN_RES;
      i = ci;
    }
    const max = 10 + this.fert[i] * 14;
    this.food.push({ x, y, e: max * rr(0.1, 0.4), max, type: 0, age: 0, v: ri(0, 3) });
  }
  addFood(x, y, type, e) {
    const f = { x, y, e, max: e, type, age: 0, v: ri(0, 3) };
    this.food.push(f);
    return f;
  }

  // ---------- simulation ----------
  step() {
    const R = this.rules;
    this.tick++;
    const t = this.tick;
    // day / season cycles
    const dayPhase = (t % R.dayLength) / R.dayLength;
    this.light = R.dayNight ? 0.3 + 0.7 * clamp(0.5 + 0.75 * Math.sin(dayPhase * TAU), 0, 1) : 1;
    const yearLen = R.dayLength * 8;
    this.season = R.seasons ? 1 + 0.65 * Math.sin((t / yearLen) * TAU) : 1;

    // plants sprout + grow
    let sprouts = R.plantRate * this.season * 3.2;
    while (sprouts > 0) {
      if (rand() < sprouts) {
        if (this.food.length && chance(0.55)) { const f = this.food[(rand() * this.food.length) | 0]; if (f.type === 0) this.spawnPlant(f.x, f.y); }
        else this.spawnPlant();
      }
      sprouts -= 1;
    }
    for (const tr of this.trees) {
      tr.timer -= R.fruitRate * (0.6 + this.season * 0.4);
      if (tr.timer <= 0) {
        tr.timer = rr(70, 150);
        const a = rand() * TAU, d = tr.r + rr(4, 44);
        const x = tr.x + Math.cos(a) * d, y = tr.y + Math.sin(a) * d;
        if (!this.isWater(x, y)) this.addFood(x, y, 1, rr(35, 55)).hue = tr.fruitHue;
      }
    }
    // food aging: plants grow, fruit/meat rot
    const food = this.food;
    let w = 0;
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      f.age++;
      if (f.type === 0) { if (f.e < f.max) f.e += 0.003 * this.season * f.max; }
      else if (f.type === 1) { if (f.age > 2600) f.e -= 0.05; }
      else { f.e -= 0.012 + f.e * 0.0004; }
      if (f.e > 0.4) food[w++] = f;
    }
    food.length = w;

    this.buildGrids();
    const cr = this.creatures;
    for (let i = 0; i < cr.length; i++) this.updateCreature(cr[i]);

    // births queued during update
    if (this._births && this._births.length) { for (const b of this._births) this.birth(b); this._births.length = 0; }
    // remove dead
    let k = 0;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      if (c.dead) this.die(c); else cr[k++] = c;
    }
    cr.length = k;

    if (t % 30 === 0) { this.computeGroups(); this.sample(); }
    if (t % 600 === 0) this.refreshSpecies();
    if (R.autoSeed && cr.length < 6 && t % 120 === 0) {
      this.log('A new wave of founders drifts in from beyond.', 50);
      for (let s = 0; s < 3; s++) this.foundSpecies(14, { diet: s === 2 ? rr(0.6, 0.9) : rr(0, 0.25) });
    }
    if (R.migration && t % 300 === 0 && this.history.length) {
      const h = this.history[this.history.length - 1];
      this._noCarn = h.carn === 0 && cr.length > 60 ? (this._noCarn || 0) + 1 : 0;
      this._noHerb = h.herb === 0 && cr.length > 0 ? (this._noHerb || 0) + 1 : 0;
      if (this._noCarn >= 6) { this._noCarn = 0; const s = this.foundSpecies(10, { diet: rr(0.7, 0.95) }); this.log(`Hunters migrate in: ${s.name}`, 0); }
      if (this._noHerb >= 4) { this._noHerb = 0; const s = this.foundSpecies(14, { diet: rr(0, 0.2) }); this.log(`Grazers migrate in: ${s.name}`, 120); }
    }
    // particles
    const P = this.particles; let pw = 0;
    for (let i = 0; i < P.length; i++) { const p = P[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; if (p.life > 0) P[pw++] = p; }
    P.length = pw;
  }

  buildGrids() {
    const cg = this.cGrid, fg = this.fGrid;
    for (let i = 0; i < cg.length; i++) { cg[i].length = 0; fg[i].length = 0; }
    const cols = this.cols;
    for (const c of this.creatures) cg[clamp((c.y / CELL) | 0, 0, this.rows - 1) * cols + clamp((c.x / CELL) | 0, 0, cols - 1)].push(c);
    for (const f of this.food) fg[clamp((f.y / CELL) | 0, 0, this.rows - 1) * cols + clamp((f.x / CELL) | 0, 0, cols - 1)].push(f);
  }

  updateCreature(c) {
    const R = this.rules, g = c.g;
    c.age++;
    // ---- senses ----
    const range = g.vision * (0.45 + 0.55 * this.light);
    const r2 = range * range;
    const half = g.fov / 2, ne = g.eyes;
    const eyes = c.eyes; eyes.fill(0);
    let heard = 0, crowd = 0;
    let nearFood = null, nearFoodD = 1e9, target = null, targetD = 1e9, mate = null, needy = null;
    const x0 = clamp(((c.x - range) / CELL) | 0, 0, this.cols - 1), x1 = clamp(((c.x + range) / CELL) | 0, 0, this.cols - 1);
    const y0 = clamp(((c.y - range) / CELL) | 0, 0, this.rows - 1), y1 = clamp(((c.y + range) / CELL) | 0, 0, this.rows - 1);
    const herbEff = 1 - g.diet, carnEff = g.diet;
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const cell = gy * this.cols + gx;
      const cs = this.cGrid[cell];
      for (let i = 0; i < cs.length; i++) {
        const o = cs[i];
        if (o === c || o.dead) continue;
        const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const kin = o.sp === c.sp;
        if (d < 110) { heard += o.signal * (kin ? 1 : 0.4) * (1 - d / 110); }
        if (d < 40) crowd++;
        const minD = (c.radius + o.radius) * 0.75;
        if (d < minD && d > 0.01) { const push = (minD - d) * 0.25 / d; c.x -= dx * push; c.y -= dy * push; }
        const rel = angleDiff(Math.atan2(dy, dx), c.a);
        const reach = c.radius + o.radius + 4 + g.mouth * 2;
        if (d < reach && Math.abs(rel) < 0.9 && d < targetD) { target = o; targetD = d; }
        if (kin && d < 30) {
          if (!mate && o.energy > o.maxE * o.g.repro * 0.7 && o.age > 300) mate = o;
          if (o.energy / o.maxE < c.energy / c.maxE - 0.15 && (!needy || o.energy < needy.energy)) needy = o;
        }
        if (Math.abs(rel) > half) continue;
        const e = Math.min(ne - 1, ((rel + half) / g.fov * ne) | 0);
        const v = 1 - d / range;
        let ch;
        if (kin) ch = 3;
        else if (o.g.size < g.size * 1.05) ch = 1;
        else ch = 2;
        const idx = e * CH + ch;
        if (v > eyes[idx]) eyes[idx] = v;
      }
      const fs = this.fGrid[cell];
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        const dx = f.x - c.x, dy = f.y - c.y, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const edible = f.type === 2 ? carnEff : herbEff;
        if (d < c.radius + 4 && edible > 0.05 && d < nearFoodD) { nearFood = f; nearFoodD = d; }
        if (edible < 0.08) continue;
        const rel = angleDiff(Math.atan2(dy, dx), c.a);
        if (Math.abs(rel) > half) continue;
        const e = Math.min(ne - 1, ((rel + half) / g.fov * ne) | 0);
        const v = (1 - d / range) * Math.min(1, 0.3 + f.e / 30);
        const idx = e * CH + (f.type === 2 ? 1 : 0);
        if (v > eyes[idx]) eyes[idx] = v;
      }
    }
    c.heard = Math.min(1, heard); c.crowd = crowd;

    // ---- think ----
    if ((this.tick + c.think) % 2 === 0) this.think(c);
    const out = c.out;

    // ---- act: movement ----
    const water = this.isWater(c.x, c.y);
    const thrust = out[0] > 0 ? out[0] : out[0] * 0.35;
    const maxSp = (0.55 + g.speed * 0.75) * (1 - g.armor * 0.35) / Math.sqrt(g.size / 2) * (water ? 0.5 : 1);
    c.a += out[1] * 0.16;
    const tvx = Math.cos(c.a) * thrust * maxSp, tvy = Math.sin(c.a) * thrust * maxSp;
    c.vx += (tvx - c.vx) * 0.25; c.vy += (tvy - c.vy) * 0.25;
    c.x += c.vx; c.y += c.vy;
    if (c.x < 4) { c.x = 4; c.vx = 0; } else if (c.x > this.W - 4) { c.x = this.W - 4; c.vx = 0; }
    if (c.y < 4) { c.y = 4; c.vy = 0; } else if (c.y > this.H - 4) { c.y = this.H - 4; c.vy = 0; }

    // ---- metabolism ----
    const s2 = g.size * g.size;
    const ageF = c.age / c.life;
    let cost = 0.005 * s2
      + 0.007 * Math.abs(thrust) * g.speed * g.speed * s2
      + 0.00006 * g.vision * Math.sqrt(g.eyes) + 0.00002 * g.vision * g.fov
      + 0.0016 * g.hidden * R.brainCost
      + 0.004 * g.armor * s2
      + 0.0015 * g.mouth * g.diet * s2;
    cost *= R.metabolism * (1 + (ageF > 0.75 ? (ageF - 0.75) * 3 * R.agingCost : 0));
    if (water) cost *= 1.4;
    c.energy -= cost;
    const before = c.energy;

    // ---- eat ----
    if (nearFood) {
      const eff = nearFood.type === 2 ? carnEff * R.carnGain : herbEff * R.herbGain * (nearFood.type === 1 ? 1.15 : 1);
      const bite = Math.min(nearFood.e, 0.9 * g.mouth * g.size, (c.maxE - c.energy) / Math.max(eff, 0.05));
      if (bite > 0) { nearFood.e -= bite; c.energy += bite * eff; c.eatenE += bite * eff; }
    }
    // ---- attack ----
    c.biting = Math.max(0, c.biting - 1);
    if (out[2] > 0.25 && target && c.cool <= 0) {
      c.cool = 6;
      let pack = 1;
      // pack hunting: nearby kin also biting the same prey adds force
      const cs = this.cGrid[clamp((target.y / CELL) | 0, 0, this.rows - 1) * this.cols + clamp((target.x / CELL) | 0, 0, this.cols - 1)];
      for (const o of cs) if (o !== c && o.sp === c.sp && o.biting > 0 && Math.abs(o.x - target.x) + Math.abs(o.y - target.y) < 40) pack += 0.35;
      pack = Math.min(pack, 2.4);
      const dmg = 1.4 * g.mouth * g.size * (0.25 + g.diet * 1.2) * R.attack * (1 - target.g.armor * 0.7) * pack * (0.6 + out[2] * 0.4);
      target.hp -= dmg * 3.5;
      const drain = Math.min(target.energy, dmg * 3);
      target.energy -= drain;
      const kin = target.sp === c.sp ? 0.5 : 1;
      c.energy += drain * carnEff * R.carnGain * kin;
      c.energy -= 0.02 * s2;
      target.pain = 1;
      c.biting = 10;
      if (chance(0.5)) this.particles.push({ x: target.x, y: target.y, vx: randn() * 0.8, vy: randn() * 0.8, life: 18, hue: 0, s: 1.6 });
      if (target.hp <= 0 || target.energy <= 0) { target.dead = true; target.killedBy = c.sp; c.killsN++; this.kills++; }
    }
    if (c.cool > 0) c.cool--;
    // ---- share energy with kin (cooperation) ----
    if (out[4] > 0.5 && needy && c.energy > c.maxE * 0.35) {
      const amt = Math.min(1.2, c.energy * 0.02);
      c.energy -= amt; needy.energy = Math.min(needy.maxE, needy.energy + amt * 0.85);
      c.shared = (c.shared || 0) + amt;
    }
    c.signal = Math.max(0, out[3]);
    if (c.signal > 0) c.energy -= c.signal * 0.004;

    c.gain = c.energy - before;
    if (c.energy > c.maxE) c.energy = c.maxE;
    c.pain *= 0.85;
    if (c.hp < c.maxHp && c.energy > c.maxE * 0.25) c.hp = Math.min(c.maxHp, c.hp + 0.03 * s2);

    // ---- reproduce ----
    if (c.age > 300 && c.energy > c.maxE * g.repro && out[5] > -0.4 && this.creatures.length + (this._births ? this._births.length : 0) < R.maxPop) {
      const mode = R.reproMode;
      if (mode === 0) this.queueBirth(c, null);
      else if (mate && !mate.dead && mate.energy > mate.maxE * 0.35) this.queueBirth(c, mate);
      else if (mode === 2 && chance(0.2)) this.queueBirth(c, null);
    }

    if (c.energy <= 0 || c.age > c.life) c.dead = true;
  }

  think(c) {
    const g = c.g, w = g.w, nh = g.hidden, inp = this._in, R = this.rules;
    const ne = g.eyes;
    for (let i = 0; i < ne * CH; i++) inp[i] = c.eyes[i];
    for (let i = ne * CH; i < MAX_EYES * CH; i++) inp[i] = 0;
    const b = MAX_EYES * CH;
    inp[b] = c.energy / c.maxE;
    inp[b + 1] = c.hp / c.maxHp;
    inp[b + 2] = c.age / c.life;
    inp[b + 3] = Math.sin(this.tick * 0.05 + c.id);
    inp[b + 4] = 1;
    inp[b + 5] = c.heard;
    inp[b + 6] = c.pain;
    inp[b + 7] = Math.hypot(c.vx, c.vy) / 2;
    inp[b + 8] = Math.min(1, c.crowd / 6);
    const hPrev = c.h, hNew = this._h;
    for (let j = 0; j < nh; j++) {
      let s = w[O_BH + j];
      for (let i = 0; i < N_IN; i++) { const v = inp[i]; if (v !== 0) s += v * w[O_IH + i * H_MAX + j]; }
      for (let k = 0; k < nh; k++) s += hPrev[k] * w[O_HH + k * H_MAX + j];
      hNew[j] = Math.tanh(s);
    }
    for (let j = 0; j < nh; j++) hPrev[j] = hNew[j];
    const out = c.out, wo = c.wHO;
    for (let m = 0; m < N_OUT; m++) {
      let s = w[O_BO + m];
      for (let j = 0; j < nh; j++) s += hPrev[j] * wo[j * N_OUT + m];
      out[m] = Math.tanh(s);
    }
    // reward-modulated Hebbian learning: food reinforces, pain discourages
    if (g.plastic > 0) {
      const reward = clamp(c.gain * 0.6, -1, 1) - c.pain * 0.5;
      if (reward !== 0) {
        const eta = g.plastic * reward;
        for (let j = 0; j < nh; j++) for (let m = 0; m < N_OUT; m++) {
          const idx = j * N_OUT + m;
          wo[idx] = clamp(wo[idx] + eta * hPrev[j] * out[m], -4, 4);
        }
      }
    }
  }

  queueBirth(p, mate) {
    (this._births || (this._births = [])).push({ p, mate });
  }
  birth({ p, mate }) {
    if (p.dead || p.energy < p.maxE * 0.3) return;
    const R = this.rules;
    const n = Math.max(1, Math.floor(p.g.litter + rand() * 0.6));
    const budget = p.energy * 0.6;
    p.energy -= budget;
    let mateGive = 0;
    if (mate) { mateGive = mate.energy * 0.25; mate.energy -= mateGive; mate.children++; }
    const each = (budget + mateGive) * 0.85 / n;
    const sp = this.species.get(p.sp);
    for (let i = 0; i < n; i++) {
      if (this.creatures.length >= R.maxPop) break;
      let g = mate ? crossover(p.g, mate.g) : p.g;
      g = mutate(g, R.mutRate, R.mutAmt, R.neurogenesis);
      let csp = sp;
      if (distance(g, sp.rep) > R.speciesGap * 2.3) csp = this.newSpecies(g, sp);
      const ch = this.spawn(g, p.x + randn() * 6, p.y + randn() * 6, csp, p.gen + 1, p, Math.min(each, 70 * g.size * g.size));
      ch.a = p.a + randn();
      p.children++;
      for (let k = 0; k < 3; k++) this.particles.push({ x: ch.x, y: ch.y, vx: randn() * 0.6, vy: randn() * 0.6, life: 26, hue: g.hue, s: 1.2 });
    }
  }
  die(c) {
    const sp = this.species.get(c.sp);
    sp.count--;
    if (sp.count <= 0) {
      sp.extinct = this.tick;
      if (sp.peak > 4) this.log(`${sp.name} went extinct`, sp.hue);
    }
    this.deaths++;
    const meat = 18 * c.g.size * c.g.size + Math.max(0, c.energy) * 0.4;
    // carcass split into chunks
    const chunks = Math.max(1, Math.round(c.g.size));
    for (let i = 0; i < chunks; i++) this.addFood(c.x + randn() * 3, c.y + randn() * 3, 2, meat / chunks);
    if (this.selected === c) this.selectedDied = c;
  }

  refreshSpecies() {
    // Let each species' reference drift with its living members.
    const reps = new Map();
    for (const c of this.creatures) if (!reps.has(c.sp) || chance(0.3)) reps.set(c.sp, c.g);
    for (const [id, g] of reps) { const sp = this.species.get(id); sp.rep = g; sp.hue = g.hue; sp.diet = g.diet; }
  }

  computeGroups() {
    const cr = this.creatures, n = cr.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) { parent[i] = i; cr[i]._i = i; }
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const LINK = 48, L2 = LINK * LINK;
    for (let i = 0; i < n; i++) {
      const c = cr[i];
      const gx = clamp((c.x / CELL) | 0, 0, this.cols - 1), gy = clamp((c.y / CELL) | 0, 0, this.rows - 1);
      for (let yy = Math.max(0, gy - 1); yy <= Math.min(this.rows - 1, gy + 1); yy++)
        for (let xx = Math.max(0, gx - 1); xx <= Math.min(this.cols - 1, gx + 1); xx++)
          for (const o of this.cGrid[yy * this.cols + xx]) {
            if (o._i === undefined || o._i <= i || o.sp !== c.sp || o.dead) continue;
            const dx = o.x - c.x, dy = o.y - c.y;
            if (dx * dx + dy * dy < L2) { const a = find(i), b = find(o._i); if (a !== b) parent[a] = b; }
          }
    }
    const m = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let gr = m.get(r);
      if (!gr) { gr = { members: [], sp: cr[i].sp }; m.set(r, gr); }
      gr.members.push(cr[i]);
    }
    const groups = [];
    for (const gr of m.values()) {
      if (gr.members.length < 4) continue;
      let cx = 0, cy = 0, coop = 0;
      for (const c of gr.members) { cx += c.x; cy += c.y; coop += c.shared ? 1 : 0; }
      cx /= gr.members.length; cy /= gr.members.length;
      let r = 0;
      for (const c of gr.members) r = Math.max(r, Math.hypot(c.x - cx, c.y - cy));
      groups.push({ cx, cy, r: r + 14, sp: gr.sp, size: gr.members.length, coop });
    }
    groups.sort((a, b) => b.size - a.size);
    this.groups = groups;
    for (const c of cr) c._i = undefined;
  }

  sample() {
    const cr = this.creatures, n = cr.length || 1;
    const avg = { diet: 0, size: 0, speed: 0, eyes: 0, vision: 0, hidden: 0, iq: 0, armor: 0, mutRate: 0, plastic: 0, fov: 0 };
    const counts = {};
    for (const c of cr) {
      for (const k in avg) avg[k] += k === 'iq' ? c.brain.iq : c.g[k];
      counts[c.sp] = (counts[c.sp] || 0) + 1;
    }
    for (const k in avg) avg[k] /= n;
    let herb = 0, carn = 0, omni = 0;
    for (const c of cr) { if (c.g.diet < 0.35) herb++; else if (c.g.diet > 0.65) carn++; else omni++; }
    this.history.push({ t: this.tick, pop: cr.length, plants: this.food.length, counts, avg, herb, carn, omni, groups: this.groups.length });
    if (this.history.length > 800) this.history.splice(0, this.history.length - 800);
  }

  // ---------- god tools ----------
  meteor(x, y) {
    const R = 90;
    for (const c of this.creatures) if (Math.hypot(c.x - x, c.y - y) < R) c.dead = true;
    this.food = this.food.filter((f) => Math.hypot(f.x - x, f.y - y) > R * 0.8);
    for (let i = 0; i < 60; i++) { const a = rand() * TAU, s = rr(1, 6); this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rr(20, 50), hue: rr(10, 45), s: rr(1.5, 3) }); }
    this.log('A meteor struck!', 20);
    this.flash = 1;
  }
  plague() {
    const top = [...this.species.values()].filter((s) => s.count > 0).sort((a, b) => b.count - a.count)[0];
    if (!top) return;
    for (const c of this.creatures) if (c.sp === top.id && chance(0.6)) c.dead = true;
    this.log(`A plague swept through ${top.name}`, 300);
  }
  bloom() {
    for (let i = 0; i < 500; i++) this.spawnPlant();
    for (const t of this.trees) for (let k = 0; k < 4; k++) { const a = rand() * TAU; this.addFood(t.x + Math.cos(a) * (t.r + 15), t.y + Math.sin(a) * (t.r + 15), 1, 45); }
    this.log('A great bloom covers the land', 110);
  }
  dropFood(x, y) {
    for (let i = 0; i < 14; i++) this.addFood(x + randn() * 18, y + randn() * 18, 1, 40);
  }
  spawnAt(x, y, g) {
    const sp = g && this.species.get(g._sp) && this.species.get(g._sp).count > 0 ? this.species.get(g._sp) : null;
    if (g) {
      const s = sp || this.newSpecies(g, null);
      for (let i = 0; i < 6; i++) this.spawn(mutate(g, 0.5, 0.5), x + randn() * 12, y + randn() * 12, s, 0, null);
    } else {
      const s = this.newSpecies(randomGenome(), null);
      for (let i = 0; i < 8; i++) this.spawn(mutate(s.rep, 0.5, 0.5), x + randn() * 14, y + randn() * 14, s, 0, null);
      this.log(`${s.name} introduced by a god`, s.hue);
    }
  }
  nearestCreature(x, y, maxD) {
    let best = null, bd = maxD;
    for (const c of this.creatures) { const d = Math.hypot(c.x - x, c.y - y) - c.radius; if (d < bd) { bd = d; best = c; } }
    return best;
  }
}
