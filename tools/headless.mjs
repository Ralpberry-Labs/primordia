import { World } from '../js/world.js';
import { createBrain } from '../js/brain.js';
import { readFileSync } from 'node:fs';
const brain = await createBrain(readFileSync(new URL('../wasm/brain.wasm', import.meta.url)));
console.log('brain:', brain.kind);
import { setSeed } from '../js/util.js';
const S=+(process.argv[2]||42); setSeed(S);
const w = new World({ seed: S, brain });
w.populate(6, 22);
const t0 = Date.now();
for (let i = 1; i <= 30000; i++) {
  w.step();
  if (i % 3000 === 0) {
    const h = w.history[w.history.length-1];
    const alive = [...w.species.values()].filter(s=>s.count>0).length;
    console.log(i, 'pop', w.creatures.length, 'plants', w.food.length, 'sp', alive, 'ever', w.species.size, 'gen', w.maxGen, 'herb/omni/carn', h.herb, h.omni, h.carn, 'groups', w.groups.length, 'iq', h.avg.iq.toFixed(1), 'hid', h.avg.hidden.toFixed(1), 'eyes', h.avg.eyes.toFixed(2), 'diet', h.avg.diet.toFixed(2), 'kills', w.kills, 'walls', w.blockCount, 'built', w.built, 'shelter', h.avg.shelter.toFixed(2), 'learn', h.avg.learned.toFixed(3), 'ms/tick', ((Date.now()-t0)/i).toFixed(2));
  }
}
