# Primordia

**A living pixel world where tiny creatures evolve.** Each creature has a genome and a small neural-network brain. They feed, hunt, breed, mutate and split into new species while you watch. You can change the rules of nature as it runs.

▶ **Live:** https://ralpberry-labs.github.io/primordia/

Brains are written in **C++ and compiled to WebAssembly**. Everything else is plain HTML, CSS and JavaScript, with no libraries. It works on phones too.

## Genetics (as in nature, simplified)

- **Diploid DNA:** every creature carries two chromosomes, one from each parent.
- **Polygenic traits:** each trait (size, speed, colour, armour, fur, diet, eyes, vision, habitat, mate preference, curiosity, even its own mutation and learning rates…) is set by 3 genes per chromosome. The trait you see is the average of all six gene copies, so offspring vary smoothly, like human height.
- **Mendelian body shape:** body pixels are dominant (one copy is enough to show), and colour patterns are recessive (both copies are needed), so hidden patterns can skip generations and come back.
- **Meiosis:** each parent passes on a gamete built from its two chromosomes with 1–2 crossovers, plus copying errors (small point mutations, and rarely a large-effect one). Asexual breeders clone themselves with copying errors.
- **Neural genes:** brain wiring is inherited neuron by neuron. New neurons appear through **gene duplication** (a copy of an existing neuron that splits its output, so behaviour is unchanged at first), as happened in real brain evolution.
- **Continuous speciation:** there is no hard switch. Close relatives of other species can interbreed, and how likely a hybrid is to survive falls off with genetic distance. Lineages drift apart, become reproductively isolated, and get new names in the Tree of Life.

## Minds (C++ → WebAssembly)

- **Network:** a recurrent net with up to 32 neurons, 58 senses and 16 outputs, plus 4 gated memory cells. All brains are evaluated in one batched C++ call per step.
- **Dopamine learning:** each brain predicts how well things will go (a *value* neuron). Surprise, meaning reward minus prediction, is broadcast like dopamine and drives a three-factor Hebbian rule with eligibility traces, so behaviour that led to unexpectedly good outcomes is strengthened.
- **Curiosity gene:** adds a bonus for surprise.
- **Culture:** young creatures near a parent copy part of its *learned* behaviour.
- **Voices:** two voice channels that others hear within range. Alarm calls are detected automatically when they evolve.
- **Vision in C++:** each eye reports plants, prey, threats, kin and walls. The vision kernel bins everything into a spatial grid and caps attention per area.
- **Survival of the smartest (optional):** periodically purges the lowest-scoring creatures of each species (scored on brain complexity, food gathered, offspring, building, learning and survival) and feeds the best so they breed sooner.

## Environment

- **Weather:** wind blows clouds across the map, and thick clouds rain. Rain soaks the soil, and sun and heat dry it. Plants grow and sprout with soil moisture, so wet spells green the land and droughts brown it.
- **Wildfire:** a probabilistic cellular automaton (Alexandridis-style) where p ∝ fuel · dryness · e^(wind·direction) · e^(slope). Lightning ignites dry fuel, fire runs downwind and uphill, rain puts it out, and ash fertilises the soil.
- **Temperature:** falls with altitude (lapse rate), swings with day, night and season, and is moderated near water. A fur gene sets each species' comfort zone, so species spread to mountains or lowlands.
- **Water life:** algae grows in lakes, and fish have their own brains. A habitat gene runs from land to water, so amphibians can evolve.
- **Physics:** bodies have mass, muscle thrust and quadratic drag (water is much denser than air; fish are streamlined and flop on land), and they push each other apart weighted by mass. Falling from a height hurts.
- **Seeds:** animals that eat fruit and plants carry seeds in the gut and drop them elsewhere, so gardens and new trees spring up along their paths.

## Civilisation and conflict

- **3D building:** creatures pick up stone, sand and wood as they move, and their brain decides when to place a wall, or to stack a block on top of a wall in front of them, up to 4–6 levels. Creatures climb one level at a time, so reaching the top needs stairs. Height pays off: the richest fruit hangs in tree canopies and can only be reached from a tower, creatures up high see farther, and attackers have trouble reaching them. Fences one block high can be climbed by anyone, but walls two or more blocks high keep other species out. Blocks go where kin walls already are (termite-style stigmergy), so walls grow into lines, rooms and compounds rather than scattered bricks. Walls next to kin walls are stronger, lone walls crumble, and walls need repairs.
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
