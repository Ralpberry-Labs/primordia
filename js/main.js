// Wires the world, renderer and UI together.
import { World, RULES, defaultRules } from './world.js';
import { Renderer, drawPortrait } from './render.js';
import { GENES, INT_GENES, N_IN, N_OUT, H_MAX, MAX_EYES, CH, O_IH, O_HH, O_BO, OUT_NAMES, SENSE_NAMES, serializeGenome, deserializeGenome } from './genome.js';
import { setSeed, hsl, clamp } from './util.js';

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
  try { Object.assign(r, JSON.parse(localStorage.getItem('primordia.rules') || '{}')); } catch {}
  for (const k in r) if (!(k in RULES)) delete r[k];
  return r;
}
function saveRules() { try { localStorage.setItem('primordia.rules', JSON.stringify(state.rules)); } catch {} }

// ---------- world lifecycle ----------
function newWorld(seed, sizeKey = 'm', founders = 6) {
  seed = seed ?? ((Math.random() * 1e9) | 0);
  setSeed(seed);
  const [W, H] = SIZES[sizeKey] || SIZES.m;
  const w = new World({ W, H, seed, rules: state.rules });
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
    while (acc >= 1) {
      w.step(); acc -= 1; n++;
      if (performance.now() - t0 > 22) { acc = 0; break; } // keep frames smooth on slow devices
    }
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
    `<span class="chip opt"><span class="k">Groups</span><b>${w.groups.length}</b></span>`,
    `<span class="chip opt"><span class="k">IQ</span><b>${iq.toFixed(0)}</b></span>`,
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
  $('#popLegend').innerHTML = `<span><i style="background:#8fe3b8"></i>${h.herb} grazers</span><span><i style="background:#ffc78a"></i>${h.omni} omni</span><span><i style="background:#ff8a8a"></i>${h.carn} hunters</span>`;
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
    li.insertAdjacentHTML('beforeend', `<div><div class="nm">${s.name}</div><div class="meta">${dietBadge(s.rep.diet)}<span>IQ ${(st.iq / st.n).toFixed(0)}</span><span>gen ${st.gen}</span>${parent ? `<span>from ${parent.genus === s.genus ? parent.name.split(' ')[1] : parent.name}</span>` : '<span>founder</span>'}</div><div class="bar" style="width:${(s.count / maxC) * 100}%;background:${hsl(s.hue, 0.65, 0.6)}"></div></div><div class="cnt">${s.count}</div>`);
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
function updatePanels() {
  const tab = $('.tab.active').dataset.tab;
  if (document.body.classList.contains('panel-hidden')) return;
  if (tab === 'life') { drawPopChart(); drawTraitChart(); drawPhylo(); updateSpeciesList(); }
  if (tab === 'story') updateEvents();
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
    if (k === 'hue' || k === 'hue2') continue;
    const d = GENES[k], v = c.g[k];
    const shown = k === 'lifespan' || k === 'vision' ? v.toFixed(0) : k === 'fov' ? (v * 57.3).toFixed(0) + '°' : v.toFixed(2);
    genes.push(`<div class="gene"><div class="gk">${d.label}<b>${shown}</b></div><div class="gt"><i style="width:${((v - d.min) / (d.max - d.min)) * 100}%"></i></div></div>`);
  }
  for (const k in INT_GENES) {
    const d = INT_GENES[k], v = c.g[k];
    genes.push(`<div class="gene"><div class="gk">${d.label}<b>${v}</b></div><div class="gt"><i style="width:${((v - d.min) / (d.max - d.min)) * 100}%"></i></div></div>`);
  }
  $('#ciGenes').innerHTML = genes.join('');
  updateInspector();
  if (window.innerWidth > 820 || !document.body.classList.contains('panel-hidden')) switchTab('creature');
}
function updateInspector() {
  const c = state.selected, w = state.world;
  if (!c) return;
  const sp = w.species.get(c.sp);
  $('#ciName').textContent = sp.name;
  $('#ciSub').textContent = `#${c.id} · generation ${c.gen} · ${c.children} children · ${c.killsN} kills`;
  const bar = (k, v, max, col, txt) => `<div class="barrow"><span>${k}</span><div class="track"><div class="fill" style="width:${clamp(v / max, 0, 1) * 100}%;background:${col}"></div></div><span class="v">${txt}</span></div>`;
  $('#ciBars').innerHTML =
    bar('Energy', c.energy, c.maxE, '#ffc78a', `${c.energy.toFixed(0)}/${c.maxE.toFixed(0)}`) +
    bar('Health', c.hp, c.maxHp, '#8fe3b8', `${Math.round((c.hp / c.maxHp) * 100)}%`) +
    bar('Age', c.age, c.life, '#9fb7ff', `${Math.round((c.age / c.life) * 100)}%`) +
    bar('Glow', c.signal, 1, hsl(c.g.hue2, 0.9, 0.65), c.signal.toFixed(2));
  $('#ciBrain').textContent = `${c.brain.neurons} neurons · ${c.brain.synapses} synapses · IQ ${c.brain.iq}`;
  drawBrain(c);
}
function drawBrain(cr) {
  const cv = $('#brainCanvas'); if (!cv.clientWidth) return;
  const [c, W, H] = sizeCanvas(cv);
  c.clearRect(0, 0, W, H);
  const g = cr.g, nh = g.hidden, w = g.w;
  // inputs: active eyes' channels + senses
  const inIdx = [];
  for (let e = 0; e < g.eyes; e++) for (let ch = 0; ch < CH; ch++) inIdx.push(e * CH + ch);
  for (let s = 0; s < SENSE_NAMES.length; s++) inIdx.push(MAX_EYES * CH + s);
  const inVals = inIdx.map((i) => (i < MAX_EYES * CH ? cr.eyes[i] : [cr.energy / cr.maxE, cr.hp / cr.maxHp, cr.age / cr.life, Math.sin(state.world.tick * 0.05 + cr.id), 1, cr.heard, cr.pain, Math.hypot(cr.vx, cr.vy) / 2, Math.min(1, cr.crowd / 6)][i - MAX_EYES * CH]));
  const colX = [54, W / 2, W - 52];
  const ys = (n, i) => 8 + (n === 1 ? (H - 16) / 2 : (i * (H - 16)) / (n - 1));
  const chCol = ['#8fe3b8', '#ff8a8a', '#ffb36b', '#9fb7ff'];
  // edges in->hidden
  c.lineWidth = 0.6;
  for (let a = 0; a < inIdx.length; a++) for (let j = 0; j < nh; j++) {
    const wt = w[O_IH + inIdx[a] * H_MAX + j]; if (!wt) continue;
    const act = Math.abs(inVals[a]);
    c.strokeStyle = wt > 0 ? `rgba(143,227,184,${0.05 + act * Math.min(1, Math.abs(wt)) * 0.5})` : `rgba(255,138,138,${0.05 + act * Math.min(1, Math.abs(wt)) * 0.5})`;
    c.beginPath(); c.moveTo(colX[0], ys(inIdx.length, a)); c.lineTo(colX[1], ys(nh, j)); c.stroke();
  }
  for (let j = 0; j < nh; j++) for (let m = 0; m < N_OUT; m++) {
    const wt = cr.wHO[j * N_OUT + m]; if (!wt) continue;
    const act = Math.abs(cr.h[j]);
    c.strokeStyle = wt > 0 ? `rgba(143,227,184,${0.06 + act * Math.min(1, Math.abs(wt)) * 0.6})` : `rgba(255,138,138,${0.06 + act * Math.min(1, Math.abs(wt)) * 0.6})`;
    c.lineWidth = 0.4 + Math.min(2, Math.abs(wt));
    c.beginPath(); c.moveTo(colX[1], ys(nh, j)); c.lineTo(colX[2], ys(N_OUT, m)); c.stroke();
  }
  c.font = '9.5px JetBrains Mono, monospace'; c.textBaseline = 'middle';
  const node = (x, y, v, r, col) => {
    c.fillStyle = '#0f1c26'; c.beginPath(); c.arc(x, y, r + 1.5, 0, 6.29); c.fill();
    c.fillStyle = col.replace('A', clamp(0.2 + Math.abs(v) * 0.8, 0.2, 1).toFixed(2)); c.beginPath(); c.arc(x, y, r, 0, 6.29); c.fill();
  };
  inIdx.forEach((idx, a) => {
    const y = ys(inIdx.length, a), v = inVals[a];
    const isEye = idx < MAX_EYES * CH;
    const col = isEye ? chCol[idx % CH] : '#e8e2d0';
    node(colX[0], y, v, Math.min(4, (H - 16) / inIdx.length / 2.2), col.length === 7 ? `rgba(${parseInt(col.slice(1, 3), 16)},${parseInt(col.slice(3, 5), 16)},${parseInt(col.slice(5, 7), 16)},A)` : col);
    if (inIdx.length <= 22 || a % 2 === 0) {
      c.fillStyle = '#9fb3a9'; c.textAlign = 'right';
      c.fillText(isEye ? `eye${Math.floor(idx / CH) + 1} ${['🌿', 'prey', 'thr', 'kin'][idx % CH]}` : SENSE_NAMES[idx - MAX_EYES * CH], colX[0] - 7, y);
    }
  });
  for (let j = 0; j < nh; j++) node(colX[1], ys(nh, j), cr.h[j], 4.5, cr.h[j] >= 0 ? 'rgba(255,199,138,A)' : 'rgba(159,183,255,A)');
  for (let m = 0; m < N_OUT; m++) {
    const y = ys(N_OUT, m), v = cr.out[m];
    node(colX[2], y, v, 6, v >= 0 ? 'rgba(255,199,138,A)' : 'rgba(159,183,255,A)');
    c.fillStyle = '#eef3ea'; c.textAlign = 'left'; c.fillText(OUT_NAMES[m], colX[2] + 10, y);
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
  }
}
function setTool(t) {
  state.tool = t;
  $$('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const tips = { inspect: 'Tap a creature to inspect it.', food: 'Tap to scatter fruit.', tree: 'Tap land to plant a fruit tree.', spawn: state.cloneGenome ? 'Tap to release the clones.' : 'Tap to seed a brand-new species.', meteor: 'Tap to call down a meteor.' };
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
    species: [...w.species.values()].filter((s) => s.count > 0).map((s) => ({ ...s, rep: serializeGenome(s.rep) })),
    creatures: w.creatures.map((c) => ({ x: c.x, y: c.y, a: c.a, e: c.energy, age: c.age, gen: c.gen, sp: c.sp, g: serializeGenome(c.g) })),
  };
  try { localStorage.setItem('primordia.save', JSON.stringify(data)); toast(`Saved ${data.creatures.length} creatures.`); }
  catch { toast('Could not save here (storage full or blocked).'); }
}
function loadWorld() {
  let data;
  try { data = JSON.parse(localStorage.getItem('primordia.save')); } catch {}
  if (!data) { toast('No saved world yet.'); return; }
  setSeed(data.seed);
  Object.assign(state.rules, data.rules);
  const w = new World({ W: data.W, H: data.H, seed: data.seed, rules: state.rules });
  w.tick = data.tick;
  for (const t of data.trees) w.trees.push({ ...t, timer: 100 });
  for (let i = 0; i < w.rules.maxPlants * 0.6; i++) w.spawnPlant();
  const map = new Map();
  for (const s of data.species) { const sp = { ...s, rep: deserializeGenome(s.rep), count: 0 }; w.species.set(sp.id, sp); w.speciesOrder.push(sp.id); map.set(s.id, sp); w.nextSpecies = Math.max(w.nextSpecies, s.id + 1); }
  for (const c of data.creatures) {
    const sp = map.get(c.sp); if (!sp) continue;
    const cr = w.spawn(deserializeGenome(c.g), c.x, c.y, sp, c.gen, null, c.e);
    cr.a = c.a; cr.age = c.age;
  }
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
bindUI();
buildRules();
newWorld(params.has('seed') ? +params.get('seed') : undefined, params.get('size') || 'm', 6);
bindInput();
// warm-up so the first frame already looks alive
for (let i = 0; i < 120; i++) state.world.step();
setTimeout(() => toast('Tap a creature to see its brain. Drag to explore, pinch or scroll to zoom.'), 600);
requestAnimationFrame(loop);
window.primordia = state; // handy for tinkering in devtools
