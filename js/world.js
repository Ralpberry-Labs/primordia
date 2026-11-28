// The world: terrain, climate, plants, trees, water life, 3D structures, creatures,
// species and all the rules. Brains and vision run in C++/WebAssembly
// (see js/brain.js, cpp/brain.cpp); the rest of the ecology lives here.
import { TAU, rand, rr, ri, randn, chance, clamp, angleDiff, makeNoise, genusName, epithetName, pick } from './util.js?v=6f9903a0547';
import {
  randomGenome, mutate, reproduce, distance, brainStats,
  MAX_EYES, CH, N_IN, H_MAX, N_OUT, N_SENSE, S, OUT, W_LEN,
} from './genome.js?v=6f9903a0547';
import { Climate, WC } from './climate.js?v=6f9903a0547';
import { MAXF } from './brain.js?v=6f9903a0547';

export const RULES = {
  // [default, min, max, step, label, group, help]
  plantRate:     [1.0, 0, 4, 0.05, 'Plant growth', 'Environment', 'How fast new plants sprout.'],
  maxPlants:     [1900, 100, 5000, 50, 'Max plants', 'Environment', 'Carrying capacity of the land.'],
  fruitRate:     [1.0, 0, 4, 0.05, 'Fruit drop', 'Environment', 'How often trees drop rich fruit.'],
  forestSpread:  [1.0, 0, 4, 0.05, 'Forest spread', 'Environment', 'Trees drop seeds; saplings grow up and start fruiting.'],
  seasons:       [1, 0, 1, 1, 'Seasons', 'Environment', 'Summer and winter: growth, warmth and rain all follow the year.'],
  dayNight:      [1, 0, 1, 1, 'Day & night', 'Environment', 'Vision shrinks and cold bites at night.'],
  dayLength:     [3000, 600, 12000, 100, 'Day length', 'Environment', 'Ticks per day.'],
  rainfall:      [1.0, 0, 2.5, 0.05, 'Rainfall', 'Weather', 'How much rain the clouds carry. Rain soaks the soil and crops shoot up.'],
  evaporation:   [1.0, 0, 3, 0.05, 'Evaporation', 'Weather', 'How fast sun and heat dry the soil.'],
  wind:          [1.0, 0, 2, 0.05, 'Wind', 'Weather', 'Blows clouds across the land and drives fire.'],
  lightning:     [1.0, 0, 4, 0.05, 'Lightning', 'Weather', 'Thunderstorms strike; dry fuel catches fire.'],
  fire:          [1.0, 0, 3, 0.05, 'Wildfire spread', 'Weather', 'How readily fire jumps between dry, fuel-rich cells (downwind and uphill faster).'],
  climate:       [1.0, 0, 3, 0.05, 'Climate stress', 'Weather', 'How much heat and cold hurt bodies whose fur does not suit the temperature.'],
  tempShift:     [0, -15, 15, 0.5, 'Global temperature (°C)', 'Weather', 'Warm or chill the whole world.'],
  algae:         [1.0, 0, 3, 0.05, 'Algae in water', 'Water life', 'Food that grows in lakes and ponds for fish.'],
  maxFish:       [160, 0, 500, 10, 'Max water creatures', 'Water life', 'Separate population cap for aquatic life, so land animals can’t crowd fish out.'],
  fishSeed:      [1, 0, 1, 1, 'Fish', 'Water life', 'Seed aquatic species, and let fish migrate back if they die out.'],
  building:      [1, 0, 1, 1, 'Building', 'Civilisation', 'Creatures gather material and can place and stack walls.'],
  maxHeight:     [4, 1, 6, 1, 'Max stack height', 'Civilisation', 'How many blocks can be stacked into towers.'],
  canopyFruit:   [1.0, 0, 3, 0.05, 'Canopy fruit', 'Civilisation', 'Rich fruit high in the treetops — only reachable from a tower. A reason to build up.'],
  gatherRate:    [1.0, 0, 4, 0.05, 'Material gathering ×', 'Civilisation', 'How fast creatures pick up stone, sand and wood.'],
  shelterBonus:  [1.0, 0, 3, 0.05, 'Shelter comfort ×', 'Civilisation', 'Energy saved living among your own walls (bigger at night and in winter).'],
  wallDecay:     [1.0, 0, 5, 0.05, 'Structure decay ×', 'Civilisation', 'How fast walls crumble without upkeep.'],
  teamwork:      [1.0, 0, 3, 0.05, 'Teamwork bonus ×', 'Civilisation', 'Walls placed next to kin walls are stronger.'],
  stigmergy:     [1.0, 0, 2, 0.05, 'Stigmergy (termite instinct)', 'Civilisation', 'Like termites, builders lay blocks where kin walls already are, so lines and rooms grow instead of scattered bricks.'],
  wallsBlock:    [1, 0, 1, 1, 'Walls keep strangers out', 'Civilisation', 'Walls two or more blocks high stop other species (low fences can be climbed). Strangers must break through.'],
  cortex:        [1, 0, 1, 1, 'Transformer cortex', 'Mind', 'A tiny transformer attends over each creature’s last 12 moments and feeds a “thought” to its brain. Lineages share one weight block until a mutation forks it.'],
  smartSelect:   [0, 0, 1, 1, 'Survival of the smartest', 'Mind', 'Every so often the weakest minds are purged and the smartest, most successful get energy to breed.'],
  selectHarsh:   [0.15, 0.02, 0.5, 0.01, 'Purge share', 'Mind', 'Fraction of each species removed in a purge (bottom by score).'],
  selectEvery:   [1500, 300, 6000, 100, 'Purge every (ticks)', 'Mind', 'How often survival of the smartest strikes.'],
  learnRate:     [1.0, 0, 5, 0.05, 'Learning speed ×', 'Mind', 'Scales dopamine learning: how fast brains rewire from surprise.'],
  culture:       [1.0, 0, 4, 0.05, 'Culture (copy parents)', 'Mind', 'Young creatures near a parent copy part of its learned behaviour.'],
  lamarck:       [0, 0, 1, 1, 'Inherit learned wisdom', 'Mind', 'Children inherit what parents learned in life (Lamarckian). Off = only genes are inherited.'],
  brainCost:     [0.2, 0, 4, 0.05, 'Brain cost ×', 'Mind', 'Energy cost of each neuron. Lower it to evolve smarter minds.'],
  neurogenesis:  [0.65, 0, 1, 0.01, 'Neurogenesis bias', 'Mind', 'Chance a brain mutation adds a neuron rather than removes one.'],
  mutRate:       [1.0, 0, 5, 0.05, 'Mutation rate ×', 'Evolution', 'Multiplies each genome’s own (evolving) mutation rate.'],
  mutAmt:        [1.0, 0.1, 4, 0.05, 'Mutation size ×', 'Evolution', 'How big each mutation step is.'],
  reproMode:     [2, 0, 2, 1, 'Reproduction', 'Evolution', '0 asexual, 1 sexual only, 2 both (mate if possible).'],
  hybrids:       [1, 0, 1, 1, 'Hybridisation', 'Evolution', 'Closely related species can still interbreed. The further apart their genes, the less likely the young survive — so species split gradually, as in nature.'],
  mateChoice:    [1, 0, 1, 1, 'Mate choice', 'Evolution', 'Creatures only mate with partners whose colour matches their (evolving) taste — sexual selection.'],
  seedDispersal: [1, 0, 1, 1, 'Seed dispersal', 'Evolution', 'Eaten fruit and plants are carried in the gut and sprout where the animal goes.'],
  speciesGap:    [1.0, 0.4, 3, 0.05, 'Species threshold', 'Evolution', 'Genetic distance that splits off a new species.'],
  economy:       [1, 0, 1, 1, 'Economy', 'Society', 'Creatures can stash surplus food and trade it — for shells (money) or by barter.'],
  shellRate:     [1.0, 0, 4, 0.05, 'Shell finds', 'Society', 'How often beach-combers find shells: the money supply.'],
  inheritance:   [1, 0, 1, 1, 'Inheritance', 'Society', 'Wallets and stashes pass to children (or kin) at death. Off = wealth vanishes.'],
  socialMemory:  [1.0, 0, 3, 0.05, 'Grudges & bonds', 'Society', 'How strongly gifts, trades, bites and love change how creatures feel about each other.'],
  numbers:       [1.0, 0, 3, 0.05, 'Strength in numbers', 'Conflict', 'Each extra attacker on the same victim adds force, so a mob of small creatures can bring down a giant.'],
  sizeMatters:   [1.0, 0, 2, 0.05, 'Size advantage', 'Conflict', 'How much bigger bodies out-muscle smaller ones in a fight.'],
  disease:       [1.0, 0, 4, 0.05, 'Disease', 'Conflict', 'Sickness breaks out in crowds and spreads by contact; survivors become immune.'],
  attack:        [1.0, 0, 3, 0.05, 'Bite strength ×', 'Conflict', 'Damage of attacks (on creatures and walls).'],
  metabolism:    [1.0, 0.2, 3, 0.05, 'Metabolism ×', 'Life', 'Energy every body burns just to live.'],
  herbGain:      [1.0, 0.2, 3, 0.05, 'Plant nutrition ×', 'Life', 'Energy from plants and fruit.'],
  carnGain:      [1.0, 0.2, 3, 0.05, 'Meat nutrition ×', 'Life', 'Energy from hunting and scavenging.'],
  agingCost:     [1.0, 0, 3, 0.05, 'Aging ×', 'Life', 'How fast creatures grow old.'],
  maxPop:        [550, 50, 1500, 10, 'Max creatures', 'Life', 'Hard cap on population.'],
  autoSeed:      [1, 0, 1, 1, 'Auto re-seed', 'Life', 'If life dies out, new founders arrive.'],
  migration:     [1, 0, 1, 1, 'Migration', 'Life', 'If grazers or hunters vanish, a few migrants of that kind wander in.'],
};
export function defaultRules() {
  const r = {}; for (const k in RULES) r[k] = RULES[k][0]; return r;
}

const CELL = 64;
export const TERRAIN_RES = 2;   // world units per terrain pixel
export const BS = 8;            // world units per structure block
const SHELTER_R = 3;
const HOME_R = 12;
const WALL_MAX_HP = 260;
const AIR_K = 0.12;             // quadratic drag coefficient in air

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
    this.births = 0; this.deaths = 0; this.kills = 0; this.built = 0; this.razed = 0; this.purged = 0;
    this.maxGen = 0;
    this.particles = [];
    this.light = 1; this.season = 1; this.cold = 0;
    this.landPlants = 0; this.algaeN = 0;
    this.cols = Math.ceil(this.W / CELL); this.rows = Math.ceil(this.H / CELL);
    this.cGrid = Array.from({ length: this.cols * this.rows }, () => []);
    this.fGrid = Array.from({ length: this.cols * this.rows }, () => []);
    this.bw = Math.ceil(this.W / BS); this.bh = Math.ceil(this.H / BS);
    this.bOwner = new Int32Array(this.bw * this.bh);  // species id, 0 = empty, -1 = ruin
    this.bH = new Uint8Array(this.bw * this.bh);      // stack height (levels)
    this.bHp = new Float32Array(this.bw * this.bh);   // health of the top block
    this.blockCount = 0;
    this.structVersion = 0;
    this.dirtyCells = []; this.wallsAllDirty = true;
    this.market = { feed: [], prices: [], cur: 1, vol: 0, volNow: 0, sumP: 0, nP: 0, trades: 0, barters: 0, index: new Map() };
    this.social = { bullying: 0, defends: 0, gifts: 0, bonds: 0, roles: {} };
    this.genTerrain();
    this.climate = new Climate(this);
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
    const fc = [], wc = [];
    for (let i = 0; i < tw * th; i++) { if (fert[i] > 0.15) fc.push(i); if (type[i] <= 1) wc.push(i); }
    this.fertCells = fc; this.waterCells = wc;
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
  randomWater() {
    for (let k = 0; k < 50; k++) {
      const i = this.waterCells[(rand() * this.waterCells.length) | 0];
      if (i === undefined) return null;
      const x = ((i % this.tw) + 0.5) * TERRAIN_RES, y = (((i / this.tw) | 0) + 0.5) * TERRAIN_RES;
      if (x > 20 && y > 20 && x < this.W - 20 && y < this.H - 20) return [x, y];
    }
    return null;
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
    for (let i = 0; i < 300; i++) this.spawnAlgae();
    for (let s = 0; s < nSpecies; s++) {
      const diet = s < Math.ceil(nSpecies * 0.66) ? rr(0, 0.2) : rr(0.65, 0.95);
      this.foundSpecies(perSpecies, { diet, fur: s % 3 === 2 ? rr(0.5, 0.8) : rr(0.1, 0.45) });
    }
    if (this.rules.fishSeed && this.waterCells.length > 3000) {
      this.foundSpecies(30, { diet: rr(0, 0.1), habitat: rr(0.88, 1), water: true, hue: rr(180, 230) });
      this.foundSpecies(5, { diet: rr(0.75, 0.95), habitat: rr(0.85, 1), water: true, hue: rr(10, 40) });
    }
  }
  addTree(x, y, grow = false) {
    const r = rr(18, 30);
    const t = { x, y, r: grow ? 5 : r, maxR: r, timer: ri(0, 300), seed: ri(0, 1e6), hue: rr(85, 140), fruitHue: pick([8, 20, 330, 45, 280]), age: grow ? 0 : 99999, canopy: 0, ctimer: ri(100, 600) };
    this.trees.push(t);
    return t;
  }
  foundSpecies(n, opts = {}) {
    const base = randomGenome(opts);
    let x, y, t = 0;
    if (opts.water) { const p = this.randomWater(); if (!p) return null; [x, y] = p; }
    else do { x = rr(80, this.W - 80); y = rr(80, this.H - 80); } while (this.isWater(x, y) && t++ < 200);
    const sp = this.newSpecies(base, null);
    for (let i = 0; i < n; i++) {
      const g = mutate(base, 0.6, 0.6);
      let px = x + rr(-60, 60), py = y + rr(-60, 60);
      if (opts.water && !this.isWater(px, py)) { px = x + rr(-8, 8); py = y + rr(-8, 8); }
      this.spawn(g, px, py, sp, 0, null);
    }
    return sp;
  }
  newSpecies(genome, parent) {
    const id = this.nextSpecies++;
    const genus = parent && chance(0.75) ? parent.genus : genusName();
    const sp = {
      id, genus, name: `${genus} ${epithetName()}`, rep: genome, parent: parent ? parent.id : null,
      born: this.tick, extinct: null, count: 0, peak: 0, total: 0, hue: genome.hue, depth: parent ? parent.depth + 1 : 0,
      diet: genome.diet, blocks: 0, built: 0, milestone: 0, tallest: 0, calls: null,
    };
    this.species.set(id, sp);
    this.speciesOrder.push(id);
    if (parent) this.log(`New species ${sp.name} split from ${parent.name}`, sp.hue);
    return sp;
  }
  log(msg, hue = 200) {
    this.events.unshift({ t: this.tick, msg, hue });
    if (this.events.length > 100) this.events.pop();
  }

  spawn(g, x, y, sp, gen, parent, energy, weights) {
    if (this.creatures.length >= 1590) return null;
    x = clamp(x, 5, this.W - 5); y = clamp(y, 5, this.H - 5);
    const slot = this.brain.alloc(g, weights);
    if (slot < 0) return null;
    const maxE = 70 * g.size * g.size;
    const c = {
      id: this.nextId++, g, x, y, z: 0, a: rand() * TAU, vx: 0, vy: 0, slot,
      mass: g.size * g.size * 0.25 + 0.2,
      maxE, energy: energy ?? maxE * 0.5,
      maxHp: 30 * g.size * g.size * (1 + g.armor * 1.5), hp: 0,
      age: 0, life: g.lifespan * rr(0.85, 1.15), gen, sp: sp.id, parent: parent ? parent.id : null,
      eyes: null, signal: 0, pain: 0, heard: 0, crowd: 0, children: 0, killsN: 0, eatenE: 0, builtN: 0, raidN: 0, stackN: 0, canopyN: 0,
      brain: brainStats(g), radius: g.size * 3.6, think: ri(0, 1), dead: false, biting: 0,
      cool: 0, buildCool: 0, birthTick: this.tick, carry: 0, shelter: 0, homeX: -1, homeY: -1, homeD: 1, builders: 0, family: 0,
      lastE: 0, lastShelter: 0, reward: 0, lastBuild: -9999, shared: 0, sick: 0, immune: false,
      v1: 0, v2: 0, hv1: 0, hv2: 0, temp: 15, fire: 0, gut: 0, taught: 0, inWater: false, idx: 0,
      wallet: rr(0, 3), stash: 0, rel: new Map(), friend: 0, friendHurt: 0, tradeOut: -1, priceOut: 0, tradesN: 0, gifts: 0, defends: 0, bullied: 0, role: 'young', bond: 0,
      act: { farm: 0, build: 0, hunt: 0, trade: 0, care: 0, guard: 0 },
    };
    c.hp = c.maxHp; c.lastE = c.energy;
    const b = this.bAt(x, y);
    if (b >= 0 && this.bH[b] && (this.bOwner[b] === sp.id || this.bOwner[b] < 0)) c.z = this.bH[b];
    this.creatures.push(c);
    this.byId.set(c.id, c);
    sp.count++; sp.total++; if (sp.count > sp.peak) sp.peak = sp.count;
    if (gen > this.maxGen) this.maxGen = gen;
    this.births++;
    return c;
  }

  spawnPlant(nearX, nearY, force) {
    if (this.landPlants >= this.rules.maxPlants) return;
    let x, y, i;
    if (nearX !== undefined) {
      x = nearX + (force ? randn() * 4 : randn() * 26); y = nearY + (force ? randn() * 4 : randn() * 26);
      if (x < 2 || y < 2 || x > this.W - 2 || y > this.H - 2) return;
      i = this.tAt(x, y);
      if (this.ttype[i] <= 1) return;
      if (rand() > this.fert[i] + (force ? 0.35 : 0)) return;
    } else {
      const ci = this.fertCells[(rand() * this.fertCells.length) | 0];
      if (rand() > this.fert[ci]) return;
      x = ((ci % this.tw) + rand()) * TERRAIN_RES; y = (((ci / this.tw) | 0) + rand()) * TERRAIN_RES;
      i = ci;
    }
    const cl = this.climate, cc = cl.cellAt(x, y);
    if (cl.fire[cc] > 0) return;
    if (rand() > 0.2 + cl.moist[cc] * 1.1 + cl.ash[cc] * 0.4) return;   // rain makes seeds sprout
    const b = this.bAt(x, y);
    if (b >= 0 && this.bOwner[b] > 0) return;
    const max = 10 + this.fert[i] * 14;
    this.food.push({ x, y, z: 0, e: max * rr(0.1, 0.4), max, type: 0, age: 0, v: ri(0, 3) });
    this.landPlants++;
  }
  spawnAlgae() {
    if (this.algaeN >= 700 * this.rules.algae) return;
    const p = this.randomWater(); if (!p) return;
    const max = rr(8, 16);
    this.food.push({ x: p[0], y: p[1], z: 0, e: max * 0.3, max, type: 0, aqua: true, age: 0, v: 4 });
    this.algaeN++;
  }
  addFood(x, y, type, e, z = 0) {
    const f = { x, y, z, e, max: e, type, age: 0, v: ri(0, 3) };
    this.food.push(f);
    return f;
  }

  // ---------- structures (3D: columns of stacked blocks) ----------
  placeBlock(c, b, stack) {
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
    this.bH[b] = stack ? this.bH[b] + 1 : 1;
    this.bHp[b] = Math.min(WALL_MAX_HP, 70 + friends * 22 * R.teamwork);
    this.blockCount++;
    const sp = this.species.get(c.sp);
    sp.blocks++; sp.built++;
    c.builtN++; c.lastBuild = this.tick; c.carry = 0;
    if (stack) {
      c.stackN++;
      if (this.bH[b] > sp.tallest) {
        sp.tallest = this.bH[b];
        if (this.bH[b] >= 3) this.log(`${sp.name} raised a tower ${this.bH[b]} blocks high`, sp.hue);
      }
    }
    this.built++;
    this.structVersion++; this.dirtyCells.push(b);
    for (let k = 0; k < 3; k++) this.particles.push({ x: (bx + 0.5) * BS, y: (by + 0.5) * BS - this.bH[b] * 6, vx: randn() * 0.5, vy: randn() * 0.5 - 0.3, life: 18, hue: 35, s: 1.2 });
    const m = [25, 100, 300, 800, 2000].find((v) => sp.blocks >= v && sp.milestone < v);
    if (m) {
      sp.milestone = m;
      const word = m >= 800 ? 'a walled city' : m >= 300 ? 'a fortress' : m >= 100 ? 'a village of walls' : 'its first shelters';
      this.log(`${sp.name} has built ${word} (${sp.blocks} blocks)`, sp.hue);
    }
  }
  // remove the top block of a column
  dropBlock(b, razed) {
    const o = this.bOwner[b];
    if (o > 0) { const sp = this.species.get(o); if (sp) sp.blocks--; }
    if (o !== 0) this.blockCount--;
    this.bH[b] = Math.max(0, this.bH[b] - 1);
    if (this.bH[b] === 0) { this.bOwner[b] = 0; this.bHp[b] = 0; }
    else this.bHp[b] = WALL_MAX_HP * 0.6;
    if (razed) this.razed++;
    this.structVersion++; this.dirtyCells.push(b);
  }
  decayBlocks() {
    const R = this.rules, n = this.bOwner.length, cl = this.climate;
    const d = 20 * 0.012 * R.wallDecay * (this.season < 0.7 ? 1.6 : 1);
    const bw = this.bw, O = this.bOwner, Hh = this.bH;
    for (let b = 0; b < n; b++) {
      const o = O[b];
      if (!o) continue;
      const nb = (O[b - 1] === o) + (O[b + 1] === o) + (O[b - bw] === o) + (O[b + bw] === o);
      // towers need a footing: a tall column with no neighbours erodes faster
      const tall = Hh[b] > 1 && nb < 2 ? 1.5 : 1;
      let dmg = (o < 0 ? d * 4 : d) * (nb === 0 ? 3 : nb === 1 ? 1.4 : 0.8) * tall;
      const bx = b % bw, by = (b / bw) | 0;
      if (cl.fire[cl.cellAt((bx + 0.5) * BS, (by + 0.5) * BS)] > 0.3) dmg += 6;
      this.bHp[b] -= dmg;
      if (this.bHp[b] <= 0) this.dropBlock(b, false);
    }
  }
  survey(c) {
    const bx = (c.x / BS) | 0, by = (c.y / BS) | 0, bw = this.bw, bh = this.bh, sp = c.sp, O = this.bOwner, Hh = this.bH;
    let n = 0;
    for (let dy = -SHELTER_R; dy <= SHELTER_R; dy++) {
      const y = by + dy; if (y < 0 || y >= bh) continue;
      for (let dx = -SHELTER_R; dx <= SHELTER_R; dx++) {
        const x = bx + dx; if (x < 0 || x >= bw) continue;
        const b = y * bw + x;
        if (O[b] === sp) n += Math.min(2, Hh[b]);
      }
    }
    c.shelter = Math.min(1, n / 16);
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
    c.temp = this.climate.temp(c.x, c.y) + c.z * -0.5;
    const cl = this.climate, cc = cl.cellAt(c.x, c.y);
    let fire = cl.fire[cc];
    const cx = cc % cl.cw, cy = (cc / cl.cw) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= cl.cw || Y >= cl.ch) continue;
      const f = cl.fire[Y * cl.cw + X]; if (f > 0) fire = Math.max(fire, f * (1 - Math.hypot(dx, dy) / 3.5));
    }
    c.fire = fire;
  }
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
      const run = (sx, sy) => { let n = 0; while (n < 8 && own(x + sx * (n + 1), y + sy * (n + 1))) n++; return n; };
      const rh = Math.max(run(1, 0), run(-1, 0)), rv = Math.max(run(0, 1), run(0, -1));
      const line = Math.max(rh, rv);
      sc += line >= 1 && line <= 4 ? 0.6 : line > 5 ? -1.2 : 0;
      if (rh && rv) sc += 0.8;
      let ring = 0;
      for (let k2 = -3; k2 <= 3; k2++) ring += own(x + k2, y - 3) + own(x + k2, y + 3) + own(x - 3, y + k2) + own(x + 3, y + k2);
      sc += Math.min(ring, 8) * 0.12;
      for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (own(x + ax, y) && own(x, y + ay) && own(x + ax, y + ay)) sc -= 2.5;
      sc = sc * k - (Math.abs(dx) + Math.abs(dy)) * 0.15;
      if (sc > bestS) { bestS = sc; best = b; }
    }
    return best;
  }
  wallRay(c, angle, range) {
    const cs = Math.cos(angle) * BS, sn = Math.sin(angle) * BS, steps = Math.min(20, (range / BS) | 0);
    let x = c.x, y = c.y;
    for (let i = 1; i <= steps; i++) {
      x += cs; y += sn;
      const b = this.bAt(x, y);
      if (b < 0) return 0;
      const o = this.bOwner[b];
      if (o && this.bH[b] > c.z) return (o === c.sp ? 1 : -1) * (1 - i / (steps + 1)) * (0.6 + 0.1 * this.bH[b]);
    }
    return 0;
  }
  // Can c step onto (x, y)? Returns the new height, or -1 if blocked.
  stepTo(c, x, y) {
    const g = c.g;
    if (g.habitat > 0.75 && !this.isWater(x, y)) return -1;      // true fish can't leave water
    const b = this.bAt(x, y);
    if (b < 0) return -1;
    const h = this.bH[b];
    if (!h) return 0;
    const o = this.bOwner[b];
    // a one-block wall is a fence anyone can scramble over; two blocks or more keep strangers out
    if (o > 0 && o !== c.sp && this.rules.wallsBlock && h >= 2) return -1;
    if (h > c.z + 1) return -1;                                  // can climb only one level at a time
    return h;
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
    this.cold = (1 - this.light) * 0.8 + (R.seasons ? Math.max(0, 1 - this.season) * 1.2 : 0);
    const cl = this.climate;
    this.brain.cortexOn = !!R.cortex;
    if (t % 32 === 0) cl.computeFuel();
    if (t % 8 === 0) cl.update(8);

    let sprouts = R.plantRate * this.season * 5;
    while (sprouts > 0) {
      if (rand() < sprouts) {
        if (this.food.length && chance(0.55)) { const f = this.food[(rand() * this.food.length) | 0]; if (f.type === 0 && !f.aqua) this.spawnPlant(f.x, f.y); }
        else this.spawnPlant();
      }
      sprouts -= 1;
    }
    if (chance(R.algae * 1.2)) this.spawnAlgae();
    this.updateTrees();
    const food = this.food, burning = cl.burning > 0;
    let w = 0, lp = 0, al = 0;
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      f.age++;
      if (f.type === 0) {
        if (f.aqua) { if (f.e < f.max) f.e += 0.004 * f.max * (0.5 + this.season * 0.5); }
        else if (f.e < f.max && ((f.age + f.v) & 3) === 0) {   // plants grow in 4-tick steps (cheaper, same rate)
          const cc = f.cc ?? (f.cc = cl.cellAt(f.x, f.y));
          f.e += 0.02 * this.season * f.max * (0.25 + cl.moist[cc] * 1.4 + cl.ash[cc] * 0.8);
          if (cl.moist[cc] < 0.08) f.e -= 0.08;    // drought withers
        }
        if (burning && !f.aqua && cl.fire[f.cc ?? (f.cc = cl.cellAt(f.x, f.y))] > 0.25) f.e = 0;
      } else if (f.type === 1) {
        if (f.z > 0) { if (f.age > 4000) { f.z = 0; f.canopy = false; } }   // overripe canopy fruit falls
        else if (f.age > 2600) f.e -= 0.05;
        if (burning && cl.fire[cl.cellAt(f.x, f.y)] > 0.4) f.e = 0;
      } else { f.e -= 0.012 + f.e * 0.0004; }
      if (f.e > 0.4) { food[w++] = f; if (f.type === 0) { if (f.aqua) al++; else lp++; } }
    }
    food.length = w; this.landPlants = lp; this.algaeN = al;
    if (t % 20 === 0) this.decayBlocks();
    if (this.dirtyCells.length > 20000) { this.dirtyCells.length = 0; this.wallsAllDirty = true; }

    this.buildGrids();
    const cr = this.creatures, brain = this.brain, V = brain.V;
    // 1) pack positions for the C++ vision kernel
    const n = cr.length;
    let nThink = 0, nAqua = 0;
    for (let i = 0; i < n; i++) if (cr[i].g.habitat > 0.6) nAqua++;
    this.nAqua = nAqua;
    for (let i = 0; i < n; i++) {
      const c = cr[i], g = c.g;
      c.idx = i;
      c.thinks = (t + c.think) % 2 === 0;
      V.cx[i] = c.x; V.cy[i] = c.y; V.ca[i] = c.a; V.csz[i] = g.size; V.csig[i] = c.signal; V.cv1[i] = c.v1; V.cv2[i] = c.v2;
      V.crange[i] = g.vision * (0.45 + 0.55 * this.light) * (1 + 0.3 * c.z) * (c.inWater && g.habitat < 0.5 ? 0.6 : 1);
      V.cfov[i] = g.fov; V.cdiet[i] = g.diet; V.csp[i] = c.sp; V.cslot[i] = c.slot; V.ceyes[i] = g.eyes; V.cthink[i] = c.thinks ? 1 : 0;
    }
    const nf = Math.min(food.length, MAXF);
    for (let i = 0; i < nf; i++) { const f = food[i]; V.fx[i] = f.x; V.fy[i] = f.y; V.fe[i] = f.e; V.ft[i] = f.type; }
    brain.senseAll(n, nf, this.W, this.H);
    // 2) local senses in JS, and queue brains that think
    for (let i = 0; i < n; i++) {
      const c = cr[i];
      this.sense(c);
      if (c.thinks) brain.ACTIVE[nThink++] = c.slot;
    }
    // 3) think — one batched call into C++
    if (nThink) brain.think(nThink);
    // 4) act
    for (let i = 0; i < n; i++) this.act(cr[i]);

    if (this._births && this._births.length) { for (const b of this._births) this.birth(b); this._births.length = 0; }
    let k = 0;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      if (c.dead) this.die(c); else cr[k++] = c;
    }
    cr.length = k;

    if (t % 30 === 0) { this.computeGroups(); this.sample(); }
    if (t % 60 === 0) this.marketTick();
    if (t % 300 === 0) {
      // which transformer designs are winning?
      let top = null; for (const cx of this.brain.designs) if (!top || cx.refs > top.refs) top = cx;
      this.cortexTop = top;
      if (top && top.refs >= 80 && top.gen > 0 && !top.logged) { top.logged = true; this.log(`A new cortex design (generation ${top.gen}) has spread to ${top.refs} minds`, 270); }
    }
    if (t % 600 === 0) {
      const sick = cr.reduce((a, c) => a + (c.sick > 0 ? 1 : 0), 0);
      if (sick > 25 && !this._epidemic) { this._epidemic = true; this.log(`Epidemic! ${sick} creatures are sick`, 85); }
      else if (sick < 5) this._epidemic = false;
      this.sickCount = sick;
      this.refreshSpecies();
    }
    if (R.smartSelect && t % Math.max(100, R.selectEvery | 0) === 0) this.purge();
    if (R.autoSeed && cr.length < 6 && t % 120 === 0) {
      this.log('A new wave of founders drifts in from beyond.', 50);
      for (let s = 0; s < 3; s++) this.foundSpecies(14, { diet: s === 2 ? rr(0.6, 0.9) : rr(0, 0.25) });
    }
    if (R.migration && t % 300 === 0 && this.history.length) {
      const h = this.history[this.history.length - 1];
      this._noCarn = h.carn === 0 && cr.length > 60 ? (this._noCarn || 0) + 1 : 0;
      this._noHerb = h.herb === 0 && cr.length > 0 ? (this._noHerb || 0) + 1 : 0;
      this._noFish = R.fishSeed && h.fish === 0 && this.waterCells.length > 3000 ? (this._noFish || 0) + 1 : 0;
      if (this._noCarn >= 6) { this._noCarn = 0; const s = this.foundSpecies(10, { diet: rr(0.7, 0.95) }); this.log(`Hunters migrate in: ${s.name}`, 0); }
      if (this._noHerb >= 4) { this._noHerb = 0; const s = this.foundSpecies(14, { diet: rr(0, 0.2) }); this.log(`Grazers migrate in: ${s.name}`, 120); }
      if (this._noFish >= 5) { this._noFish = 0; const s = this.foundSpecies(16, { diet: rr(0, 0.15), habitat: rr(0.88, 1), water: true, hue: rr(180, 230) }); if (s) this.log(`Fish swim in from a river: ${s.name}`, 200); }
    }
    const P = this.particles; let pw = 0;
    for (let i = 0; i < P.length; i++) { const p = P[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; if (p.life > 0) P[pw++] = p; }
    P.length = pw;
  }

  updateTrees() {
    const R = this.rules, cl = this.climate;
    let burnt = 0;
    for (let i = this.trees.length - 1; i >= 0; i--) {
      const tr = this.trees[i];
      tr.age++;
      const cc = cl.cellAt(tr.x, tr.y);
      if (cl.fire[cc] > 0.55 && chance(0.02)) {
        this.trees.splice(i, 1); burnt++;
        for (let k = 0; k < 8; k++) this.particles.push({ x: tr.x + randn() * 8, y: tr.y + randn() * 8, vx: randn() * 0.3, vy: -rr(0.3, 1), life: rr(30, 60), hue: 20, s: 2 });
        for (const f of this.food) if (f.z > 0 && Math.abs(f.x - tr.x) < tr.r && Math.abs(f.y - tr.y) < tr.r) f.e = 0;
        continue;
      }
      if (tr.r < tr.maxR) { tr.r = Math.min(tr.maxR, tr.r + 0.004 * this.season * (0.4 + cl.moist[cc])); if (((tr.r * 4) | 0) !== tr._rs) { tr._rs = (tr.r * 4) | 0; tr.sprite = null; } continue; }
      if (R.forestSpread > 0 && this.trees.length < 90 && chance(0.00025 * R.forestSpread * this.season * (0.3 + cl.moist[cc]))) {
        const a = rand() * TAU, d = rr(60, 140), x = tr.x + Math.cos(a) * d, y = tr.y + Math.sin(a) * d;
        this.trySapling(x, y, tr);
      }
      tr.timer -= R.fruitRate * (0.6 + this.season * 0.4) * (0.5 + cl.moist[cc]);
      if (tr.timer <= 0) {
        tr.timer = rr(70, 150);
        const a = rand() * TAU, d = tr.r + rr(4, 44);
        const x = tr.x + Math.cos(a) * d, y = tr.y + Math.sin(a) * d;
        if (!this.isWater(x, y)) this.addFood(x, y, 1, rr(35, 55)).hue = tr.fruitHue;
      }
      // the richest fruit ripens high in the canopy: only climbers can reach it
      if (R.canopyFruit > 0 && --tr.ctimer <= 0) {
        tr.ctimer = rr(250, 500) / R.canopyFruit;
        let n = 0; for (const f of this.food) if (f.z > 0 && f.tree === tr) n++;
        if (n < 4) {
          const a = rand() * TAU, d = rr(0, tr.r * 0.7);
          const f = this.addFood(tr.x + Math.cos(a) * d, tr.y + Math.sin(a) * d - 4, 1, rr(90, 130), 2);
          f.hue = tr.fruitHue; f.canopy = true; f.tree = tr;
        }
      }
    }
    if (burnt >= 1) { this._burntTrees = (this._burntTrees || 0) + burnt; if (this._burntTrees >= 3) { this.log(`Wildfire has burned ${this._burntTrees} trees`, 15); this._burntTrees = 0; } }
  }
  trySapling(x, y, parent) {
    const ti = this.tAt(x, y), b = this.bAt(x, y);
    if (x > 30 && y > 30 && x < this.W - 30 && y < this.H - 30 && this.fert[ti] > 0.4 && this.ttype[ti] > 1 && !(b >= 0 && this.bOwner[b] > 0)
      && !this.trees.some((o) => Math.abs(o.x - x) < 55 && Math.abs(o.y - y) < 55)) {
      const s = this.addTree(x, y, true);
      if (parent) { s.hue = parent.hue + randn() * 6; s.fruitHue = parent.fruitHue; }
      return s;
    }
    return null;
  }

  buildGrids() {
    const cg = this.cGrid, fg = this.fGrid;
    for (let i = 0; i < cg.length; i++) { cg[i].length = 0; fg[i].length = 0; }
    const cols = this.cols;
    for (const c of this.creatures) cg[clamp((c.y / CELL) | 0, 0, this.rows - 1) * cols + clamp((c.x / CELL) | 0, 0, cols - 1)].push(c);
    for (const f of this.food) fg[clamp((f.y / CELL) | 0, 0, this.rows - 1) * cols + clamp((f.x / CELL) | 0, 0, cols - 1)].push(f);
  }

  // Local senses (short range) in JS; long-range vision already filled by C++.
  sense(c) {
    const g = c.g, t = this.tick, R = this.rules, V = this.brain.V, i = c.idx;
    c.age++;
    if ((t + c.id) % 6 === 0) this.survey(c);
    // local scan runs every other tick (staggered); in between, cached results are reused
    if ((t + c.id) & 1) {
      if (c._target && c._target.dead) c._target = null;
      if (c._food && c._food.e <= 0.4) c._food = null;
      if (c._mate && c._mate.dead) c._mate = null;
      if (c._needy && c._needy.dead) c._needy = null;
      if (c._partner && c._partner.dead) c._partner = null;
      return this.senseInputs(c);
    }
    const LR = 50, LR2 = LR * LR;
    let builders = 0, family = 0;
    let nearFood = null, nearFoodD = 1e9, target = null, targetD = 1e9, mate = null, needy = null, needS = 0;
    let partner = null, nearest = null, nearD = 1e9, friendHurt = 0;
    const x0 = clamp(((c.x - LR) / CELL) | 0, 0, this.cols - 1), x1 = clamp(((c.x + LR) / CELL) | 0, 0, this.cols - 1);
    const y0 = clamp(((c.y - LR) / CELL) | 0, 0, this.rows - 1), y1 = clamp(((c.y + LR) / CELL) | 0, 0, this.rows - 1);
    const herbEff = 1 - g.diet, carnEff = g.diet;
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    const ready = c.energy > c.maxE * g.repro * 0.9;
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const cell = gy * this.cols + gx;
      const cs = this.cGrid[cell];
      const off = cs.length > 10 ? (rand() * cs.length) | 0 : 0, lim = Math.min(cs.length, 10);
      for (let q = 0; q < lim; q++) {
        const o = cs[(q + off) % cs.length];
        if (o === c || o.dead) continue;
        const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy;
        if (d2 > LR2) continue;
        const d = Math.sqrt(d2);
        const kin = o.sp === c.sp;
        if (o.sick > 0 && d < 26 && !c.sick && !c.immune && chance(0.006 * R.disease)) c.sick = ri(500, 900);
        if (kin && t - o.lastBuild < 240) builders++;
        const fam = kin && (o.id === c.parent || o.parent === c.id || (c.parent !== null && o.parent === c.parent));
        if (fam) family = Math.max(family, 1 - d / LR);
        if (d < nearD) { nearD = d; nearest = o; }
        if (!partner && d < 32 && o.tradeOut > 0.1 && (o.stash >= 3 || c.stash >= 3)) partner = o;
        const af = c.rel.size ? (c.rel.get(o.id) || 0) : 0;
        if (af > 0.3 && o.pain > 0.5) friendHurt = Math.max(friendHurt, af);
        const dz = o.z - c.z;
        // bodies push apart (heavier ones move less) — only on the same level
        const minD = (c.radius + o.radius) * 0.75;
        if (d < minD && d > 0.01 && dz === 0) { const push = (minD - d) * 0.5 * (o.mass / (c.mass + o.mass)) / d; c.x -= dx * push; c.y -= dy * push; }
        // in front and in reach (and within one level up/down)?
        const reach = c.radius + o.radius + 4 + g.mouth * 2;
        if (d < reach && dz <= 1 && dz >= -1 && (dx * ca + dy * sa) > d * 0.62 && d < targetD) { target = o; targetD = d; }
        if (!mate && ready && d < 30 && !kin && R.hybrids && chance(0.08) && o.age > 300 && o.energy > o.maxE * o.g.repro * 0.7
          && Math.abs(o.g.habitat - g.habitat) < 0.3 && Math.abs(o.g.diet - g.diet) < 0.3 && distance(g, o.g) < R.speciesGap * 3.2) {
          let hd = Math.abs(o.g.hue - g.pref); hd = Math.min(hd, 360 - hd);
          if (!R.mateChoice || hd <= 25 + 180 * (1 - g.choosy)) mate = o;
        }
        if (kin && d < 30) {
          if (!mate && ready && o.energy > o.maxE * o.g.repro * 0.7 && o.age > 300) {
            let ok = true;
            if (R.mateChoice) { let hd = Math.abs(o.g.hue - g.pref); hd = Math.min(hd, 360 - hd); ok = hd <= 25 + 180 * (1 - g.choosy); }
            if (ok) mate = o;
          }
          const need = (c.energy / c.maxE) - (o.energy / o.maxE) + (fam ? 0.15 : 0);
          if (need > 0.15 && need > needS) { needy = o; needS = need; }
        }
      }
    }
    const reachF = c.radius + 4, FR = reachF + 12;
    const fx0 = clamp(((c.x - FR) / CELL) | 0, 0, this.cols - 1), fx1 = clamp(((c.x + FR) / CELL) | 0, 0, this.cols - 1);
    const fy0 = clamp(((c.y - FR) / CELL) | 0, 0, this.rows - 1), fy1 = clamp(((c.y + FR) / CELL) | 0, 0, this.rows - 1);
    for (let gy = fy0; gy <= fy1; gy++) for (let gx = fx0; gx <= fx1; gx++) {
      const fs = this.fGrid[gy * this.cols + gx];
      for (let k = 0; k < fs.length; k++) {
        const f = fs[k];
        const dx = f.x - c.x, dy = f.y - c.y;
        if (Math.abs(dx) > reachF + 10 || Math.abs(dy) > reachF + 10) continue;
        if (f.z > c.z) continue;                     // too high to reach
        const d = Math.sqrt(dx * dx + dy * dy);
        const edible = f.type === 2 ? carnEff : herbEff;
        const r = f.z > 0 ? reachF + 8 : reachF;
        if (d < r && edible > 0.05 && d < nearFoodD) { nearFood = f; nearFoodD = d; }
      }
    }
    if (!c.sick && !c.immune && V.crowd[i] >= 7 && chance(0.00004 * R.disease * V.crowd[i])) c.sick = ri(500, 900);
    c.heard = V.heard[i]; c.crowd = V.crowd[i]; c.hv1 = V.ov1[i]; c.hv2 = V.ov2[i];
    c.builders = Math.min(1, builders / 4); c.family = family;
    c._food = nearFood; c._target = target; c._mate = mate; c._needy = needy; c._partner = partner;
    const fo = target || nearest;
    c.friend = fo && c.rel.size ? (c.rel.get(fo.id) || 0) : 0;
    c.friendHurt = friendHurt;
    // culture: the young copy some of a nearby parent's learned behaviour
    if (R.culture > 0 && c.age < 1500 && (t + c.id) % 90 === 0 && c.parent) {
      const p = this.byId.get(c.parent);
      if (p && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < 70) { this.brain.imitate(c.slot, p.slot, 0.04 * R.culture); c.taught++; }
    }
    this.senseInputs(c);
  }
  senseInputs(c) {
    if (!c.thinks) return;
    const g = c.g, t = this.tick, R = this.rules, V = this.brain.V, i = c.idx;
    const brain = this.brain, s = c.slot, inp = brain.inputs(s), B = MAX_EYES * CH;
    c.heard = V.heard[i]; c.crowd = V.crowd[i]; c.hv1 = V.ov1[i]; c.hv2 = V.ov2[i];
    // walls: one ray down the middle of each eye (C++ filled the other channels)
    const half = g.fov / 2;
    if (this.blockCount > 0) for (let e = 0; e < g.eyes; e++) {
      const a = c.a - half + (e + 0.5) * (g.fov / g.eyes);
      inp[e * CH + 4] = this.wallRay(c, a, Math.min(V.crange[i], 140));
    }
    const dE = (c.energy - c.lastE) / c.maxE;
    c.reward = clamp(dE * 12 + (c.shelter - c.lastShelter) * 1.5 - c.pain * 0.6, -1, 1);
    c.lastE = c.energy; c.lastShelter = c.shelter;
    brain.REWARD[s] = c.reward * R.learnRate;
    let hs = 0, hc = 0;
    if (c.homeX >= 0) { const rel = angleDiff(Math.atan2(c.homeY - c.y, c.homeX - c.x), c.a); hs = Math.sin(rel); hc = Math.cos(rel); }
    inp[B + S.energy] = c.energy / c.maxE;
    inp[B + S.health] = c.hp / c.maxHp;
    inp[B + S.age] = c.age / c.life;
    inp[B + S.clock] = Math.sin(t * 0.05 + c.id);
    inp[B + S.bias] = 1;
    inp[B + S.glow] = c.heard;
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
    inp[B + S.voice1] = c.hv1;
    inp[B + S.voice2] = c.hv2;
    inp[B + S.temp] = clamp((c.temp - 15) / 20, -1.5, 1.5);
    inp[B + S.water] = c.inWater ? 1 : 0;
    inp[B + S.fire] = c.fire;
    inp[B + S.surprise] = brain.DELTA[s];
    inp[B + S.height] = c.z / 4;
    inp[B + S.wallet] = Math.min(1.5, c.wallet / 10);
    inp[B + S.stash] = Math.min(1.5, c.stash / 10);
    inp[B + S.friend] = c.friend;
    inp[B + S.friendHurt] = c.friendHurt;
  }

  act(c) {
    const R = this.rules, g = c.g, out = this.brain.outputs(c.slot), cl = this.climate;
    const target = c._target, nearFood = c._food;
    const herbEff = 1 - g.diet, carnEff = g.diet;

    // ---- movement: thrust against quadratic drag (air, water, or a fish flopping on land) ----
    const tt = this.ttype[this.tAt(c.x, c.y)];
    const water = tt <= 1 && c.z === 0;
    c.inWater = water;
    const hab = g.habitat;
    const thrust = out[OUT.move] > 0 ? out[OUT.move] : out[OUT.move] * 0.35;
    const vAir = (0.55 + g.speed * 0.75) * (1 - g.armor * 0.35) / Math.sqrt(g.size / 2);
    const area = g.size / 2;
    const P = vAir * vAir * AIR_K * area;                         // muscle power that gives vAir on land
    const rho = water ? 5 * (1 - 0.85 * hab) : 1 + Math.max(0, hab - 0.3) * 8.4;
    const K = AIR_K * area * rho;
    c.a += out[OUT.turn] * (water && hab > 0.5 ? 0.2 : 0.16);
    const F = thrust * P;
    c.vx += Math.cos(c.a) * F / c.mass; c.vy += Math.sin(c.a) * F / c.mass;
    const sp = Math.hypot(c.vx, c.vy);
    if (sp > 1e-4) {
      const drag = Math.min(1, (K * sp * sp / c.mass + 0.02 * sp) / sp);
      c.vx -= c.vx * drag; c.vy -= c.vy * drag;
    }
    let nx = c.x + c.vx, ny = c.y + c.vy;
    let h = this.stepTo(c, nx, ny);
    if (h < 0) {
      const hx = this.stepTo(c, nx, c.y), hy = this.stepTo(c, c.x, ny);
      if (hx >= 0) { ny = c.y; c.vy *= -0.2; h = hx; }
      else if (hy >= 0) { nx = c.x; c.vx *= -0.2; h = hy; }
      else { nx = c.x; ny = c.y; c.vx *= -0.3; c.vy *= -0.3; h = c.z; }
    }
    if (h < c.z - 1) { c.hp -= (c.z - h - 1) * 6 * g.size; c.pain = Math.max(c.pain, 0.5); }  // falling hurts
    c.z = h;
    c.x = clamp(nx, 4, this.W - 4); c.y = clamp(ny, 4, this.H - 4);
    if (c.x <= 4 || c.x >= this.W - 4) c.vx = 0;
    if (c.y <= 4 || c.y >= this.H - 4) c.vy = 0;

    // ---- metabolism, climate and habitat stress ----
    const s2 = g.size * g.size;
    const ageF = c.age / c.life;
    let cost = 0.005 * s2
      + 0.007 * Math.abs(thrust) * g.speed * g.speed * s2
      + 0.00006 * g.vision * Math.sqrt(g.eyes) + 0.00002 * g.vision * g.fov
      + 0.0016 * g.hidden * R.brainCost
      + 0.004 * g.armor * s2
      + 0.0015 * g.mouth * g.diet * s2
      + 0.0012 * g.fur * s2;
    // thermal comfort: fur suits cold, bare skin suits heat (shelter and water buffer it)
    const optT = 27 - 30 * g.fur;
    const excess = Math.max(0, Math.abs(c.temp - optT) - 7) * (1 - c.shelter * 0.6);
    const comfort = 1 - Math.min(0.8, c.shelter * 0.35 * R.shelterBonus * (1 + this.cold));
    cost *= R.metabolism * (1 + excess * 0.035 * R.climate) * comfort * (1 + (ageF > 0.75 ? (ageF - 0.75) * 3 * R.agingCost : 0));
    if (water) cost *= 1 + 0.9 * Math.max(0, 0.5 - hab) * 2;      // land animals tire swimming
    else if (hab > 0.5) { cost *= 1 + (hab - 0.5) * 4; if (hab > 0.75) c.hp -= 0.05 * s2; }  // fish gasp on land
    if (c.sick > 0) { cost *= 1.8; c.sick--; if (c.sick === 0) c.immune = true; if (chance(0.02)) this.particles.push({ x: c.x, y: c.y - 4, vx: randn() * 0.2, vy: -0.4, life: 22, hue: 85, s: 1.2 }); }
    c.energy -= cost;
    if (c.fire > 0.5 && c.z === 0) { c.hp -= c.fire * 1.2 * g.size; c.pain = 1; }

    // ---- gather material ----
    if (R.building && c.carry < 1 && !water && hab < 0.6) {
      const rate = tt === 5 ? 0.02 : tt === 2 ? 0.01 : tt === 4 ? 0.0065 : tt === 3 ? 0.003 : 0;
      c.carry = Math.min(1, c.carry + rate * R.gatherRate);
    }
    // ---- build: lay a block ahead, or stack one onto your own wall ----
    if (c.buildCool > 0) c.buildCool--;
    if (R.building && out[OUT.build] > 0.3 && c.carry >= 1 && c.buildCool <= 0 && this.blockCount < 3500) {
      const d = c.radius + BS * 0.9;
      const bx = c.x + Math.cos(c.a) * d, by = c.y + Math.sin(c.a) * d;
      const front = this.bAt(bx, by);
      if (front >= 0 && this.bOwner[front] === c.sp && this.bH[front] < R.maxHeight && this.bH[front] <= c.z + 1) {
        this.placeBlock(c, front, true); c.act.build += 1;                   // build up
        c.energy -= 2.2 * g.size; c.buildCool = 40;
      } else {
        let b = front;
        if (R.stigmergy > 0 && b >= 0) b = this.bestSpot(c, b, R.stigmergy);
        if (b >= 0 && !this.bOwner[b] && !this.isWater((b % this.bw + 0.5) * BS, ((b / this.bw | 0) + 0.5) * BS)) {
          this.placeBlock(c, b, false); c.act.build += 1;
          c.energy -= 1.8 * g.size; c.buildCool = 40;
        } else if (front >= 0 && this.bOwner[front] === c.sp && this.bHp[front] < WALL_MAX_HP * 0.8) {
          this.bHp[front] = Math.min(WALL_MAX_HP, this.bHp[front] + 80); c.carry = 0; c.buildCool = 20; c.lastBuild = this.tick;
        }
      }
    }

    // ---- eat ----
    if (nearFood && nearFood.e > 0) {
      const eff = nearFood.type === 2 ? carnEff * R.carnGain : herbEff * R.herbGain * (nearFood.type === 1 ? 1.15 : 1);
      let bite = Math.min(nearFood.e, 0.9 * g.mouth * g.size, (c.maxE - c.energy) / Math.max(eff, 0.05));
      // full? keep the surplus: a stash of food that can be eaten later or traded
      const cap = 4 + 6 * g.size;
      if (R.economy && bite < 0.3 && c.stash < cap && eff > 0.3 && nearFood.type !== 2) {
        const take = Math.min(nearFood.e, 0.6 * g.mouth * g.size);
        nearFood.e -= take; c.stash = Math.min(cap, c.stash + take * eff / 6); c.act.farm += 0.2; bite = 0;
      }
      if (bite > 0) {
        nearFood.e -= bite; c.energy += bite * eff; c.eatenE += bite * eff;
        if (nearFood.z > 0 && nearFood.e <= 0.4) {
          c.canopyN++;
          const sp = this.species.get(c.sp);
          if (!sp.canopyLogged) { sp.canopyLogged = true; this.log(`${sp.name} climbed up and ate fruit from the treetops`, sp.hue); }
        }
        if (nearFood.type !== 2) c.act.farm += 0.05;
        if (R.seedDispersal && nearFood.type !== 2 && !nearFood.aqua && !c.gut && chance(nearFood.type === 1 ? 0.5 : 0.08)) { c.gut = ri(150, 420); c.gutTree = nearFood.type === 1; }
      }
    }
    if (c.stash > 0 && c.energy < c.maxE * 0.4) { const u = Math.min(c.stash, 0.3); c.stash -= u; c.energy += u * 6; }
    if (R.economy) {
      if (tt === 2 && !water && chance(0.0015 * R.shellRate) && (this.market.money || 0) < 4000) c.wallet += 1;
      c.tradeOut = out[OUT.trade]; c.priceOut = out[OUT.price];
      if (c.tradeOut > 0.2 && c._partner && (this.tick + c.id) % 6 === 0) this.tryTrade(c, c._partner);
    }
    // seeds pass through the gut and sprout wherever the animal wandered
    if (c.gut > 0 && --c.gut === 0 && !water) {
      if (c.gutTree && chance(0.12) && this.trees.length < 90) this.trySapling(c.x, c.y, null);
      else for (let k = 0; k < 3; k++) this.spawnPlant(c.x, c.y, true);
    }
    // ---- attack creatures, or break foreign walls ----
    c.biting = Math.max(0, c.biting - 1);
    if (out[OUT.bite] > 0.25 && c.cool <= 0) {
      if (target && !target.dead) {
        c.cool = 6;
        const atk = target.attackers || (target.attackers = []);
        let k2 = 0; for (let q = 0; q < atk.length; q += 2) if (this.tick - atk[q + 1] < 30 && atk[q] !== c.id) { atk[k2++] = atk[q]; atk[k2++] = atk[q + 1]; }
        atk.length = k2; atk.push(c.id, this.tick);
        const mob = atk.length / 2;
        const pack = 1 + (mob - 1) * 0.5 * R.numbers;
        const sizeF = clamp(Math.pow(g.size / target.g.size, 0.9 * R.sizeMatters), 0.35, 2.6);
        const strength = Math.min(1, 0.4 + (c.energy / c.maxE) * 2.5);
        const height = c.z > target.z ? 1.25 : c.z < target.z ? 0.75 : 1;   // high ground
        if (mob >= 4 && target.g.size > g.size * 1.4 && !target._mobLogged && chance(0.2)) {
          target._mobLogged = true;
          const ts = this.species.get(target.sp), ms = this.species.get(c.sp);
          this.log(`A mob of ${mob} ${ms.name.split(' ')[0]} gangs up on a big ${ts.name}`, ms.hue);
        }
        // social meaning of the bite
        this.feel(target, c, -0.5);
        if (target.attackers && target._victim && c.rel.get(target._victim) > 0.3) {
          c.defends++; c.act.guard += 1; this.social.defends++;
          const v = this.byId.get(target._victim); if (v) this.feel(v, c, 0.4);
          if (!this._defLog || this.tick - this._defLog > 1500) { this._defLog = this.tick; this.log(`A ${this.species.get(c.sp).name.split(' ')[0]} leapt in to defend a friend`, this.species.get(c.sp).hue); }
        }
        c._victim = target.id;
        if (target.sp === c.sp && mob >= 3) {
          target.bullied++; this.social.bullying++;
          if (!this._bullyLog || this.tick - this._bullyLog > 2000) { this._bullyLog = this.tick; this.log(`Bullying: ${mob} ${this.species.get(c.sp).name} gang up on one of their own`, 300); }
        }
        c.act.hunt += target.sp === c.sp ? 0.3 : 1;
        const fortified = 1 - target.shelter * 0.3;
        const dmg = 1.4 * g.mouth * g.size * (0.06 + g.diet * 1.3) * R.attack * (1 - target.g.armor * 0.7) * pack * sizeF * strength * height * (0.6 + out[OUT.bite] * 0.4) * fortified;
        target.hp -= dmg * 3.5;
        const drain = Math.min(target.energy, dmg * 3);
        target.energy -= drain;
        const kin = target.sp === c.sp ? 0.5 : 1;
        c.energy += drain * carnEff * R.carnGain * kin;
        c.energy -= 0.02 * s2;
        target.pain = 1;
        c.biting = 10;
        if (chance(0.5)) this.particles.push({ x: target.x, y: target.y - target.z * 6, vx: randn() * 0.8, vy: randn() * 0.8, life: 18, hue: 0, s: 1.6 });
        if (target.hp <= 0 || target.energy <= 0) { target.dead = true; target.killedBy = c.sp; c.killsN++; this.kills++; }
      } else if (this.blockCount > 0) {
        const d = c.radius + BS * 0.8;
        const b = this.bAt(c.x + Math.cos(c.a) * d, c.y + Math.sin(c.a) * d);
        if (b >= 0 && this.bOwner[b] && this.bOwner[b] !== c.sp && this.bH[b] > c.z) {
          c.cool = 6; c.biting = 10;
          this.bHp[b] -= 3 * g.mouth * g.size * R.attack;
          c.energy -= 0.02 * s2;
          if (chance(0.4)) this.particles.push({ x: c.x + Math.cos(c.a) * d, y: c.y + Math.sin(c.a) * d, vx: randn(), vy: randn(), life: 16, hue: 30, s: 1.4 });
          if (this.bHp[b] <= 0) { this.dropBlock(b, true); c.raidN++; }
        }
      }
    }
    if (c.cool > 0) c.cool--;
    const needy = c._needy;
    if (out[OUT.share] > 0.5 && needy && !needy.dead && c.energy > c.maxE * 0.35) {
      const amt = Math.min(1.2, c.energy * 0.02);
      c.energy -= amt; needy.energy = Math.min(needy.maxE, needy.energy + amt * 0.85);
      c.shared += amt; c.gifts++; c.act.care += 0.5; this.social.gifts++;
      this.feel(needy, c, 0.3); this.feel(c, needy, 0.1);
    }
    c.signal = Math.max(0, out[OUT.signal]);
    c.v1 = out[OUT.voice1]; c.v2 = out[OUT.voice2];
    c.energy -= c.signal * 0.004 + (Math.abs(c.v1) + Math.abs(c.v2)) * 0.0015;

    if (c.energy > c.maxE) c.energy = c.maxE;
    c.pain *= 0.85;
    if (c.hp < c.maxHp && c.energy > c.maxE * 0.25) c.hp = Math.min(c.maxHp, c.hp + 0.03 * s2);

    if (c.age > 300 && c.energy > c.maxE * g.repro && out[OUT.breed] > -0.4 && this.roomFor(g)) {
      const mode = R.reproMode, mate = c._mate;
      if (mode === 0) this.queueBirth(c, null);
      else if (mate && !mate.dead && mate.energy > mate.maxE * 0.35) this.queueBirth(c, mate);
      else if (mode === 2 && chance(R.mateChoice ? 0.1 : 0.2)) this.queueBirth(c, null);
    }
    if (c.energy <= 0 || c.age > c.life || c.hp <= 0) c.dead = true;
  }

  // ---------- society ----------
  feel(c, o, d) {
    if (!o || o.dead || o === c) return;
    const R = this.rules, rel = c.rel;
    const v = clamp((rel.get(o.id) || 0) + d * R.socialMemory, -1, 1);
    rel.set(o.id, v);
    if (rel.size > 8) { let wk = null, wv = 9; for (const [k, x] of rel) if (Math.abs(x) < wv) { wv = Math.abs(x); wk = k; } rel.delete(wk); }
  }
  priceOf(c) { return Math.exp(c.priceOut * 1.4); }   // shells per food unit, 0.25 … 4
  tryTrade(c, o) {
    const M = this.market;
    const needC = 1 - c.energy / c.maxE, needO = 1 - o.energy / o.maxE;
    let buyer = null, seller = null;
    if (needC > needO && o.stash >= 3) { buyer = c; seller = o; }
    else if (needO > needC && c.stash >= 3) { buyer = o; seller = c; }
    if (!buyer) return;
    const ask = this.priceOf(seller), bid = this.priceOf(buyer) * (1 + buyer.g.risk * 0.6) * (0.6 + (1 - buyer.energy / buyer.maxE));
    let kind, qty, price = 0;
    if (buyer.wallet >= 0.25 && bid >= ask) {
      price = (ask + bid) / 2;
      qty = Math.min(seller.stash, 6, Math.floor(buyer.wallet / price));
      if (qty < 1) return;
      buyer.wallet -= qty * price; seller.wallet += qty * price; kind = 'shells';
      M.sumP += price; M.nP++; M.trades++;
    } else if (buyer.carry >= 1 && seller.carry < 1 && seller.g.habitat < 0.6) {
      qty = Math.min(seller.stash, 5); buyer.carry = 0; seller.carry = 1; kind = 'barter'; M.barters++;
    } else return;
    seller.stash -= qty;
    const food = qty * 6;
    const room = buyer.maxE - buyer.energy, eat = Math.min(room, food);
    buyer.energy += eat; buyer.stash += (food - eat) / 6;
    buyer.tradesN++; seller.tradesN++; buyer.act.trade += 2; seller.act.trade += 2;
    this.feel(buyer, seller, 0.08); this.feel(seller, buyer, 0.08);
    M.volNow += qty;
    M.feed.unshift({ t: this.tick, b: buyer.id, s: seller.id, bs: buyer.sp, ss: seller.sp, qty, price, kind });
    if (M.feed.length > 40) M.feed.pop();
    if (!this._firstTrade) { this._firstTrade = true; const sp = this.species.get(seller.sp); this.log(`First trade! A ${sp.name} sold food for ${kind === 'shells' ? 'shells — money is born' : 'building stone'}`, 50); }
  }
  marketTick() {
    const M = this.market, cr = this.creatures;
    const avg = M.nP ? M.sumP / M.nP : M.cur;
    M.cur = M.cur * 0.7 + avg * 0.3;
    // wealth: wallets plus stashes valued at today's food price
    let money = 0; const wealth = [];
    const bySp = new Map();
    for (const c of cr) {
      const w = c.wallet + c.stash * M.cur;
      money += c.wallet; wealth.push(w);
      bySp.set(c.sp, (bySp.get(c.sp) || 0) + w);
    }
    wealth.sort((a, b) => a - b);
    let cum = 0, sum = 0; for (let i = 0; i < wealth.length; i++) { cum += (i + 1) * wealth[i]; sum += wealth[i]; }
    const gini = sum > 0 ? (2 * cum) / (wealth.length * sum) - (wealth.length + 1) / wealth.length : 0;
    M.prices.push({ t: this.tick, p: M.cur, vol: M.volNow, n: M.nP, money, gini });
    if (M.prices.length > 400) M.prices.shift();
    for (const [id, v] of bySp) { const h = M.index.get(id) || []; h.push(v); if (h.length > 120) h.shift(); M.index.set(id, h); }
    for (const id of M.index.keys()) if (!bySp.has(id)) M.index.delete(id);
    M.money = money; M.gini = gini; M.volNow = 0; M.sumP = 0; M.nP = 0;
    // jobs: what each creature has mostly been doing lately
    const roles = { farmer: 0, builder: 0, hunter: 0, trader: 0, caretaker: 0, guard: 0, idle: 0 };
    for (const c of cr) {
      const a = c.act; let best = 'idle', bv = 0.5;
      for (const [k, r] of [['farm', 'farmer'], ['build', 'builder'], ['hunt', 'hunter'], ['trade', 'trader'], ['care', 'caretaker'], ['guard', 'guard']]) if (a[k] > bv) { bv = a[k]; best = r; }
      c.role = best; roles[best]++;
      for (const k in a) a[k] *= 0.6;
    }
    this.social.roles = roles;
  }
  roomFor(g) {
    const R = this.rules, q = this._births ? this._births.length : 0;
    if (this.creatures.length + q >= 1580) return false;
    return g.habitat > 0.6 ? this.nAqua < R.maxFish : this.creatures.length - this.nAqua + q < R.maxPop;
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
    if (mate) {
      mateGive = mate.energy * 0.25; mate.energy -= mateGive; mate.children++;
      const before = p.rel.get(mate.id) || 0;
      this.feel(p, mate, 0.5); this.feel(mate, p, 0.5);
      if (before > 0.8 && !p.bond) { p.bond = mate.id; mate.bond = p.id; this.social.bonds++;
        if (!this._bondLog || this.tick - this._bondLog > 2500) { this._bondLog = this.tick; this.log(`Life partners: two ${this.species.get(p.sp).name} keep raising young together`, 330); } }
    }
    const nursery = 1 + p.shelter * 0.3 * R.shelterBonus;
    const each = (budget + mateGive) * 0.85 * nursery / n;
    const sp = this.species.get(p.sp);
    let base = p.g;
    if (R.lamarck) base = { ...p.g, w: Float32Array.from(this.brain.weights(p.slot)) };
    for (let i = 0; i < n; i++) {
      if (!this.roomFor(p.g)) break;
      const g = reproduce(base, mate ? mate.g : null, R.mutRate, R.mutAmt, R.neurogenesis);
      // hybrid inviability: the more the parents' genes differ, the less likely the young survive
      if (mate) {
        const dd = distance(p.g, mate.g);
        if (!chance(Math.exp(-Math.pow(dd / (R.speciesGap * 2.4), 2)))) continue;
      }
      let csp = sp;
      if (mate && mate.sp !== p.sp) {
        // a hybrid belongs to whichever parent species it is closer to
        const msp = this.species.get(mate.sp);
        if (msp && distance(g, msp.rep) < distance(g, sp.rep)) csp = msp;
        if (!this._hybridLog || this.tick - this._hybridLog > 2500) { this._hybridLog = this.tick; this.log(`A hybrid is born: ${sp.name} × ${msp ? msp.name : '?'}`, (sp.hue + (msp ? msp.hue : 0)) / 2); }
      }
      if (distance(g, csp.rep) > R.speciesGap * 2.6) csp = this.newSpecies(g, csp);
      let x = p.x + randn() * 6, y = p.y + randn() * 6;
      if (g.habitat > 0.75 && !this.isWater(x, y)) { x = p.x; y = p.y; }
      const ch = this.spawn(g, x, y, csp, p.gen + 1, p, Math.min(each, 70 * g.size * g.size));
      if (!ch) break;
      ch.a = p.a + randn(); ch.z = Math.min(ch.z, p.z);
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
      if (sp.blocks > 0) { for (let b = 0; b < this.bOwner.length; b++) if (this.bOwner[b] === sp.id) this.bOwner[b] = -1; sp.blocks = 0; this.structVersion++; this.wallsAllDirty = true; }
    }
    this.deaths++;
    const meat = 18 * c.g.size * c.g.size + Math.max(0, c.energy) * 0.4;
    const chunks = Math.max(1, Math.round(c.g.size));
    for (let i = 0; i < chunks; i++) this.addFood(c.x + randn() * 3, c.y + randn() * 3, 2, meat / chunks);
    if (this.rules.inheritance && (c.wallet > 0.5 || c.stash > 0.5)) {
      let heir = null;
      for (const o of this.creatures) if (!o.dead && o.parent === c.id) { heir = o; break; }
      if (!heir) for (const o of this.creatures) if (!o.dead && o.sp === c.sp && Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < 80) { heir = o; break; }
      if (heir) { heir.wallet += c.wallet; heir.stash += c.stash; }
    }
    this.brain.release(c.slot);
    this.byId.delete(c.id);
    c.slot = -1;
  }

  // A creature's "fitness" for survival of the smartest: mind plus deeds.
  score(c) {
    const ageN = Math.max(300, c.age);
    return c.brain.iq / 60
      + (c.eatenE / ageN) * 8
      + c.children * 0.25 + c.killsN * 0.15 + c.builtN * 0.04 + c.canopyN * 0.5
      + Math.min(1, c.age / 3000) * 0.6
      + this.brain.drift(c.slot, c.g) * 2
      + (c.energy / c.maxE) * 0.3;
  }
  purge() {
    const R = this.rules, bySp = new Map();
    for (const c of this.creatures) { if (c.age < 400) continue; (bySp.get(c.sp) || bySp.set(c.sp, []).get(c.sp)).push(c); }
    let removed = 0, boosted = 0;
    for (const list of bySp.values()) {
      if (list.length < 6) continue;
      for (const c of list) c._score = this.score(c);
      list.sort((a, b) => a._score - b._score);
      const cut = Math.floor(list.length * R.selectHarsh);
      for (let i = 0; i < cut; i++) { list[i].dead = true; list[i].purged = true; removed++; }
      // the best get a feast so they breed sooner
      const top = Math.max(1, Math.floor(list.length * R.selectHarsh));
      for (let i = list.length - top; i < list.length; i++) { const c = list[i]; c.energy = Math.min(c.maxE, c.energy + c.maxE * 0.4); boosted++; }
    }
    if (removed) { this.purged += removed; this.log(`Survival of the smartest: ${removed} weakest purged, ${boosted} brightest fed to breed`, 280); }
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
    const avg = { diet: 0, size: 0, speed: 0, eyes: 0, vision: 0, hidden: 0, iq: 0, armor: 0, mutRate: 0, plastic: 0, fov: 0, shelter: 0, builders: 0, learned: 0, fur: 0, habitat: 0, choosy: 0, curiosity: 0, height: 0, voice: 0 };
    const counts = {};
    let sampled = 0;
    const calls = new Map();
    for (const c of cr) {
      const g = c.g;
      avg.diet += g.diet; avg.size += g.size; avg.speed += g.speed; avg.eyes += g.eyes; avg.vision += g.vision; avg.hidden += g.hidden;
      avg.armor += g.armor; avg.mutRate += g.mutRate; avg.plastic += g.plastic; avg.fov += g.fov; avg.fur += g.fur; avg.habitat += g.habitat;
      avg.choosy += g.choosy; avg.curiosity += g.curiosity;
      avg.iq += c.brain.iq; avg.shelter += c.shelter; avg.builders += this.tick - c.lastBuild < 1500 ? 1 : 0; avg.height += c.z;
      avg.voice += Math.abs(c.v1) + Math.abs(c.v2) > 0.6 ? 1 : 0;
      if (sampled < 60 && chance(0.25)) { avg.learned += this.brain.drift(c.slot, g); sampled++; }
      counts[c.sp] = (counts[c.sp] || 0) + 1;
      // what do calls mean? compare voices when danger is in sight vs not
      if (c.thinks !== undefined && c.slot >= 0) {
        const inp = this.brain.inputs(c.slot);
        let threat = 0, food = 0;
        for (let e = 0; e < g.eyes; e++) { threat = Math.max(threat, inp[e * CH + 2]); food = Math.max(food, inp[e * CH + 0] + inp[e * CH + 1]); }
        let st = calls.get(c.sp); if (!st) { st = { dn: 0, dv: 0, sn: 0, sv: 0, fn: 0, fv: 0 }; calls.set(c.sp, st); }
        const v = c.v1;
        if (threat > 0.25) { st.dn++; st.dv += v; } else { st.sn++; st.sv += v; }
        if (food > 0.5) { st.fn++; st.fv += c.v2; } else { st.fv -= 0; }
      }
    }
    for (const k in avg) avg[k] /= k === 'learned' ? Math.max(1, sampled) : n;
    // detect emergent alarm calls: voice-1 used differently when danger is near
    for (const [id, st] of calls) {
      const sp = this.species.get(id); if (!sp) continue;
      const acc = sp.calls || (sp.calls = { dn: 0, dv: 0, sn: 0, sv: 0 });
      acc.dn = acc.dn * 0.97 + st.dn; acc.dv = acc.dv * 0.97 + st.dv; acc.sn = acc.sn * 0.97 + st.sn; acc.sv = acc.sv * 0.97 + st.sv;
      if (acc.dn > 12 && acc.sn > 12) {
        const diff = acc.dv / acc.dn - acc.sv / acc.sn;
        sp.alarm = diff;
        if (Math.abs(diff) > 0.45 && !sp.alarmLogged && sp.count > 8) { sp.alarmLogged = true; this.log(`${sp.name} has evolved an alarm call — they cry out when danger is near`, sp.hue); }
      }
      const avgHab = sp.rep.habitat;
      if (!sp.amphibLogged && sp.count >= 8 && avgHab > 0.3 && avgHab < 0.7) { sp.amphibLogged = true; this.log(`Amphibians! ${sp.name} live both in the water and on land`, sp.hue); }
    }
    let herb = 0, carn = 0, omni = 0, fish = 0;
    for (const c of cr) { if (c.g.habitat > 0.6) fish++; if (c.g.diet < 0.35) herb++; else if (c.g.diet > 0.65) carn++; else omni++; }
    // herb/carn counts are land-only so fish don't hide a missing land food web
    let lh = 0, lc = 0; for (const c of cr) if (c.g.habitat <= 0.6) { if (c.g.diet < 0.35) lh++; else if (c.g.diet > 0.65) lc++; }
    this.history.push({ t: this.tick, pop: cr.length, plants: this.landPlants, counts, avg, herb: lh, carn: lc, omni, fish, groups: this.groups.length, walls: this.blockCount, moist: this.climate.landMoist });
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
      const b = Y * this.bw + X; while (this.bH[b] > 0) this.dropBlock(b, true);
    }
    this.climate.ignite(x, y);
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
    this.food = this.food.filter((f) => f.type !== 0 || f.aqua || chance(0.3));
    for (const c of this.creatures) c.energy -= c.maxE * 0.25 * (1 - c.shelter) * (1 - c.g.fur * 0.7);
    this.log('A bitter cold snap! Only the furry and the sheltered stay warm.', 210);
  }
  storm() { this.climate.storm(); this.log('Storm clouds gather…', 220); }
  drought() { this.climate.drought(); this.log('A drought begins', 40); }
  dropFood(x, y) {
    for (let i = 0; i < 14; i++) this.addFood(x + randn() * 18, y + randn() * 18, 1, 40);
  }
  spawnAt(x, y, g) {
    const sp = g && this.species.get(g._sp) && this.species.get(g._sp).count > 0 ? this.species.get(g._sp) : null;
    if (g) {
      const s = sp || this.newSpecies(g, null);
      for (let i = 0; i < 6; i++) this.spawn(mutate(g, 0.5, 0.5), x + randn() * 12, y + randn() * 12, s, 0, null);
    } else {
      const water = this.isWater(x, y);
      const s = this.newSpecies(randomGenome(water ? { habitat: rr(0.85, 1), hue: rr(180, 240) } : {}), null);
      for (let i = 0; i < 8; i++) this.spawn(mutate(s.rep, 0.5, 0.5), x + randn() * (water ? 5 : 14), y + randn() * (water ? 5 : 14), s, 0, null);
      this.log(`${s.name} ${water ? 'released into the water' : 'introduced'} by a god`, s.hue);
    }
  }
  nearestCreature(x, y, maxD) {
    let best = null, bd = maxD;
    for (const c of this.creatures) { const d = Math.hypot(c.x - x, c.y - (y + c.z * 6)) - c.radius; if (d < bd) { bd = d; best = c; } }
    return best;
  }
}
