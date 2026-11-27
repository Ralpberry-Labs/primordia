// Run the world without a browser and print how life is doing.
//   node tools/headless.mjs [seed] [ticks]
import { World } from '../js/world.js';
import { createBrain } from '../js/brain.js';
import { setSeed } from '../js/util.js';
import { readFileSync } from 'node:fs';
const brain = await createBrain(readFileSync(new URL('../wasm/brain.wasm', import.meta.url)));
const S = +(process.argv[2] || 42), T = +(process.argv[3] || 30000);
setSeed(S);
const w = new World({ seed: S, brain });
if (process.argv[4] === 'smart') w.rules.smartSelect = 1;
w.populate(6, 22);
console.log('brain:', brain.kind);
const t0 = Date.now();
for (let i = 1; i <= T; i++) {
  w.step();
  if (i % 3000 === 0) {
    const h = w.history[w.history.length - 1], a = h.avg;
    const alive = [...w.species.values()].filter((s) => s.count > 0).length;
    const tall = Math.max(0, ...w.bH);
    console.log(`${i} pop ${w.creatures.length} (grz ${h.herb} hunt ${h.carn} fish ${h.fish}) plants ${w.landPlants} algae ${w.algaeN} sp ${alive}/${w.species.size} gen ${w.maxGen}`
      + ` | iq ${a.iq.toFixed(0)} neur ${a.hidden.toFixed(1)} learn ${a.learned.toFixed(3)} voice ${a.voice.toFixed(2)}`
      + ` | blocks ${w.blockCount} tallest ${tall} z ${a.height.toFixed(2)} shelter ${a.shelter.toFixed(2)} | fur ${a.fur.toFixed(2)} hab ${a.habitat.toFixed(2)}`
      + ` | ${w.climate.state} moist ${w.climate.landMoist.toFixed(2)} fire ${w.climate.burning} trees ${w.trees.length} | ${((Date.now() - t0) / i).toFixed(2)} ms/tick`);
  }
}
for (const e of w.events.slice(0, 25).reverse()) console.log('  ·', e.t, e.msg);
