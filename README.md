# Primordia

**A living pixel world where tiny creatures evolve.** Each creature has a genome and a small neural-network brain. They feed, hunt, breed, mutate and split into new species while you watch. You can change the rules of nature as it runs.

▶ **Live:** https://ralpberry-labs.github.io/primordia/

Brains are written in **C++ and compiled to WebAssembly**. Everything else is plain HTML, CSS and JavaScript, with no libraries. It works on phones too.

## What evolves

Every creature carries a genome. Its children inherit a mutated copy of it, mixed with a mate's genome when breeding is sexual.

| Part | Genes |
|---|---|
| Body | 7×7 symmetric pixel body plan, colour pattern, hue, size, muscle/speed, armour |
| Senses | 1–6 eyes, field of view, vision range |
| Feeding | mouth size, diet (from plant-eater to meat-eater) |
| Life history | breeding threshold, litter size, lifespan |
| Evolvability | its own mutation rate, its own learning rate |
| Brain | recurrent neural network with 2–20 hidden neurons. Neurons can be added or removed, and synapses can be wired, pruned or tuned |

**Brains (C++ → WebAssembly, `cpp/brain.cpp`):** each brain is a recurrent network with up to 24 neurons, 51 inputs and 13 outputs. All brains are evaluated in one batched call per tick. The recurrent loop gives short-term memory, and **4 gated memory cells** hold information for as long as the creature chooses to keep it. Brains also **learn from experience** through reward-modulated Hebbian learning with eligibility traces: energy gained and shelter found strengthen the synapses that led to them, and pain weakens them. If WebAssembly isn't available, a JavaScript port of the same math runs instead.

**Senses:** each eye covers one slice of the view and reports plants, prey or meat, threats, kin, and walls (its own or foreign). The brain also feels hunger, health, age, pain, speed, crowding, a heartbeat clock, the glow of others, the material it is carrying, how sheltered it is, the direction of home, nearby kin who are building, nearby family, and its latest reward.

**Actions:** move, turn, bite (creatures or foreign walls), glow, share food (family first), breed, build, and write to its memory cells.

**Speciation:** when a lineage drifts far enough from its species' reference genome, it becomes a new species. The new species usually keeps its genus name, so families of related species appear in the Tree of Life.

## Civilisation and conflict

- **Building:** creatures pick up stone, sand and wood as they move, and their brain decides when to place a wall. Blocks go where kin walls already are (termite-style stigmergy), so walls grow into lines, rooms and compounds rather than scattered bricks. Walls next to kin walls are stronger, lone walls crumble, and walls need repairs.
- **Shelter:** living among your own walls saves energy, most of all on cold nights and in winter. Young born there start stronger, and defenders inside are hard to hurt. Strangers can't pass a species' walls and have to break them down.
- **Families:** creatures sense parents, children and siblings, and feed hungry relatives first.
- **Strength in numbers:** each extra attacker on the same victim adds force, so total force grows roughly with the square of their numbers, as in Lanchester's law for group combat. A mob of small creatures can bring down a giant. Bigger bodies out-muscle smaller ones, and starving creatures fight weakly.
- **Disease:** sickness breaks out in crowds and spreads by contact. Sick creatures burn energy faster, and survivors become immune.
- **Living forests:** mature trees drop seeds, and saplings grow up to drop fruit, so forests spread over fertile land.

## What emerges

No behaviour is scripted. The founders start with only faint instincts, and evolution can rewire or discard them. Things to watch for:

- Walled villages and fortresses forming around fruit trees, and raids on rival walls.
- Herds, hunting packs, and mobs ganging up on big predators.
- Altruism inside families, and glow "languages" at night.
- Brains that rewire themselves during life (the Creature tab shows how much), and bigger minds when brains are cheap.

## Controls

- Drag to pan. Scroll or pinch to zoom. **Space** pauses, and **+/−** change speed.
- Tools: **Inspect** (tap a creature to see its genome and its brain firing live), **Food**, **Tree**, **Life** (seed a new species), **Meteor**.
- **Rules** tab: environment (plants, fruit, forest spread, seasons, day/night), civilisation (building, gathering, shelter comfort, wall decay, teamwork, stigmergy, walls that keep strangers out), mind (learning speed, inherited learning, brain cost, neurogenesis), evolution, conflict (strength in numbers, size advantage, disease) and life.
- Acts of nature: bloom, plague, cold snap, meteor, new founders.
- Save and load a world in your browser, export species genomes as JSON, and share a world with `?seed=12345`.

## Build the C++ brain

```bash
brew install llvm lld   # clang with the wasm32 target, plus wasm-ld
./cpp/build.sh          # writes wasm/brain.wasm (~4 KB, committed)
```

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. To run the simulation headless and print the evolutionary stats over 30,000 ticks:

```bash
node tools/headless.mjs 42
```

## Code map

- `cpp/brain.cpp`: the brain (recurrent net, memory cells, lifetime learning), compiled to `wasm/brain.wasm`
- `js/brain.js`: loads the WebAssembly brain, with a JavaScript fallback
- `js/genome.js`: genes, mutation, crossover, genetic distance, body plan, brain layout
- `js/world.js`: terrain, plants, trees, structures, physics, senses, eating, combat, disease, breeding, species, groups, statistics
- `js/render.js`: pixel-art sprites made from genomes, terrain baking, day/night, glow
- `js/main.js`: UI, charts, tree of life, inspector, brain view, controls

## Inspiration

Primordia draws on artificial-life work like [Polyworld](https://en.wikipedia.org/wiki/Polyworld) by Larry Yaeger (vision feeding a neural network, Hebbian learning, predation, mating), [The Bibites](https://thebibites.itch.io/the-bibites), [evolv.io](https://github.com/wrapperband/evolve.io), and the speciation ideas in [NEAT](https://nn.cs.utexas.edu/downloads/papers/stanley.phd04.pdf). All of the code here is original.

MIT licensed · a Ralpberry Labs toy.
