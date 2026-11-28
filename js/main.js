// Wires the world, renderer and UI together.
import { World, RULES, defaultRules } from './world.js?v=6f9903a0547';
import { Renderer, drawPortrait } from './render.js?v=6f9903a0547';
import { GENES, INT_GENES, N_IN, N_OUT, H_MAX, MAX_EYES, CH, CH_NAMES, O_IH, O_HO, OUT_NAMES, SENSE_NAMES, OUT, TRAITS, LOCI, serializeGenome, deserializeGenome, heterozygosity } from './genome.js?v=6f9903a0547';
import { createBrain } from './brain.js?v=6f9903a0547';
import { setSeed, hsl, clamp } from './util.js?v=6f9903a0547';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SIZES = { s: [1600, 1100], m: [2400, 1600], l: [3400, 2200] };
const SPEEDS = [0.5, 1, 2, 4, 8, 16];

const state = {
  world: null, renderer: null, running: true, speedIdx: 1, tool: 'inspect',
  selected: null, follow: false, frame: 0, rules: loadRules(), cloneGenome: null,
};

function loadRules() {
  const r = defaultRules();
  try { Object.assign(r, JSON.parse(localStorage.getItem('primordia.v3.rules') || '{}')); } catch {}
  for (const k in r) if (!(k in RULES)) delete r[k];
  return r;
}
function saveRules() { try { localStorage.setItem('primordia.v3.rules', JSON.stringify(state.rules)); } catch {} }

// ---------- world lifecycle ----------
function newWorld(seed, sizeKey = 'm', founders = 6) {
  seed = seed ?? ((Math.random() * 1e9) | 0);
  setSeed(seed);
  const [W, H] = SIZES[sizeKey] || SIZES.m;
  if (state.world) for (const c of state.world.creatures) state.brain.release(c.slot);
  const w = new World({ W, H, seed, rules: state.rules, brain: state.brain });
  w.populate(founders, sizeKey === 's' ? 16 : sizeKey === 'l' ? 28 : 22);
  w.log(`A new world is born (seed ${seed}). ${founders} founding species arrive.`, 140);
  state.world = w;
  state.selected = null; state.follow = false;
  if (state.renderer) state.renderer.setWorld(w); else state.renderer = new Renderer($('#world'), w);
  $('#seedIn').value = seed;
  showInspector(null);
}

// ---------- main loop ----------
let acc = 0, last = performance.now();
function loop(now) {
  const dt = Math.min(100, now - last); last = now;
  const w = state.world;
  if (state.running) {
    acc += SPEEDS[state.speedIdx] * dt / 16.67;
    const t0 = performance.now();
    let n = 0;
    // give the simulation at most ~9 ms per frame so drawing stays smooth;
    // if it can't keep up, the world simply runs a little slower than asked
    while (acc >= 1) {
      w.step(); acc -= 1; n++;
      if (performance.now() - t0 > 9) { acc = 0; break; }
    }
    state.stepsDone = (state.stepsDone || 0) + n;
  }
  if (now - (state.speedT || 0) > 1000) {
    const real = (state.stepsDone || 0) / ((now - (state.speedT || now - 1000)) / 1000) / 60;
    state.realSpeed = real; state.stepsDone = 0; state.speedT = now;
    const want = SPEEDS[state.speedIdx];
    $('#btnSpeed').title = `Simulation speed — asked ${want}×, actually running ${real.toFixed(1)}×`;
    $('#btnSpeed').classList.toggle('lag', state.running && real < want * 0.8);
  }
  const sel = state.selected;
  if (sel && sel.dead) {
    // follow the line: jump to a living child if possible
    const kid = w.creatures.find((c) => c.parent === sel.id) || null;
    toast(kid ? 'It died — following one of its children.' : 'It died. Its body feeds others now.');
    selectCreature(kid);
  }
  if (state.follow && state.selected) {
    const c = state.renderer.cam;
    // on phones the bottom sheet covers part of the map: keep the creature in the visible part
    const sheet = window.innerWidth <= 820 && !document.body.classList.contains('panel-hidden') ? $('#panel').offsetHeight : 0;
    const ty = state.selected.y + (sheet / 2) / c.zoom;
    c.x += (state.selected.x - c.x) * 0.15; c.y += (ty - c.y) * 0.15;
    state.renderer.clampCam();
  }
  state.frame++;
  state.renderer.draw(state.frame, state.selected);
  if (state.frame % 15 === 0) updateHUD();
  if (state.frame % 10 === 0 && state.selected) updateInspector();
  if (state.frame % 45 === 0) updatePanels();
  requestAnimationFrame(loop);
}

// ---------- HUD ----------
function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)); }
function updateHUD() {
  const w = state.world;
  const day = Math.floor(w.tick / w.rules.dayLength) + 1;
  const living = [...w.species.values()].filter((s) => s.count > 0).length;
  const iq = w.history.length ? w.history[w.history.length - 1].avg.iq : 0;
  const season = !w.rules.seasons ? '' : w.season > 1.35 ? 'summer' : w.season > 1 ? 'spring' : w.season > 0.65 ? 'autumn' : 'winter';
  const time = w.light > 0.8 ? '☀' : w.light < 0.45 ? '☾' : '◐';
  $('#chips').innerHTML = [
    `<span class="chip"><span class="k">${time} Day</span><b>${day}</b>${season ? `<span class="k">${season}</span>` : ''}</span>`,
    `<span class="chip"><span class="dot" style="background:#8fe3b8"></span><span class="k">Life</span><b>${w.creatures.length}</b></span>`,
    `<span class="chip"><span class="k">Species</span><b>${living}</b></span>`,
    `<span class="chip opt"><span class="k">Gen</span><b>${w.maxGen}</b></span>`,
    `<span class="chip"><span class="k">${{ clear: '☀', showers: '🌦', rain: '🌧', storm: '⛈', drought: '🏜', wildfire: '🔥' }[w.climate.state] || '☀'} ${w.climate.state}</span><b>${w.climate.temp(state.renderer.cam.x, state.renderer.cam.y).toFixed(0)}°C</b></span>`,
    `<span class="chip"><span class="k">▦ Blocks</span><b>${fmt(w.blockCount)}</b></span>`,
    w.nAqua ? `<span class="chip opt"><span class="k">🐟</span><b>${w.nAqua}</b></span>` : '',
    w.rules.smartSelect ? `<span class="chip opt"><span class="k">🧠 purged</span><b>${fmt(w.purged)}</b></span>` : '',
    `<span class="chip opt"><span class="k">Groups</span><b>${w.groups.length}</b></span>`,
    w.sickCount > 5 ? `<span class="chip opt"><span class="dot" style="background:#b6dc3c"></span><span class="k">Sick</span><b>${w.sickCount}</b></span>` : '',
    `<span class="chip opt"><span class="k">IQ</span><b>${iq.toFixed(0)}</b></span>`,
    state.brain.cortexOn ? `<span class="chip opt"><span class="k">🧠 cortex designs</span><b>${state.brain.designs.size}</b></span>` : '',
    `<span class="chip opt"><span class="k">Plants</span><b>${fmt(w.food.length)}</b></span>`,
  ].join('');
}

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- charts ----------
function sizeCanvas(cv) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (!cv.dataset.h) cv.dataset.h = cv.getAttribute('height');
  const w = cv.clientWidth, h = +cv.dataset.h;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, w, h];
}
function topSpecies(n) {
  return [...state.world.species.values()].filter((s) => s.count > 0).sort((a, b) => b.count - a.count).slice(0, n);
}
function drawPopChart() {
  const cv = $('#popChart'); if (!cv.clientWidth) return;
  const [c, W, H] = sizeCanvas(cv);
  const hist = state.world.history; c.clearRect(0, 0, W, H);
  if (hist.length < 2) return;
  const maxP = Math.max(10, ...hist.map((h) => h.pop)) * 1.1;
  const maxPl = Math.max(10, ...hist.map((h) => h.plants)) * 1.1;
  const n = hist.length, xs = (i) => (i / (n - 1)) * W;
  // plants line
  c.strokeStyle = 'rgba(143,227,184,0.35)'; c.lineWidth = 1; c.beginPath();
  hist.forEach((h, i) => { const y = H - (h.plants / maxPl) * H; i ? c.lineTo(xs(i), y) : c.moveTo(xs(i), y); }); c.stroke();
  // stacked species: herbivores / omnivores / carnivores per species colour
  const ids = new Set(); for (const h of hist) for (const k in h.counts) ids.add(+k);
  const sp = state.world.species;
  const order = [...ids].sort((a, b) => (sp.get(a).diet - sp.get(b).diet));
  const base = new Float32Array(n);
  for (const id of order) {
    const s = sp.get(id);
    c.fillStyle = hsl(s.hue, 0.65, 0.6, 0.85);
    c.beginPath();
    for (let i = 0; i < n; i++) { const v = hist[i].counts[id] || 0; c.lineTo(xs(i), H - ((base[i] + v) / maxP) * H); }
    for (let i = n - 1; i >= 0; i--) c.lineTo(xs(i), H - (base[i] / maxP) * H);
    c.closePath(); c.fill();
    for (let i = 0; i < n; i++) base[i] += hist[i].counts[id] || 0;
  }
  const h = hist[n - 1];
  $('#popLegend').innerHTML = `<span><i style="background:#8fe3b8"></i>${h.herb} grazers</span><span><i style="background:#ff8a8a"></i>${h.carn} hunters</span><span><i style="background:#7fb8ff"></i>${h.fish || 0} aquatic</span>`;
}
function drawTraitChart() {
  const cv = $('#traitChart'); if (!cv.clientWidth) return;
  const [c, W, H] = sizeCanvas(cv);
  const hist = state.world.history; c.clearRect(0, 0, W, H);
  if (hist.length < 2) return;
  const key = $('#traitSel').value;
  const vals = hist.map((h) => h.avg[key]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const n = vals.length;
  const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,199,138,0.35)'); gr.addColorStop(1, 'rgba(255,199,138,0)');
  c.beginPath();
  vals.forEach((v, i) => { const x = (i / (n - 1)) * W, y = H - ((v - lo) / (hi - lo)) * (H - 14) - 4; i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.lineWidth = 2; c.strokeStyle = '#ffc78a'; c.stroke();
  c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fillStyle = gr; c.fill();
  c.fillStyle = '#9fb3a9'; c.font = '11px JetBrains Mono, monospace';
  const f = (v) => (Math.abs(v) < 2 ? v.toFixed(2) : v.toFixed(0));
  c.fillText(`now ${f(vals[n - 1])}`, 6, 14);
  c.textAlign = 'right'; c.fillText(`start ${f(vals[0])}`, W - 6, 14); c.textAlign = 'left';
}
function drawPhylo() {
  const cv = $('#phyloChart'); if (!cv.clientWidth) return;
  const [c, W, H] = sizeCanvas(cv);
  const w = state.world; c.clearRect(0, 0, W, H);
  const all = [...w.species.values()].filter((s) => s.peak >= 3 || s.count > 0);
  if (!all.length) return;
  const t0 = Math.min(...all.map((s) => s.born)), t1 = Math.max(w.tick, t0 + 1);
  // order by DFS so children sit near parents
  const kids = new Map(); const roots = [];
  for (const s of all) { const p = s.parent && w.species.get(s.parent); if (p && all.includes(p)) { (kids.get(p.id) || kids.set(p.id, []).get(p.id)).push(s); } else roots.push(s); }
  const order = [];
  const visit = (s) => { order.push(s); for (const k of kids.get(s.id) || []) visit(k); };
  roots.forEach(visit);
  const rowH = Math.min(10, (H - 8) / order.length);
  const ypos = new Map(); order.forEach((s, i) => ypos.set(s.id, 4 + i * rowH + rowH / 2));
  const X = (t) => 6 + ((t - t0) / (t1 - t0)) * (W - 12);
  for (const s of order) {
    const y = ypos.get(s.id), x0 = X(s.born), x1 = X(s.extinct ?? w.tick);
    const alive = s.count > 0;
    c.strokeStyle = hsl(s.hue, 0.6, alive ? 0.65 : 0.4, alive ? 1 : 0.5);
    c.lineWidth = Math.max(1, Math.min(rowH * 0.8, 1 + Math.sqrt(s.peak) * 0.4));
    c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    const p = s.parent && ypos.get(s.parent);
    if (p !== undefined && p !== null && p !== 0) { c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.moveTo(x0, p); c.lineTo(x0, y); c.stroke(); }
    if (alive) { c.fillStyle = hsl(s.hue, 0.7, 0.7); c.beginPath(); c.arc(x1, y, Math.min(3, rowH / 2 + 0.5), 0, Math.PI * 2); c.fill(); }
  }
  const total = w.species.size, alive = all.filter((s) => s.count > 0).length;
  $('#treeInfo').textContent = `${total} ever · ${alive} alive`;
}

// ---------- species list ----------
const portraitCache = new Map();
function dietBadge(d) { return d < 0.35 ? '<span class="badge herb">grazer</span>' : d > 0.65 ? '<span class="badge carn">hunter</span>' : '<span class="badge omni">omnivore</span>'; }
function updateSpeciesList() {
  const w = state.world;
  const list = topSpecies(14);
  const ul = $('#speciesList');
  const maxC = Math.max(1, ...list.map((s) => s.count));
  const stats = new Map();
  for (const c of w.creatures) {
    let s = stats.get(c.sp); if (!s) { s = { iq: 0, gen: 0, n: 0 }; stats.set(c.sp, s); }
    s.iq += c.brain.iq; s.gen = Math.max(s.gen, c.gen); s.n++;
  }
  ul.innerHTML = '';
  for (const s of list) {
    const st = stats.get(s.id) || { iq: 0, n: 1, gen: 0 };
    const li = document.createElement('li');
    let pc = portraitCache.get(s.id);
    if (!pc || pc.g !== s.rep) { pc = { g: s.rep, cv: document.createElement('canvas') }; pc.cv.width = pc.cv.height = 18; drawPortrait(pc.cv, s.rep); portraitCache.set(s.id, pc); }
    const cv = pc.cv;
    li.appendChild(cv);
    const parent = s.parent ? w.species.get(s.parent) : null;
    li.insertAdjacentHTML('beforeend', `<div><div class="nm">${s.name}</div><div class="meta">${dietBadge(s.rep.diet)}<span>IQ ${(st.iq / st.n).toFixed(0)}</span>${s.blocks > 0 ? `<span>▦ ${s.blocks}</span>` : ''}<span>gen ${st.gen}</span>${parent ? `<span>from ${parent.genus === s.genus ? parent.name.split(' ')[1] : parent.name}</span>` : '<span>founder</span>'}</div><div class="bar" style="width:${(s.count / maxC) * 100}%;background:${hsl(s.hue, 0.65, 0.6)}"></div></div><div class="cnt">${s.count}</div>`);
    li.onclick = () => {
      const members = w.creatures.filter((c) => c.sp === s.id);
      if (members.length) { selectCreature(members[(Math.random() * members.length) | 0]); state.follow = true; setFollowBtn(); }
    };
    ul.appendChild(li);
  }
  $('#spCount').textContent = `${[...w.species.values()].filter((s) => s.count > 0).length} alive`;
}
function updateEvents() {
  const ul = $('#events'), w = state.world;
  ul.innerHTML = w.events.map((e) => `<li style="--c:${hsl(e.hue, 0.7, 0.65)}"><span class="t">day ${Math.floor(e.t / w.rules.dayLength) + 1}</span>${e.msg}</li>`).join('');
}
// ---------- market ----------
function spark(vals, w = 56, h = 16) {
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals) || 1, r = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - lo) / r) * h}`).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${up ? '#8fe3b8' : '#ff8a8a'}" stroke-width="1.5" points="${pts}"/></svg>`;
}
function updateMarket() {
  const w = state.world, M = w.market, P = M.prices;
  const cv = $('#priceChart');
  if (cv.clientWidth) {
    const [c, W, H] = sizeCanvas(cv); c.clearRect(0, 0, W, H);
    if (P.length > 1) {
      const maxV = Math.max(1, ...P.map((p) => p.vol));
      P.forEach((p, i) => { const x = (i / (P.length - 1)) * W, bh = (p.vol / maxV) * H * 0.35; c.fillStyle = 'rgba(159,183,255,0.35)'; c.fillRect(x - 1, H - bh, 2, bh); });
      const lo = Math.min(...P.map((p) => p.p)), hi = Math.max(...P.map((p) => p.p)), r = hi - lo || 1;
      c.beginPath(); P.forEach((p, i) => { const x = (i / (P.length - 1)) * W, y = 8 + (1 - (p.p - lo) / r) * (H * 0.6); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.strokeStyle = '#ffc78a'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#9fb3a9'; c.font = '11px JetBrains Mono, monospace'; c.fillText(`${hi.toFixed(2)}`, 4, 12); c.fillText(`${lo.toFixed(2)}`, 4, H * 0.6 + 8);
    } else { c.fillStyle = '#9fb3a9'; c.font = '12px Space Grotesk'; c.fillText('No trades yet — money is waiting to be invented.', 8, 24); }
  }
  const last = P[P.length - 1] || { p: M.cur, money: 0, gini: 0 };
  $('#mkPrice').textContent = `${M.cur.toFixed(2)} shells / food`;
  const k = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  $('#mkKpis').innerHTML = k(fmt(M.money || 0), 'money supply') + k(M.trades, 'cash trades') + k(M.barters, 'barters') + k((M.gini || 0).toFixed(2), 'inequality (Gini)');
  const idx = [...M.index.entries()].map(([id, h]) => ({ sp: w.species.get(id), h })).filter((x) => x.sp && x.sp.count > 0).sort((a, b) => b.h[b.h.length - 1] - a.h[a.h.length - 1]).slice(0, 8);
  $('#mkIndex').innerHTML = idx.map(({ sp, h }) => {
    const now = h[h.length - 1], then = h[Math.max(0, h.length - 20)] || now, ch = then ? ((now - then) / then) * 100 : 0;
    return `<li><span class="nm" style="color:${hsl(sp.hue, 0.6, 0.72)}">${sp.name}</span><span class="v">${fmt(now)}</span><span class="v ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'}${Math.abs(ch).toFixed(1)}%</span>${spark(h.slice(-40))}</li>`;
  }).join('') || '<li class="muted">No wealth yet.</li>';
  $('#mkCount').textContent = `${M.trades + M.barters} total`;
  const nm = (sp) => { const s2 = w.species.get(sp); return s2 ? s2.name.split(' ')[0] : '?'; };
  $('#mkFeed').innerHTML = M.feed.slice(0, 14).map((f) => `<li data-id="${f.b}"><span class="t">day ${Math.floor(f.t / w.rules.dayLength) + 1}</span><span>#${f.s} <i>${nm(f.ss)}</i> sold ${(+f.qty).toFixed(1)} food to #${f.b} <i>${nm(f.bs)}</i> ${f.kind === 'shells' ? `for <b>${(f.qty * f.price).toFixed(1)}</b> shells (${f.price.toFixed(2)} each)` : 'for a block of stone (barter)'}</span></li>`).join('') || '<li class="muted">Waiting for the first deal…</li>';
  const rich = [...w.creatures].sort((a, b) => (b.wallet + b.stash * M.cur) - (a.wallet + a.stash * M.cur)).slice(0, 6);
  $('#mkRich').innerHTML = rich.map((c) => `<li data-id="${c.id}"><span class="t">#${c.id}</span><span><i>${w.species.get(c.sp).name}</i> · ${c.wallet.toFixed(1)} shells · ${c.stash.toFixed(1)} food · ${c.role} · risk ${(c.g.risk * 100).toFixed(0)}%</span></li>`).join('');
  for (const ul of ['#mkFeed', '#mkRich']) $(ul).querySelectorAll('li[data-id]').forEach((li) => li.onclick = () => { const c = w.byId.get(+li.dataset.id); if (c) { selectCreature(c); state.follow = true; setFollowBtn(); } });
  const R2 = w.social.roles || {}, tot = Object.values(R2).reduce((a, b) => a + b, 0) || 1;
  $('#mkRoles').innerHTML = Object.entries(R2).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<div class="role"><span>${r}</span><div class="track"><i style="width:${(n / tot) * 100}%"></i></div><span class="muted">${n}</span></div>`).join('');
  const S2 = w.social;
  $('#mkSocial').innerHTML = k(fmt(S2.gifts), 'gifts of food') + k(fmt(S2.defends), 'friends defended') + k(fmt(S2.bullying), 'bullying bites') + k(S2.bonds, 'life partners');
}
function updatePanels() {
  const tab = $('.tab.active').dataset.tab;
  if (document.body.classList.contains('panel-hidden')) return;
  if (tab === 'life') { drawPopChart(); drawTraitChart(); drawPhylo(); updateSpeciesList(); }
  if (tab === 'story') updateEvents();
  if (tab === 'market') updateMarket();
}

// ---------- inspector ----------
function selectCreature(c) {
  state.selected = c; state.world.selected = c;
  if (!c) { state.follow = false; showInspector(null); return; }
  showInspector(c);
}
function showInspector(c) {
  $('#inspect').hidden = !c; $('#inspectEmpty').hidden = !!c;
  if (!c) return;
  drawPortrait($('#portrait'), c.g);
  const genes = [];
  for (const k in GENES) {
    if (k === 'hue' || k === 'hue2' || k === 'pref') continue;
    const d = GENES[k], v = c.g[k];
    const shown = k === 'lifespan' || k === 'vision' ? v.toFixed(0) : k === 'fov' ? (v * 57.3).toFixed(0) + '°' : v.toFixed(2);
    genes.push(`<div class="gene"><div class="gk">${d.label}<b>${shown}</b></div><div class="gt"><i style="width:${((v - d.min) / (d.max - d.min)) * 100}%"></i></div></div>`);
  }
  for (const k in INT_GENES) {
    const d = INT_GENES[k], v = c.g[k];
    genes.push(`<div class="gene"><div class="gk">${d.label}<b>${v}</b></div><div class="gt"><i style="width:${((v - d.min) / (d.max - d.min)) * 100}%"></i></div></div>`);
  }
  // chromosomes: each square is one allele (gene copy), coloured by its value; top strand = mother's copy, bottom = father's
  const dna = c.g.dna, strand = (arr) => Array.from(arr, (v, i) => `<i style="background:hsl(${TRAITS[(i / LOCI) | 0] === 'hue' || TRAITS[(i / LOCI) | 0] === 'hue2' || TRAITS[(i / LOCI) | 0] === 'pref' ? v * 360 : 200 - v * 170},${60}%,${35 + v * 30}%)"></i>`).join('');
  genes.push(`<div class="dna"><div class="muted">Chromosomes — ${TRAITS.length} traits × ${LOCI} genes, two copies each</div><div class="strand">${strand(dna.A)}</div><div class="strand">${strand(dna.B)}</div></div>`);
  $('#ciGenes').innerHTML = genes.join('');
  updateInspector();
  if (window.innerWidth > 820 || !document.body.classList.contains('panel-hidden')) switchTab('creature');
}
function updateInspector() {
  const c = state.selected, w = state.world;
  if (!c) return;
  const sp = w.species.get(c.sp);
  $('#ciName').textContent = sp.name;
  const par = w.byId.get(c.parent), kids = w.creatures.filter((k) => k.parent === c.id).length;
  $('#ciSub').textContent = `#${c.id} · gen ${c.gen} · ${kids}/${c.children} children alive · parent ${par ? 'alive' : c.parent ? 'gone' : 'founder'} · ${c.killsN} kills · ${c.builtN} walls built · ${c.role}${c.bond ? ' · has a life partner' : ''}${c.tradesN ? ` · ${c.tradesN} trades` : ''}${c.raidN ? ` · ${c.raidN} raided` : ''}${c.sick > 0 ? ' · sick' : c.immune ? ' · immune' : ''}`;
  const bar = (k, v, max, col, txt) => `<div class="barrow"><span>${k}</span><div class="track"><div class="fill" style="width:${clamp(v / max, 0, 1) * 100}%;background:${col}"></div></div><span class="v">${txt}</span></div>`;
  $('#ciBars').innerHTML =
    bar('Energy', c.energy, c.maxE, '#ffc78a', `${c.energy.toFixed(0)}/${c.maxE.toFixed(0)}`) +
    bar('Health', c.hp, c.maxHp, '#8fe3b8', `${Math.round((c.hp / c.maxHp) * 100)}%`) +
    bar('Age', c.age, c.life, '#9fb7ff', `${Math.round((c.age / c.life) * 100)}%`) +
    bar('Glow', c.signal, 1, hsl(c.g.hue2, 0.9, 0.65), c.signal.toFixed(2)) +
    bar('Carrying', c.carry, 1, '#c9a26b', c.carry >= 1 ? 'block' : Math.round(c.carry * 100) + '%') +
    bar('Shelter', c.shelter, 1, '#b8a4ff', Math.round(c.shelter * 100) + '%') +
    [...state.brain.memory(c.slot)].map((v, i) => bar('Memory ' + (i + 1), Math.abs(v), 1, v >= 0 ? '#ffc78a' : '#9fb7ff', v.toFixed(2))).join('') +
    bar('Learned', Math.min(1, state.brain.drift(c.slot, c.g) * 4), 1, '#ff9fd0', (state.brain.drift(c.slot, c.g) * 100).toFixed(1) + '% rewired') +
    bar('Dopamine', Math.abs(state.brain.DELTA[c.slot]), 1, state.brain.DELTA[c.slot] >= 0 ? '#ffd36b' : '#7f9cff', (state.brain.DELTA[c.slot] >= 0 ? '+' : '') + state.brain.DELTA[c.slot].toFixed(2)) +
    bar('Expects', (state.brain.outputs(c.slot)[OUT.value] + 1) / 2, 1, '#e7b4ff', state.brain.outputs(c.slot)[OUT.value].toFixed(2)) +
    bar('Voice', Math.max(Math.abs(c.v1), Math.abs(c.v2)), 1, '#ffb070', `${c.v1.toFixed(2)} / ${c.v2.toFixed(2)}`) +
    bar('Height', c.z, 4, '#c9b8a0', `level ${c.z}`) +
    bar('Body temp', clamp((c.temp + 10) / 50, 0, 1), 1, c.temp > 27 - 30 * c.g.fur + 7 ? '#ff8a6a' : c.temp < 27 - 30 * c.g.fur - 7 ? '#7fb8ff' : '#8fe3b8', `${c.temp.toFixed(0)}°C (likes ${(27 - 30 * c.g.fur).toFixed(0)})`) +
    bar('Wallet', Math.min(1, c.wallet / 20), 1, '#ffd36b', `${c.wallet.toFixed(1)} shells`) +
    bar('Food stash', Math.min(1, c.stash / (4 + 6 * c.g.size)), 1, '#b6dc8c', `${c.stash.toFixed(1)} units`) +
    bar('Friends', [...c.rel.values()].filter((v) => v > 0.3).length, 8, '#8fe3b8', `${[...c.rel.values()].filter((v) => v > 0.3).length} friends · ${[...c.rel.values()].filter((v) => v < -0.3).length} foes`) +
    bar('Genes mixed', heterozygosity(c.g), 1, '#a0e0d0', Math.round(heterozygosity(c.g) * 100) + '% heterozygous');
  $('#ciBrain').textContent = `${c.brain.neurons} neurons · ${c.brain.synapses} synapses · IQ ${c.brain.iq} · ${state.brain.kind.split(' ')[0]}`;
  drawBrain(c);
  drawAttention(c);
}
function drawAttention(cr) {
  const cv = $('#attnCanvas'); if (!cv.clientWidth) return;
  const [c, W, H] = sizeCanvas(cv); c.clearRect(0, 0, W, H);
  const B = state.brain, cx = B.cortexOf(cr.slot);
  if (!cx) { $('#ciCortex').textContent = 'off'; c.fillStyle = '#9fb3a9'; c.font = '12px Space Grotesk'; c.fillText('No cortex (turned off in Rules → Mind).', 8, 20); return; }
  $('#ciCortex').textContent = `design #${cx.id} · gen ${cx.gen} · shared by ${cx.refs} mind${cx.refs === 1 ? '' : 's'}`;
  const att = B.attention(cr.slot), T = 12, cw = (W - 40) / T, rh = 22;
  c.font = '10px JetBrains Mono, monospace'; c.textBaseline = 'middle';
  for (let h = 0; h < 2; h++) {
    c.fillStyle = '#9fb3a9'; c.fillText(`h${h + 1}`, 4, 10 + h * (rh + 4) + rh / 2);
    for (let a = 0; a < T; a++) {
      const p = att[h * T + a];
      c.fillStyle = `rgba(${h ? '159,183,255' : '255,199,138'},${0.06 + Math.min(1, p * 2.2)})`;
      c.fillRect(34 + a * cw, 10 + h * (rh + 4), cw - 2, rh);
    }
  }
  const th = B.inputs(cr.slot).subarray(SENSE_NAMES.indexOf('th1') + MAX_EYES * CH, SENSE_NAMES.indexOf('th1') + MAX_EYES * CH + 8);
  c.fillStyle = '#9fb3a9'; c.fillText('th', 4, 74);
  const tw = (W - 40) / 8;
  th.forEach((v, i) => { c.fillStyle = v >= 0 ? `rgba(143,227,184,${0.15 + Math.abs(v) * 0.85})` : `rgba(255,138,138,${0.15 + Math.abs(v) * 0.85})`; c.fillRect(34 + i * tw, 66, tw - 2, 16); });
}
function drawBrain(cr) {
  const cv = $('#brainCanvas'); if (!cv.clientWidth) return;
  const [c, W, H] = sizeCanvas(cv);
  c.clearRect(0, 0, W, H);
  const g = cr.g, nh = g.hidden, B = state.brain, w = B.weights(cr.slot), inp = B.inputs(cr.slot), hid = B.hidden(cr.slot), out = B.outputs(cr.slot);
  const inIdx = [];
  for (let e = 0; e < g.eyes; e++) for (let ch = 0; ch < CH; ch++) inIdx.push(e * CH + ch);
  for (let s = 0; s < SENSE_NAMES.length; s++) inIdx.push(MAX_EYES * CH + s);
  const inVals = inIdx.map((i) => inp[i]);
  const colX = [62, W / 2 - 6, W - 58];
  const ys = (n, i) => 8 + (n === 1 ? (H - 16) / 2 : (i * (H - 16)) / (n - 1));
  const chCol = ['#8fe3b8', '#ff8a8a', '#ffb36b', '#9fb7ff', '#c9a26b'];
  // edges batched into a few paths by colour and strength (thousands of separate strokes are slow)
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  const addEdge = (wt, act, x0, y0, x1, y1) => {
    const k = Math.min(2, Math.floor(act * Math.min(1, Math.abs(wt)) * 3)) + (wt > 0 ? 0 : 3);
    paths[k].moveTo(x0, y0); paths[k].lineTo(x1, y1);
  };
  for (let a = 0; a < inIdx.length; a++) {
    const act = Math.abs(inVals[a]); if (act < 0.01) continue;
    for (let j = 0; j < nh; j++) { const wt = w[O_IH + inIdx[a] * H_MAX + j]; if (wt) addEdge(wt, act, colX[0], ys(inIdx.length, a), colX[1], ys(nh, j)); }
  }
  for (let j = 0; j < nh; j++) for (let m = 0; m < N_OUT; m++) {
    const wt = w[O_HO + j * N_OUT + m]; if (wt) addEdge(wt, Math.abs(hid[j]), colX[1], ys(nh, j), colX[2], ys(N_OUT, m));
  }
  const alphas = [0.08, 0.25, 0.55];
  paths.forEach((p, k) => { c.strokeStyle = (k < 3 ? 'rgba(143,227,184,' : 'rgba(255,138,138,') + alphas[k % 3] + ')'; c.lineWidth = 0.6 + (k % 3) * 0.5; c.stroke(p); });
  c.font = '9px JetBrains Mono, monospace'; c.textBaseline = 'middle';
  const node = (x, y, v, r, rgb) => {
    c.fillStyle = '#0f1c26'; c.beginPath(); c.arc(x, y, r + 1.2, 0, 6.29); c.fill();
    c.fillStyle = `rgba(${rgb},${clamp(0.2 + Math.abs(v) * 0.8, 0.2, 1).toFixed(2)})`; c.beginPath(); c.arc(x, y, r, 0, 6.29); c.fill();
  };
  const hex = (h) => `${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)}`;
  const every = inIdx.length > 40 ? 3 : inIdx.length > 24 ? 2 : 1;
  inIdx.forEach((idx, a) => {
    const y = ys(inIdx.length, a), v = inVals[a];
    const isEye = idx < MAX_EYES * CH;
    node(colX[0], y, v, Math.min(3.5, (H - 16) / inIdx.length / 2.1), isEye ? hex(chCol[idx % CH]) : '232,226,208');
    if (a % every === 0) {
      c.fillStyle = '#9fb3a9'; c.textAlign = 'right';
      c.fillText(isEye ? `eye${Math.floor(idx / CH) + 1} ${CH_NAMES[idx % CH]}` : SENSE_NAMES[idx - MAX_EYES * CH], colX[0] - 6, y);
    }
  });
  for (let j = 0; j < nh; j++) node(colX[1], ys(nh, j), hid[j], 4, hid[j] >= 0 ? '255,199,138' : '159,183,255');
  for (let m = 0; m < N_OUT; m++) {
    const y = ys(N_OUT, m), v = out[m];
    node(colX[2], y, v, 5, v >= 0 ? '255,199,138' : '159,183,255');
    c.fillStyle = '#eef3ea'; c.textAlign = 'left'; c.fillText(OUT_NAMES[m], colX[2] + 9, y);
  }
}
function setFollowBtn() { $('#ciFollow').classList.toggle('on', state.follow); $('#ciFollow').textContent = state.follow ? 'Following' : 'Follow'; }

// ---------- rules UI ----------
function buildRules() {
  const box = $('#rulesBox'); box.innerHTML = '';
  const groups = {};
  for (const k in RULES) { const g = RULES[k][5]; (groups[g] || (groups[g] = [])).push(k); }
  for (const gname in groups) {
    const card = document.createElement('div'); card.className = 'card rgroup';
    card.innerHTML = `<h4>${gname}</h4>`;
    for (const k of groups[gname]) {
      const [def, min, max, step, label, , help] = RULES[k];
      const v = state.rules[k];
      let el;
      if (k === 'reproMode') {
        el = document.createElement('div'); el.className = 'rule';
        el.innerHTML = `<div class="rl"><span>${label}</span></div><div class="seg">${['Asexual', 'Sexual', 'Both'].map((t, i) => `<button data-v="${i}" class="${v === i ? 'on' : ''}">${t}</button>`).join('')}</div><div class="help">Sexual mixes two parents’ genes; asexual clones with mutations.</div>`;
        el.querySelectorAll('button').forEach((b) => b.onclick = () => { state.rules[k] = +b.dataset.v; el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); saveRules(); });
      } else if (min === 0 && max === 1 && step === 1) {
        el = document.createElement('label'); el.className = 'switch';
        el.innerHTML = `<span>${label}<div class="help muted">${help}</div></span><input type="checkbox" ${v ? 'checked' : ''}>`;
        el.querySelector('input').onchange = (e) => { state.rules[k] = e.target.checked ? 1 : 0; saveRules(); };
      } else {
        el = document.createElement('div'); el.className = 'rule';
        const dec = step < 1 ? 2 : 0;
        el.innerHTML = `<div class="rl"><span>${label}</span><output>${(+v).toFixed(dec)}</output></div><input type="range" min="${min}" max="${max}" step="${step}" value="${v}"><div class="help">${help}</div>`;
        const inp = el.querySelector('input'), out = el.querySelector('output');
        const paint = () => inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
        paint();
        inp.oninput = () => { state.rules[k] = +inp.value; out.textContent = (+inp.value).toFixed(dec); paint(); saveRules(); };
      }
      card.appendChild(el);
    }
    box.appendChild(card);
  }
}

// ---------- tabs & panel ----------
function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  setTimeout(updatePanels, 0);
}
function setPanel(open) {
  document.body.classList.toggle('panel-hidden', !open);
  setTimeout(() => { state.renderer.resize(); state.renderer.clampCam(); updatePanels(); }, 260);
}

// ---------- input ----------
function bindInput() {
  const cv = $('#world'), r = () => state.renderer;
  const pts = new Map();
  let downAt = null, moved = 0, pinch0 = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pts.size === 1) { downAt = [e.offsetX, e.offsetY, performance.now()]; moved = 0; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: r().cam.zoom }; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      r().zoomAt(mx, my, (pinch0.z * d / pinch0.d) / r().cam.zoom);
      moved = 99;
      return;
    }
    const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) {
      r().cam.x -= dx / r().cam.zoom; r().cam.y -= dy / r().cam.zoom; r().clampCam();
      if (state.follow) { state.follow = false; setFollowBtn(); }
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (pts.size === 0 && downAt && moved <= 6) useTool(e.offsetX, e.offsetY);
    if (pts.size === 0) downAt = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch0 = null; downAt = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); r().zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  window.addEventListener('resize', () => { r().resize(); r().clampCam(); });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === '+' || e.key === '=') changeSpeed(1);
    if (e.key === '-') changeSpeed(-1);
    if (e.key === 'Escape') selectCreature(null);
  });
}
function useTool(sx, sy) {
  const w = state.world, [x, y] = state.renderer.toWorld(sx, sy);
  switch (state.tool) {
    case 'inspect': {
      const c = w.nearestCreature(x, y, 24 / state.renderer.cam.zoom + 6);
      selectCreature(c);
      if (c && window.innerWidth <= 820 && document.body.classList.contains('panel-hidden')) { setPanel(true); switchTab('creature'); }
      break;
    }
    case 'food': w.dropFood(x, y); break;
    case 'tree': if (!w.isWater(x, y)) { w.addTree(x, y); toast('A tree takes root. It will drop fruit.'); } break;
    case 'spawn':
      if (state.cloneGenome) { w.spawnAt(x, y, state.cloneGenome); toast('Clones released.'); state.cloneGenome = null; setTool('inspect'); }
      else w.spawnAt(x, y, null);
      break;
    case 'meteor': w.meteor(x, y); break;
    case 'fire': w.climate.ignite(x, y); toast('Fire!'); break;
  }
}
function setTool(t) {
  state.tool = t;
  $$('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const tips = { inspect: 'Tap a creature to inspect it.', food: 'Tap to scatter fruit.', tree: 'Tap land to plant a fruit tree.', spawn: state.cloneGenome ? 'Tap to release the clones.' : 'Tap to seed a brand-new species.', meteor: 'Tap to call down a meteor.', fire: 'Tap dry land to start a fire.' };
  toast(tips[t]);
}
function togglePlay() {
  state.running = !state.running;
  $('#btnPlay .ico').textContent = state.running ? '❚❚' : '▶';
}
function changeSpeed(d) {
  state.speedIdx = clamp(state.speedIdx + d, 0, SPEEDS.length - 1);
  const s = SPEEDS[state.speedIdx];
  $('#btnSpeed').textContent = (s < 1 ? '½' : s) + '×';
}

// ---------- save / load ----------
function saveWorld() {
  const w = state.world;
  const data = {
    v: 1, seed: w.seed, W: w.W, H: w.H, tick: w.tick, rules: state.rules,
    trees: w.trees.map(({ x, y, r, seed, hue, fruitHue }) => ({ x, y, r, seed, hue, fruitHue })),
    blocks: (() => { const a = []; for (let b = 0; b < w.bOwner.length; b++) if (w.bOwner[b] > 0) a.push(b, w.bOwner[b], Math.round(w.bHp[b]), w.bH[b]); return a; })(),
    species: [...w.species.values()].filter((s) => s.count > 0).map((s) => ({ ...s, rep: serializeGenome(s.rep) })),
    creatures: w.creatures.map((c) => ({ x: c.x, y: c.y, a: c.a, e: c.energy, age: c.age, gen: c.gen, sp: c.sp, g: serializeGenome(c.g) })),
  };
  try { localStorage.setItem('primordia.v3.save', JSON.stringify(data)); toast(`Saved ${data.creatures.length} creatures.`); }
  catch { toast('Could not save here (storage full or blocked).'); }
}
function loadWorld() {
  let data;
  try { data = JSON.parse(localStorage.getItem('primordia.v3.save')); } catch {}
  if (!data) { toast('No saved world yet.'); return; }
  setSeed(data.seed);
  Object.assign(state.rules, data.rules);
  if (state.world) for (const c of state.world.creatures) state.brain.release(c.slot);
  const w = new World({ W: data.W, H: data.H, seed: data.seed, rules: state.rules, brain: state.brain });
  if (data.blocks) { for (let i = 0; i < data.blocks.length; i += 4) { const b = data.blocks[i]; w.bOwner[b] = data.blocks[i + 1]; w.bHp[b] = data.blocks[i + 2]; w.bH[b] = data.blocks[i + 3] || 1; w.blockCount += w.bH[b]; } }
  w.tick = data.tick;
  for (const t of data.trees) w.trees.push({ ...t, timer: 100 });
  for (let i = 0; i < w.rules.maxPlants * 0.6; i++) w.spawnPlant();
  const map = new Map();
  for (const s of data.species) { const sp = { ...s, rep: deserializeGenome(s.rep), count: 0, blocks: 0 }; w.species.set(sp.id, sp); w.speciesOrder.push(sp.id); map.set(s.id, sp); w.nextSpecies = Math.max(w.nextSpecies, s.id + 1); }
  for (const c of data.creatures) {
    const sp = map.get(c.sp); if (!sp) continue;
    const cr = w.spawn(deserializeGenome(c.g), c.x, c.y, sp, c.gen, null, c.e);
    cr.a = c.a; cr.age = c.age;
  }
  for (let b = 0; b < w.bOwner.length; b++) { const sp = w.species.get(w.bOwner[b]); if (sp) sp.blocks += w.bH[b]; }
  w.log('A saved world awakens.', 140);
  state.world = w; state.selected = null; state.renderer.setWorld(w);
  buildRules(); toast('World loaded.');
}
function exportGenomes() {
  const w = state.world;
  const data = topSpecies(50).map((s) => ({ name: s.name, count: s.count, genome: serializeGenome(s.rep) }));
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `primordia-species-${w.tick}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- wire up ----------
function bindUI() {
  $('#btnPlay').onclick = togglePlay;
  $('#btnSpeed').onclick = () => { state.speedIdx = (state.speedIdx + 1) % SPEEDS.length; changeSpeed(0); };
  $$('.tool').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  $('#btnPanel').onclick = () => setPanel(document.body.classList.contains('panel-hidden'));
  $('#handle').onclick = () => setPanel(false);
  $$('.tab').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
  $('#traitSel').onchange = drawTraitChart;
  $('#ciClose').onclick = () => selectCreature(null);
  $('#ciFollow').onclick = () => { state.follow = !state.follow; setFollowBtn(); if (state.follow && state.renderer.cam.zoom < 2) state.renderer.cam.zoom = 2.5; };
  $('#ciClone').onclick = () => { if (!state.selected) return; state.cloneGenome = { ...state.selected.g, _sp: state.selected.sp }; setTool('spawn'); };
  const pickBy = (fn) => { const w = state.world; if (!w.creatures.length) return; const c = w.creatures.reduce((a, b) => (fn(b) > fn(a) ? b : a)); selectCreature(c); state.follow = true; setFollowBtn(); if (state.renderer.cam.zoom < 2.5) state.renderer.cam.zoom = 2.5; };
  $('#pickSmart').onclick = () => pickBy((c) => c.brain.iq);
  $('#pickOld').onclick = () => pickBy((c) => c.gen);
  $('#pickHunter').onclick = () => pickBy((c) => c.killsN * 10 + c.g.diet);
  $('#evBloom').onclick = () => { state.world.bloom(); toast('A great bloom!'); };
  $('#evPlague').onclick = () => { state.world.plague(); toast('Plague strikes the most common species.'); };
  $('#evMeteor').onclick = () => { const w = state.world; w.meteor(Math.random() * w.W, Math.random() * w.H); };
  $('#evStorm').onclick = () => { state.world.storm(); toast('Storm clouds gather…'); };
  $('#evDrought').onclick = () => { state.world.drought(); toast('A drought begins.'); };
  $('#btnLayer').onclick = () => { const L = ['none', 'moisture', 'temperature']; const r = state.renderer; r.layer = L[(L.indexOf(r.layer) + 1) % L.length]; r.cv2 = -1; toast(r.layer === 'none' ? 'Map: normal' : r.layer === 'moisture' ? 'Map: soil moisture (blue = wet, brown = dry)' : 'Map: temperature (blue = cold, red = hot)'); };
  $('#evWinter').onclick = () => { state.world.winter(); toast('A bitter cold snap!'); };
  $('#evFounders').onclick = () => { const w = state.world; for (let i = 0; i < 2; i++) w.foundSpecies(14); toast('New founders arrive.'); };
  $('#foundIn').oninput = (e) => { $('#foundOut').textContent = e.target.value; };
  $('#newWorld').onclick = () => newWorld(+$('#seedIn').value || undefined, $('#sizeSel').value, +$('#foundIn').value);
  $('#randSeed').onclick = () => { $('#seedIn').value = (Math.random() * 1e9) | 0; };
  $('#resetRules').onclick = () => { Object.assign(state.rules, defaultRules()); saveRules(); buildRules(); toast('Rules reset.'); };
  $('#saveBtn').onclick = saveWorld;
  $('#loadBtn').onclick = loadWorld;
  $('#exportBtn').onclick = exportGenomes;
}

// ---------- boot ----------
const params = new URLSearchParams(location.search);
if (window.innerWidth <= 820) document.body.classList.add('panel-hidden');
state.brain = await createBrain();
bindUI();
buildRules();
newWorld(params.has('seed') ? +params.get('seed') : undefined, params.get('size') || 'm', 6);
bindInput();
for (let i = 0; i < 120; i++) state.world.step();
setTimeout(() => toast(`Brains running on ${state.brain.kind}. Tap a creature to see it think.`), 600);
requestAnimationFrame(loop);
window.primordia = state; // handy for tinkering in devtools
