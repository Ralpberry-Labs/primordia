// The world: terrain, plants, trees, structures, creatures, species, and all the rules.
// Brains run in C++/WebAssembly (see js/brain.js, cpp/brain.cpp); everything else is here.
import { TAU, rand, rr, ri, randn, chance, clamp, angleDiff, makeNoise, genusName, epithetName, pick } from './util.js';
import {
  randomGenome, mutate, crossover, distance, brainStats,
  MAX_EYES, CH, N_IN, H_MAX, N_OUT, N_SENSE, S, OUT, W_LEN,
} from './genome.js';

export const RULES = {
  // [default, min, max, step, label, group, help]
  plantRate:     [1.0, 0, 4, 0.05, 'Plant growth', 'Environment', 'How fast new plants sprout.'],
  maxPlants:     [2400, 100, 5000, 50, 'Max plants', 'Environment', 'Carrying capacity of the land.'],
  fruitRate:     [1.0, 0, 4, 0.05, 'Fruit drop', 'Environment', 'How often trees drop rich fruit.'],
  seasons:       [1, 0, 1, 1, 'Seasons', 'Environment', 'Plant growth rises and falls over a year; winter is harsh.'],
  dayNight:      [1, 0, 1, 1, 'Day & night', 'Environment', 'Vision shrinks and cold bites at night.'],
  dayLength:     [3000, 600, 12000, 100, 'Day length', 'Environment', 'Ticks per day.'],
  forestSpread:  [1.0, 0, 4, 0.05, 'Forest spread', 'Environment', 'Trees drop seeds; saplings grow up and start fruiting.'],
  building:      [1, 0, 1, 1, 'Building', 'Civilisation', 'Creatures gather material and can place walls.'],
  gatherRate:    [1.0, 0, 4, 0.05, 'Material gathering ×', 'Civilisation', 'How fast creatures pick up stone, sand and wood.'],
  shelterBonus:  [1.0, 0, 3, 0.05, 'Shelter comfort ×', 'Civilisation', 'Energy saved living among your own walls (bigger at night and in winter).'],
  wallDecay:     [1.0, 0, 5, 0.05, 'Structure decay ×', 'Civilisation', 'How fast walls crumble without upkeep.'],
  teamwork:      [1.0, 0, 3, 0.05, 'Teamwork bonus ×', 'Civilisation', 'Walls placed next to kin walls are stronger.'],
  stigmergy:     [1.0, 0, 2, 0.05, 'Stigmergy (termite instinct)', 'Civilisation', 'Like termites, builders lay blocks where kin walls already are, so lines and rooms grow instead of scattered bricks.'],
  wallsBlock:    [1, 0, 1, 1, 'Walls keep strangers out', 'Civilisation', 'Only the builders’ own species can pass their walls. Others must break them.'],
  lamarck:       [0, 0, 1, 1, 'Inherit learned wisdom', 'Mind', 'Children inherit what parents learned in life (Lamarckian). Off = only genes are inherited.'],
  learnRate:     [1.0, 0, 5, 0.05, 'Learning speed ×', 'Mind', 'Scales how fast brains rewire from reward and pain.'],
  brainCost:     [0.2, 0, 4, 0.05, 'Brain cost ×', 'Mind', 'Energy cost of each neuron. Lower it to evolve smarter minds.'],
  neurogenesis:  [0.65, 0, 1, 0.01, 'Neurogenesis bias', 'Mind', 'Chance a brain mutation adds a neuron rather than removes one.'],
  mutRate:       [1.0, 0, 5, 0.05, 'Mutation rate ×', 'Evolution', 'Multiplies each genome’s own (evolving) mutation rate.'],
  mutAmt:        [1.0, 0.1, 4, 0.05, 'Mutation size ×', 'Evolution', 'How big each mutation step is.'],
  reproMode:     [2, 0, 2, 1, 'Reproduction', 'Evolution', '0 asexual, 1 sexual only, 2 both (mate if possible).'],
  speciesGap:    [1.0, 0.4, 3, 0.05, 'Species threshold', 'Evolution', 'Genetic distance that splits off a new species.'],
  metabolism:    [1.0, 0.2, 3, 0.05, 'Metabolism ×', 'Life', 'Energy every body burns just to live.'],
  herbGain:      [1.0, 0.2, 3, 0.05, 'Plant nutrition ×', 'Life', 'Energy from plants and fruit.'],
  carnGain:      [1.0, 0.2, 3, 0.05, 'Meat nutrition ×', 'Life', 'Energy from hunting and scavenging.'],
  numbers:       [1.0, 0, 3, 0.05, 'Strength in numbers', 'Conflict', 'Each extra attacker on the same victim adds force, so a mob of small creatures can bring down a giant.'],
  sizeMatters:   [1.0, 0, 2, 0.05, 'Size advantage', 'Conflict', 'How much bigger bodies out-muscle smaller ones in a fight.'],
  disease:       [1.0, 0, 4, 0.05, 'Disease', 'Conflict', 'Sickness breaks out in crowds and spreads by contact; survivors become immune.'],
  attack:        [1.0, 0, 3, 0.05, 'Bite strength ×', 'Life', 'Damage of attacks (on creatures and walls).'],
  agingCost:     [1.0, 0, 3, 0.05, 'Aging ×', 'Life', 'How fast creatures grow old.'],
  maxPop:        [700, 50, 1500, 10, 'Max creatures', 'Life', 'Hard cap on population.'],
  autoSeed:      [1, 0, 1, 1, 'Auto re-seed', 'Life', 'If life dies out, new founders arrive.'],
  migration:     [1, 0, 1, 1, 'Migration', 'Life', 'If grazers or hunters vanish, a few migrants of that kind wander in.'],
};
export function defaultRules() {
  const r = {}; for (const k in RULES) r[k] = RULES[k][0]; return r;
}

const CELL = 64;
export const TERRAIN_RES = 2;   // world units per terrain pixel
export const BS = 8;            // world units per structure block
const SHELTER_R = 3;            // blocks radius counted as "home"
const HOME_R = 12;              // blocks radius scanned for the nearest own wall
const WALL_MAX_HP = 260;

export class World {
  constructor(opts = {}) {
    this.W = opts.W || 2400;
    this.H = opts.H || 1600;
    this.brain = opts.brain;
    this.rules = opts.rules || defaultRules();
    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    this.tick = 0;
    this.creatures = [];
    this.byId = new Map();
    this.food = [];
    this.trees = [];
    this.species = new Map();
    this.speciesOrder = [];
    this.groups = [];
    this.history = [];
    this.events = [];
    this.nextId = 1;
    this.nextSpecies = 1;
    this.births = 0; this.deaths = 0; this.kills = 0; this.built = 0; this.razed = 0;
    this.maxGen = 0;
    this.particles = [];
    this.light = 1; this.season = 1; this.cold = 0;
    this.cols = Math.ceil(this.W / CELL); this.rows = Math.ceil(this.H / CELL);
    this.cGrid = Array.from({ length: this.cols * this.rows }, () => []);
    this.fGrid = Array.from({ length: this.cols * this.rows }, () => []);
    // structures
    this.bw = Math.ceil(this.W / BS); this.bh = Math.ceil(this.H / BS);
    this.bOwner = new Int32Array(this.bw * this.bh);   // species id, 0 = empty, -1 = ruin
    this.bHp = new Float32Array(this.bw * this.bh);
    this.bBuilt = new Int32Array(this.bw * this.bh);  // tick built
    this.blockCount = 0;
    this.blocksBySpecies = new Map();
    this.structVersion = 0;
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
      const bx = Math.min(nx, 1 - nx), by = Math.min(ny, 1 - ny);
      const edge = Math.min(bx, by);
      e = e * 0.85 + 0.15 - (edge < 0.06 ? (0.06 - edge) * 3.5 : 0);
      const m = n2(nx * 6, ny * 6, 4);
      elev[i] = e;
      let t, f;
      if (e < 0.36) { t = 0; f = 0; }
      else if (e < 0.41) { t = 1; f = 0.05; }
      else if (e < 0.44) { t = 2; f = 0.25; }
      else if (e > 0.79) { t = 5; f = 0.08; }
      else if (m > 0.55) { t = 4; f = 0.8 + (m - 0.55) * 0.6; }
      else { t = 3; f = 0.35 + m * 0.6; }
      f *= 0.85 + n3(nx * 20, ny * 20, 2) * 0.3;
      type[i] = t; fert[i] = clamp(f, 0, 1);
    }
    this.elev = elev; this.fert = fert; this.ttype = type;
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
  bAt(x, y) {
    const bx = (x / BS) | 0, by = (y / BS) | 0;
    if (bx < 0 || by < 0 || bx >= this.bw || by >= this.bh) return -1;
    return by * this.bw + bx;
  }

  // ---------- seeding ----------
  populate(nSpecies = 6, perSpecies = 22) {
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
  addTree(x, y, grow = false, parent = null) {
    const r = rr(18, 30);
    const t = { x, y, r: grow ? 5 : r, maxR: r, timer: ri(0, 300), seed: ri(0, 1e6), hue: rr(85, 140), fruitHue: pick([8, 20, 330, 45, 280]), age: grow ? 0 : 99999 };
    this.trees.push(t);
    return t;
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
      diet: genome.diet, blocks: 0, built: 0, milestone: 0,
    };
    this.species.set(id, sp);
    this.speciesOrder.push(id);
    if (parent) this.log(`New species ${sp.name} split from ${parent.name}`, sp.hue);
    return sp;
  }
  log(msg, hue = 200) {
    this.events.unshift({ t: this.tick, msg, hue });
    if (this.events.length > 80) this.events.pop();
  }

  spawn(g, x, y, sp, gen, parent, energy, weights) {
    if (this.creatures.length >= 1590) return null;
    x = clamp(x, 5, this.W - 5); y = clamp(y, 5, this.H - 5);
    const slot = this.brain.alloc(g, weights);
    if (slot < 0) return null;
    const maxE = 70 * g.size * g.size;
    const c = {
      id: this.nextId++, g, x, y, a: rand() * TAU, vx: 0, vy: 0, slot,
      maxE, energy: energy ?? maxE * 0.5,
      maxHp: 30 * g.size * g.size * (1 + g.armor * 1.5), hp: 0,
      age: 0, life: g.lifespan * rr(0.85, 1.15), gen, sp: sp.id, parent: parent ? parent.id : null,
      mother: parent ? parent.id : null, eyes: new Float32Array(MAX_EYES * CH),
      signal: 0, pain: 0, heard: 0, crowd: 0, children: 0, killsN: 0, eatenE: 0, builtN: 0, raidN: 0,
      brain: brainStats(g), radius: g.size * 3.6, think: ri(0, 1), dead: false, biting: 0,
      cool: 0, buildCool: 0, birthTick: this.tick, carry: 0, shelter: 0, homeX: -1, homeY: -1, homeD: 1, builders: 0, family: 0,
      lastE: 0, lastShelter: 0, reward: 0, lastBuild: -9999, shared: 0, sick: 0, immune: false,
    };
    c.hp = c.maxHp; c.lastE = c.energy;
    this.creatures.push(c);
    this.byId.set(c.id, c);
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
    const b = this.bAt(x, y);
    if (b >= 0 && this.bOwner[b] > 0) return; // nothing grows inside a wall
    const max = 10 + this.fert[i] * 14;
    this.food.push({ x, y, e: max * rr(0.1, 0.4), max, type: 0, age: 0, v: ri(0, 3) });
  }
  addFood(x, y, type, e) {
    const f = { x, y, e, max: e, type, age: 0, v: ri(0, 3) };
    this.food.push(f);
    return f;
  }

  // ---------- structures ----------
  placeBlock(c, b) {
    const R = this.rules;
    const bx = b % this.bw, by = (b / this.bw) | 0;
    let friends = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = bx + dx, ny = by + dy;
      if (nx < 0 || ny < 0 || nx >= this.bw || ny >= this.bh) continue;
      if (this.bOwner[ny * this.bw + nx] === c.sp) friends++;
    }
    this.bOwner[b] = c.sp;
    this.bHp[b] = Math.min(WALL_MAX_HP, 70 + friends * 22 * R.teamwork);
    this.bBuilt[b] = this.tick;
    this.blockCount++;
    const sp = this.species.get(c.sp);
    sp.blocks++; sp.built++;
    c.builtN++; c.lastBuild = this.tick; c.carry = 0;
    this.built++;
    this.structVersion++;
    for (let k = 0; k < 3; k++) this.particles.push({ x: (bx + 0.5) * BS, y: (by + 0.5) * BS, vx: randn() * 0.5, vy: randn() * 0.5 - 0.3, life: 18, hue: 35, s: 1.2 });
    const m = [25, 100, 300, 800, 2000].find((v) => sp.blocks >= v && sp.milestone < v);
    if (m) {
      sp.milestone = m;
      const word = m >= 800 ? 'a walled city' : m >= 300 ? 'a fortress' : m >= 100 ? 'a village of walls' : 'its first shelters';
      this.log(`${sp.name} has built ${word} (${sp.blocks} walls)`, sp.hue);
    }
  }
  removeBlock(b, razed) {
    const o = this.bOwner[b];
    if (o > 0) { const sp = this.species.get(o); if (sp) sp.blocks--; }
    this.bOwner[b] = 0; this.bHp[b] = 0;
    this.blockCount--;
    if (razed) this.razed++;
    this.structVersion++;
  }
  decayBlocks() {
    // runs every 20 ticks: walls weather, ruins crumble faster
    const R = this.rules, n = this.bOwner.length;
    const d = 20 * 0.012 * R.wallDecay * (this.season < 0.7 ? 1.6 : 1);
    const bw = this.bw, O = this.bOwner;
    for (let b = 0; b < n; b++) {
      const o = O[b];
      if (!o) continue;
      // lone walls crumble fast; walls joined into structures brace each other
      const nb = (O[b - 1] === o) + (O[b + 1] === o) + (O[b - bw] === o) + (O[b + bw] === o);
      this.bHp[b] -= (o < 0 ? d * 4 : d) * (nb === 0 ? 3 : nb === 1 ? 1.4 : 0.8);
      if (this.bHp[b] <= 0) this.removeBlock(b, false);
    }
  }
  // Own walls nearby -> shelter (0..1). Also finds the nearest own wall (home).
  survey(c) {
    const bx = (c.x / BS) | 0, by = (c.y / BS) | 0, bw = this.bw, bh = this.bh, sp = c.sp, O = this.bOwner;
    let n = 0;
    for (let dy = -SHELTER_R; dy <= SHELTER_R; dy++) {
      const y = by + dy; if (y < 0 || y >= bh) continue;
      for (let dx = -SHELTER_R; dx <= SHELTER_R; dx++) {
        const x = bx + dx; if (x < 0 || x >= bw) continue;
        if (O[y * bw + x] === sp) n++;
      }
    }
    c.shelter = Math.min(1, n / 14);
    // nearest own wall within HOME_R (sparse ring scan, step 2 for speed)
    let best = 1e9, hx = -1, hy = -1;
    for (let dy = -HOME_R; dy <= HOME_R; dy += 2) {
      const y = by + dy; if (y < 0 || y >= bh) continue;
      for (let dx = -HOME_R; dx <= HOME_R; dx += 2) {
        const x = bx + dx; if (x < 0 || x >= bw) continue;
        if (O[y * bw + x] !== sp) continue;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; hx = x; hy = y; }
      }
    }
    if (hx >= 0) { c.homeX = (hx + 0.5) * BS; c.homeY = (hy + 0.5) * BS; c.homeD = Math.sqrt(best) / HOME_R; }
    else { c.homeX = -1; c.homeD = 1; }
  }
  // Termite-style stigmergy: look at empty cells near the intended spot and pick the one
  // that best continues kin walls (thin lines, corners), avoiding solid 2x2 lumps.
  bestSpot(c, b0, k) {
    const bw = this.bw, bh = this.bh, O = this.bOwner, sp = c.sp;
    const x0 = b0 % bw, y0 = (b0 / bw) | 0;
    let best = b0, bestS = O[b0] ? -99 : 0.6;
    const own = (x, y) => x >= 0 && y >= 0 && x < bw && y < bh && O[y * bw + x] === sp;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
      const b = y * bw + x;
      if (O[b]) continue;
      const n4 = own(x - 1, y) + own(x + 1, y) + own(x, y - 1) + own(x, y + 1);
      if (!n4) continue;
      let sc = n4 === 1 ? 2 : n4 === 2 ? 1.6 : 0.4;
      // continuing a straight line is best
      // walls run a few blocks, then turn: long straight runs are discouraged, corners welcomed
      const run = (sx, sy) => { let n = 0; while (n < 8 && own(x + sx * (n + 1), y + sy * (n + 1))) n++; return n; };
      const rh = Math.max(run(1, 0), run(-1, 0)), rv = Math.max(run(0, 1), run(0, -1));
      const line = Math.max(rh, rv);
      sc += line >= 1 && line <= 4 ? 0.6 : line > 5 ? -1.2 : 0;
      if (rh && rv) sc += 0.8; // corner
      // enclosure: kin walls on the far side make this spot close a room
      let ring = 0;
      for (let k2 = -3; k2 <= 3; k2++) ring += own(x + k2, y - 3) + own(x + k2, y + 3) + own(x - 3, y + k2) + own(x + 3, y + k2);
      sc += Math.min(ring, 8) * 0.12;
      // no solid lumps: penalise completing a 2x2 square
      for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (own(x + ax, y) && own(x, y + ay) && own(x + ax, y + ay)) sc -= 2.5;
      sc = sc * k - (Math.abs(dx) + Math.abs(dy)) * 0.15;
      if (sc > bestS) { bestS = sc; best = b; }
    }
    return best;
  }
  wallRay(c, angle, range) {
    // returns +v for own walls, -v for foreign walls, 0 if nothing seen
    const cs = Math.cos(angle) * BS, sn = Math.sin(angle) * BS, steps = Math.min(20, (range / BS) | 0);
    let x = c.x, y = c.y;
    for (let i = 1; i <= steps; i++) {
      x += cs; y += sn;
      const b = this.bAt(x, y);
      if (b < 0) return 0;
      const o = this.bOwner[b];
      if (o) return (o === c.sp ? 1 : -1) * (1 - i / (steps + 1));
    }
    return 0;
  }
  blocked(c, x, y) {
    const b = this.bAt(x, y);
    if (b < 0) return false;
    const o = this.bOwner[b];
    if (o <= 0) return false;
    return o !== c.sp && this.rules.wallsBlock;
  }

  // ---------- simulation ----------
  step() {
    const R = this.rules;
    this.tick++;
    const t = this.tick;
    const dayPhase = (t % R.dayLength) / R.dayLength;
    this.light = R.dayNight ? 0.3 + 0.7 * clamp(0.5 + 0.75 * Math.sin(dayPhase * TAU), 0, 1) : 1;
    const yearLen = R.dayLength * 8;
    this.season = R.seasons ? 1 + 0.65 * Math.sin((t / yearLen) * TAU) : 1;
    // cold: nights and winters cost extra energy out in the open
    this.cold = (1 - this.light) * 0.8 + (R.seasons ? Math.max(0, 1 - this.season) * 1.2 : 0);

    let sprouts = R.plantRate * this.season * 5;
    while (sprouts > 0) {
      if (rand() < sprouts) {
        if (this.food.length && chance(0.55)) { const f = this.food[(rand() * this.food.length) | 0]; if (f.type === 0) this.spawnPlant(f.x, f.y); }
        else this.spawnPlant();
      }
      sprouts -= 1;
    }
    for (const tr of this.trees) {
      tr.age++;
      if (tr.r < tr.maxR) { tr.r = Math.min(tr.maxR, tr.r + 0.004 * this.season); if (((tr.r * 4) | 0) !== tr._rs) { tr._rs = (tr.r * 4) | 0; tr.sprite = null; } continue; }
      // mature trees drop seeds; forests creep outward over fertile land
      if (R.forestSpread > 0 && this.trees.length < 90 && chance(0.00025 * R.forestSpread * this.season)) {
        const a = rand() * TAU, d = rr(60, 140), x = tr.x + Math.cos(a) * d, y = tr.y + Math.sin(a) * d;
        const ti = this.tAt(x, y), b = this.bAt(x, y);
        if (x > 30 && y > 30 && x < this.W - 30 && y < this.H - 30 && this.fert[ti] > 0.45 && !(b >= 0 && this.bOwner[b] > 0)
          && !this.trees.some((o) => Math.abs(o.x - x) < 55 && Math.abs(o.y - y) < 55)) {
          const s = this.addTree(x, y, true); s.hue = tr.hue + randn() * 6; s.fruitHue = tr.fruitHue;
        }
      }
      tr.timer -= R.fruitRate * (0.6 + this.season * 0.4);
      if (tr.timer <= 0) {
        tr.timer = rr(70, 150);
        const a = rand() * TAU, d = tr.r + rr(4, 44);
        const x = tr.x + Math.cos(a) * d, y = tr.y + Math.sin(a) * d;
        if (!this.isWater(x, y)) this.addFood(x, y, 1, rr(35, 55)).hue = tr.fruitHue;
      }
    }
    const food = this.food;
    let w = 0;
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      f.age++;
      if (f.type === 0) { if (f.e < f.max) f.e += 0.005 * this.season * f.max; }
      else if (f.type === 1) { if (f.age > 2600) f.e -= 0.05; }
      else { f.e -= 0.012 + f.e * 0.0004; }
      if (f.e > 0.4) food[w++] = f;
    }
    food.length = w;
    if (t % 20 === 0) this.decayBlocks();

    this.buildGrids();
    const cr = this.creatures, brain = this.brain;
    // 1) sense — and queue brains that think this tick
    let nThink = 0;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      const thinks = (t + c.think) % 2 === 0;
      this.sense(c, thinks);
      if (thinks) brain.ACTIVE[nThink++] = c.slot;
    }
    // 2) think — one batched call into C++
    if (nThink) brain.think(nThink);
    // 3) act
    for (let i = 0; i < cr.length; i++) this.act(cr[i]);

    if (this._births && this._births.length) { for (const b of this._births) this.birth(b); this._births.length = 0; }
    let k = 0;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      if (c.dead) this.die(c); else cr[k++] = c;
    }
    cr.length = k;

    if (t % 30 === 0) { this.computeGroups(); this.sample(); }
    if (t % 600 === 0) {
      const sick = cr.reduce((a, c) => a + (c.sick > 0 ? 1 : 0), 0);
      if (sick > 25 && !this._epidemic) { this._epidemic = true; this.log(`Epidemic! ${sick} creatures are sick`, 85); }
      else if (sick < 5) this._epidemic = false;
      this.sickCount = sick;
    }
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

  sense(c, thinks) {
    const g = c.g, t = this.tick;
    c.age++;
    if ((t + c.id) % 6 === 0) this.survey(c);
    const range = g.vision * (0.45 + 0.55 * this.light);
    const r2 = range * range;
    const half = g.fov / 2, ne = g.eyes;
    const eyes = c.eyes; if (thinks) eyes.fill(0);
    let heard = 0, crowd = 0, builders = 0, family = 0;
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
        if (d < 110) heard += o.signal * (kin ? 1 : 0.4) * (1 - d / 110);
        if (d < 40) crowd++;
        if (o.sick > 0 && d < 26 && !c.sick && !c.immune && chance(0.006 * this.rules.disease)) c.sick = ri(500, 900);
        if (kin && d < 70 && t - o.lastBuild < 240) builders++;
        const fam = o.id === c.parent || o.parent === c.id || (c.parent && o.parent === c.parent);
        if (fam && d < 80) family = Math.max(family, 1 - d / 80);
        const minD = (c.radius + o.radius) * 0.75;
        if (d < minD && d > 0.01) { const push = (minD - d) * 0.25 / d; c.x -= dx * push; c.y -= dy * push; }
        const rel = angleDiff(Math.atan2(dy, dx), c.a);
        const reach = c.radius + o.radius + 4 + g.mouth * 2;
        if (d < reach && Math.abs(rel) < 0.9 && d < targetD) { target = o; targetD = d; }
        if (kin && d < 30) {
          if (!mate && o.energy > o.maxE * o.g.repro * 0.7 && o.age > 300) mate = o;
          // family first, then whoever is hungriest
          const need = (c.energy / c.maxE) - (o.energy / o.maxE) + (fam ? 0.15 : 0);
          if (need > 0.15 && (!needy || need > needy._need)) { needy = o; o._need = need; }
        }
        if (!thinks || Math.abs(rel) > half) continue;
        const e = Math.min(ne - 1, ((rel + half) / g.fov * ne) | 0);
        const v = 1 - d / range;
        const ch = kin ? 3 : o.g.size < g.size * 1.05 ? 1 : 2;
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
        if (!thinks || edible < 0.08) continue;
        const rel = angleDiff(Math.atan2(dy, dx), c.a);
        if (Math.abs(rel) > half) continue;
        const e = Math.min(ne - 1, ((rel + half) / g.fov * ne) | 0);
        const v = (1 - d / range) * Math.min(1, 0.3 + f.e / 30);
        const idx = e * CH + (f.type === 2 ? 1 : 0);
        if (v > eyes[idx]) eyes[idx] = v;
      }
    }
    if (!c.sick && !c.immune && crowd >= 7 && chance(0.00004 * this.rules.disease * crowd)) { c.sick = ri(500, 900); this._outbreak = (this._outbreak || 0) + 1; }
    c.heard = Math.min(1, heard); c.crowd = crowd; c.builders = Math.min(1, builders / 4); c.family = family;
    c._food = nearFood; c._target = target; c._mate = mate; c._needy = needy;
    if (!thinks) return;
    // walls: one ray down the middle of each eye
    if (this.blockCount > 0) for (let e = 0; e < ne; e++) {
      const a = c.a - half + (e + 0.5) * (g.fov / ne);
      eyes[e * CH + 4] = this.wallRay(c, a, Math.min(range, 140));
    }
    // reward since last thought: energy gained, safety gained, pain felt
    const dE = (c.energy - c.lastE) / c.maxE;
    c.reward = clamp(dE * 12 + (c.shelter - c.lastShelter) * 1.5 - c.pain * 0.6, -1, 1);
    c.lastE = c.energy; c.lastShelter = c.shelter;
    const brain = this.brain, s = c.slot;
    brain.REWARD[s] = c.reward * this.rules.learnRate;
    const inp = brain.inputs(s), B = MAX_EYES * CH;
    inp.set(eyes, 0);
    let hs = 0, hc = 0;
    if (c.homeX >= 0) { const rel = angleDiff(Math.atan2(c.homeY - c.y, c.homeX - c.x), c.a); hs = Math.sin(rel); hc = Math.cos(rel); }
    inp[B + S.energy] = c.energy / c.maxE;
    inp[B + S.health] = c.hp / c.maxHp;
    inp[B + S.age] = c.age / c.life;
    inp[B + S.clock] = Math.sin(t * 0.05 + c.id);
    inp[B + S.bias] = 1;
    inp[B + S.heard] = c.heard;
    inp[B + S.pain] = c.pain;
    inp[B + S.speed] = Math.hypot(c.vx, c.vy) / 2;
    inp[B + S.crowd] = Math.min(1, c.crowd / 6);
    inp[B + S.carry] = c.carry;
    inp[B + S.shelter] = c.shelter;
    inp[B + S['home↺']] = hs;
    inp[B + S['home↑']] = hc;
    inp[B + S.home] = c.homeX >= 0 ? 1 - c.homeD : 0;
    inp[B + S.builders] = c.builders;
    inp[B + S.family] = c.family;
    inp[B + S.reward] = c.reward;
  }

  act(c) {
    const R = this.rules, g = c.g, out = this.brain.outputs(c.slot);
    const target = c._target, nearFood = c._food;
    const herbEff = 1 - g.diet, carnEff = g.diet;

    // ---- movement (walls of strangers block the way) ----
    const tt = this.ttype[this.tAt(c.x, c.y)];
    const water = tt <= 1;
    const thrust = out[OUT.move] > 0 ? out[OUT.move] : out[OUT.move] * 0.35;
    const maxSp = (0.55 + g.speed * 0.75) * (1 - g.armor * 0.35) / Math.sqrt(g.size / 2) * (water ? 0.5 : 1);
    c.a += out[OUT.turn] * 0.16;
    const tvx = Math.cos(c.a) * thrust * maxSp, tvy = Math.sin(c.a) * thrust * maxSp;
    c.vx += (tvx - c.vx) * 0.25; c.vy += (tvy - c.vy) * 0.25;
    let nx = c.x + c.vx, ny = c.y + c.vy;
    if (this.blockCount > 0 && this.blocked(c, nx, ny)) {
      if (!this.blocked(c, nx, c.y)) { ny = c.y; c.vy = 0; }
      else if (!this.blocked(c, c.x, ny)) { nx = c.x; c.vx = 0; }
      else { nx = c.x; ny = c.y; c.vx = c.vy = 0; }
      c.bump = 1;
    }
    // pushed into a foreign wall by the crowd? step back out
    if (this.blockCount > 0 && this.blocked(c, nx, ny)) { nx -= Math.cos(c.a) * 2; ny -= Math.sin(c.a) * 2; }
    c.x = nx; c.y = ny;
    if (c.x < 4) { c.x = 4; c.vx = 0; } else if (c.x > this.W - 4) { c.x = this.W - 4; c.vx = 0; }
    if (c.y < 4) { c.y = 4; c.vy = 0; } else if (c.y > this.H - 4) { c.y = this.H - 4; c.vy = 0; }

    // ---- metabolism: cold hurts outside, shelter comforts ----
    const s2 = g.size * g.size;
    const ageF = c.age / c.life;
    let cost = 0.005 * s2
      + 0.007 * Math.abs(thrust) * g.speed * g.speed * s2
      + 0.00006 * g.vision * Math.sqrt(g.eyes) + 0.00002 * g.vision * g.fov
      + 0.0016 * g.hidden * R.brainCost
      + 0.004 * g.armor * s2
      + 0.0015 * g.mouth * g.diet * s2;
    const exposure = 1 + this.cold * 0.45;               // up to ~+100% in a winter night
    const comfort = 1 - Math.min(0.8, c.shelter * 0.35 * R.shelterBonus * (1 + this.cold));
    cost *= R.metabolism * exposure * comfort * (1 + (ageF > 0.75 ? (ageF - 0.75) * 3 * R.agingCost : 0));
    if (water) cost *= 1.4;
    if (c.sick > 0) { cost *= 1.8; c.sick--; if (c.sick === 0) c.immune = true; if (chance(0.02)) this.particles.push({ x: c.x, y: c.y - 4, vx: randn() * 0.2, vy: -0.4, life: 22, hue: 85, s: 1.2 }); }
    c.energy -= cost;

    // ---- gather material (stone, sand, wood) ----
    if (R.building && c.carry < 1) {
      const rate = tt === 5 ? 0.02 : tt === 2 ? 0.01 : tt === 4 ? 0.0065 : tt === 3 ? 0.003 : 0;
      c.carry = Math.min(1, c.carry + rate * R.gatherRate);
    }
    // ---- build ----
    if (c.buildCool > 0) c.buildCool--;
    if (R.building && out[OUT.build] > 0.3 && c.carry >= 1 && c.buildCool <= 0 && this.blockCount < 3500) {
      const d = c.radius + BS * 0.9;
      const bx = c.x + Math.cos(c.a) * d, by = c.y + Math.sin(c.a) * d;
      let b = this.bAt(bx, by);
      if (R.stigmergy > 0 && b >= 0) b = this.bestSpot(c, b, R.stigmergy);
      if (b >= 0 && !this.bOwner[b] && !this.isWater((b % this.bw + 0.5) * BS, ((b / this.bw | 0) + 0.5) * BS)) {
        this.placeBlock(c, b);
        c.energy -= 1.2 * g.size;
        c.buildCool = 30;
      } else if (b >= 0 && this.bOwner[b] === c.sp && this.bHp[b] < WALL_MAX_HP * 0.8) {
        // repair own wall
        this.bHp[b] = Math.min(WALL_MAX_HP, this.bHp[b] + 80); c.carry = 0; c.buildCool = 20; c.lastBuild = this.tick;
      }
    }

    // ---- eat ----
    const before = c.energy;
    if (nearFood && nearFood.e > 0) {
      const eff = nearFood.type === 2 ? carnEff * R.carnGain : herbEff * R.herbGain * (nearFood.type === 1 ? 1.15 : 1);
      const bite = Math.min(nearFood.e, 0.9 * g.mouth * g.size, (c.maxE - c.energy) / Math.max(eff, 0.05));
      if (bite > 0) { nearFood.e -= bite; c.energy += bite * eff; c.eatenE += bite * eff; }
    }
    // ---- attack creatures, or break foreign walls ----
    c.biting = Math.max(0, c.biting - 1);
    if (out[OUT.bite] > 0.25 && c.cool <= 0) {
      if (target && !target.dead) {
        c.cool = 6;
        // mobbing: count distinct attackers on this victim in the last ~30 ticks (any species)
        const atk = target.attackers || (target.attackers = []);
        let k2 = 0; for (let q = 0; q < atk.length; q += 2) if (this.tick - atk[q + 1] < 30 && atk[q] !== c.id) atk[k2++] = atk[q], atk[k2++] = atk[q + 1];
        atk.length = k2; atk.push(c.id, this.tick);
        const mob = atk.length / 2;
        const pack = 1 + (mob - 1) * 0.5 * R.numbers;  // n attackers -> ~n² total force
        const sizeF = clamp(Math.pow(g.size / target.g.size, 0.9 * R.sizeMatters), 0.35, 2.6);
        const strength = Math.min(1, 0.4 + (c.energy / c.maxE) * 2.5);  // the starving fight weakly
        if (mob >= 4 && target.g.size > g.size * 1.4 && !target._mobLogged && chance(0.2)) {
          target._mobLogged = true;
          const ts = this.species.get(target.sp), ms = this.species.get(c.sp);
          this.log(`A mob of ${mob} ${ms.name.split(' ')[0]} gangs up on a big ${ts.name}`, ms.hue);
        }
        // defenders inside their own walls are hard to hurt
        const fortified = 1 - target.shelter * 0.45;
        const dmg = 1.4 * g.mouth * g.size * (0.25 + g.diet * 1.2) * R.attack * (1 - target.g.armor * 0.7) * pack * sizeF * strength * (0.6 + out[OUT.bite] * 0.4) * fortified;
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
      } else if (this.blockCount > 0) {
        const d = c.radius + BS * 0.8;
        const b = this.bAt(c.x + Math.cos(c.a) * d, c.y + Math.sin(c.a) * d);
        if (b >= 0 && this.bOwner[b] && this.bOwner[b] !== c.sp) {
          c.cool = 6; c.biting = 10;
          this.bHp[b] -= 3 * g.mouth * g.size * R.attack;
          c.energy -= 0.02 * s2;
          if (chance(0.4)) this.particles.push({ x: c.x + Math.cos(c.a) * d, y: c.y + Math.sin(c.a) * d, vx: randn(), vy: randn(), life: 16, hue: 30, s: 1.4 });
          if (this.bHp[b] <= 0) { this.removeBlock(b, true); c.raidN++; }
        }
      }
    }
    if (c.cool > 0) c.cool--;
    // ---- share energy with kin (family first) ----
    const needy = c._needy;
    if (out[OUT.share] > 0.5 && needy && !needy.dead && c.energy > c.maxE * 0.35) {
      const amt = Math.min(1.2, c.energy * 0.02);
      c.energy -= amt; needy.energy = Math.min(needy.maxE, needy.energy + amt * 0.85);
      c.shared += amt;
    }
    c.signal = Math.max(0, out[OUT.signal]);
    if (c.signal > 0) c.energy -= c.signal * 0.004;

    if (c.energy > c.maxE) c.energy = c.maxE;
    c.pain *= 0.85; c.bump = 0;
    if (c.hp < c.maxHp && c.energy > c.maxE * 0.25) c.hp = Math.min(c.maxHp, c.hp + 0.03 * s2);

    // ---- reproduce ----
    if (c.age > 300 && c.energy > c.maxE * g.repro && out[OUT.breed] > -0.4 && this.creatures.length + (this._births ? this._births.length : 0) < R.maxPop) {
      const mode = R.reproMode, mate = c._mate;
      if (mode === 0) this.queueBirth(c, null);
      else if (mate && !mate.dead && mate.energy > mate.maxE * 0.35) this.queueBirth(c, mate);
      else if (mode === 2 && chance(0.2)) this.queueBirth(c, null);
    }
    if (c.energy <= 0 || c.age > c.life) c.dead = true;
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
    // a sheltered nursery gives the young a better start
    const nursery = 1 + p.shelter * 0.3 * R.shelterBonus;
    const each = (budget + mateGive) * 0.85 * nursery / n;
    const sp = this.species.get(p.sp);
    let base = p.g;
    if (R.lamarck) {
      // Lamarckian: the parent's lifetime-learned wiring becomes the child's inborn wiring
      base = { ...p.g, w: Float32Array.from(this.brain.weights(p.slot)) };
    }
    for (let i = 0; i < n; i++) {
      if (this.creatures.length >= R.maxPop) break;
      let g = mate ? crossover(base, mate.g) : base;
      g = mutate(g, R.mutRate, R.mutAmt, R.neurogenesis);
      let csp = sp;
      if (distance(g, sp.rep) > R.speciesGap * 2.6) csp = this.newSpecies(g, sp);
      const ch = this.spawn(g, p.x + randn() * 6, p.y + randn() * 6, csp, p.gen + 1, p, Math.min(each, 70 * g.size * g.size));
      if (!ch) break;
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
      if (sp.peak > 4) this.log(`${sp.name} went extinct${sp.blocks > 20 ? ' — its walls fall to ruin' : ''}`, sp.hue);
      if (sp.blocks > 0) { for (let b = 0; b < this.bOwner.length; b++) if (this.bOwner[b] === sp.id) this.bOwner[b] = -1; sp.blocks = 0; this.structVersion++; }
    }
    this.deaths++;
    const meat = 18 * c.g.size * c.g.size + Math.max(0, c.energy) * 0.4;
    const chunks = Math.max(1, Math.round(c.g.size));
    for (let i = 0; i < chunks; i++) this.addFood(c.x + randn() * 3, c.y + randn() * 3, 2, meat / chunks);
    this.brain.release(c.slot);
    this.byId.delete(c.id);
    c.slot = -1;
  }

  refreshSpecies() {
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
      let cx = 0, cy = 0, coop = 0, builders = 0, shelter = 0;
      for (const c of gr.members) { cx += c.x; cy += c.y; coop += c.shared ? 1 : 0; builders += this.tick - c.lastBuild < 600 ? 1 : 0; shelter += c.shelter; }
      cx /= gr.members.length; cy /= gr.members.length;
      let r = 0;
      for (const c of gr.members) r = Math.max(r, Math.hypot(c.x - cx, c.y - cy));
      groups.push({ cx, cy, r: r + 14, sp: gr.sp, size: gr.members.length, coop, builders, shelter: shelter / gr.members.length });
    }
    groups.sort((a, b) => b.size - a.size);
    this.groups = groups;
    for (const c of cr) c._i = undefined;
  }

  sample() {
    const cr = this.creatures, n = cr.length || 1;
    const avg = { diet: 0, size: 0, speed: 0, eyes: 0, vision: 0, hidden: 0, iq: 0, armor: 0, mutRate: 0, plastic: 0, fov: 0, shelter: 0, builders: 0, learned: 0 };
    const counts = {};
    let sampled = 0;
    for (const c of cr) {
      for (const k in avg) {
        if (k === 'iq') avg.iq += c.brain.iq;
        else if (k === 'shelter') avg.shelter += c.shelter;
        else if (k === 'builders') avg.builders += this.tick - c.lastBuild < 1500 ? 1 : 0;
        else if (k === 'learned') { if (sampled < 60 && chance(0.25)) { avg.learned += this.brain.drift(c.slot, c.g); sampled++; } }
        else avg[k] += c.g[k];
      }
      counts[c.sp] = (counts[c.sp] || 0) + 1;
    }
    for (const k in avg) avg[k] /= k === 'learned' ? Math.max(1, sampled) : n;
    let herb = 0, carn = 0, omni = 0;
    for (const c of cr) { if (c.g.diet < 0.35) herb++; else if (c.g.diet > 0.65) carn++; else omni++; }
    this.history.push({ t: this.tick, pop: cr.length, plants: this.food.length, counts, avg, herb, carn, omni, groups: this.groups.length, walls: this.blockCount });
    if (this.history.length > 800) this.history.splice(0, this.history.length - 800);
  }

  // ---------- god tools ----------
  meteor(x, y) {
    const R = 90;
    for (const c of this.creatures) if (Math.hypot(c.x - x, c.y - y) < R) c.dead = true;
    this.food = this.food.filter((f) => Math.hypot(f.x - x, f.y - y) > R * 0.8);
    const r = Math.ceil(R / BS), bx = (x / BS) | 0, by = (y / BS) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const X = bx + dx, Y = by + dy; if (X < 0 || Y < 0 || X >= this.bw || Y >= this.bh) continue;
      const b = Y * this.bw + X; if (this.bOwner[b]) this.removeBlock(b, true);
    }
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
  winter() {
    // a harsh cold snap: plants die back, those without shelter suffer
    this.food = this.food.filter((f) => f.type !== 0 || chance(0.3));
    for (const c of this.creatures) c.energy -= c.maxE * 0.25 * (1 - c.shelter);
    this.log('A bitter cold snap! Only the sheltered stay warm.', 210);
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
