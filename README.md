# Primordia

**A living pixel world where tiny creatures evolve.** Each creature has a genome and a small neural-network brain. They feed, hunt, breed, mutate and split into new species while you watch. You can change the rules of nature as it runs.

▶ **Live:** https://ralpberry-labs.github.io/primordia/

It is plain HTML, CSS and JavaScript with no libraries and no build step. It works on phones too.

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

**Senses (brain inputs):** each eye covers one slice of the field of view. For that slice it reports the nearest plant, prey or meat, threat, and kin. The brain also feels hunger, health, age, pain, speed, crowding, a heartbeat clock, and the glow signals of others nearby.

**Actions (brain outputs):** move, turn, bite, glow, share energy with kin, and breed.

**Learning within a lifetime:** creatures with the plasticity gene adjust their own brain weights as they live. Eating strengthens whatever they were doing, and pain weakens it.

**Speciation:** when a lineage drifts far enough from its species' reference genome, it becomes a new species. The new species usually keeps its genus name, so families of related species appear in the Tree of Life.

## What emerges

No behaviour is scripted. The founders start with only faint instincts, and evolution can rewire or discard them. Things to watch for:

- Grazers forming herds, and hunters forming packs. Bites from kin on the same prey stack together.
- Booms and busts between predators and prey.
- Arms races between armour and jaws, and between speed and eyes.
- Altruism: creatures sharing food with starving relatives.
- Night-time glow "languages", since creatures can sense each other's glow.
- Brains getting larger when you lower the brain cost or raise the neurogenesis bias.

## Controls

- Drag to pan. Scroll or pinch to zoom. **Space** pauses, and **+/−** change speed.
- Tools: **Inspect** (tap a creature to see its genome and its brain firing live), **Food**, **Tree**, **Life** (seed a new species), **Meteor**.
- **Rules** tab: plant growth, fruit, seasons, day/night, mutation rate and size, asexual/sexual breeding, species threshold, metabolism, brain cost, neurogenesis, nutrition, bite strength, aging, population cap, migration.
- Acts of nature: bloom, plague, meteor, new founders.
- Save and load a world in your browser, export species genomes as JSON, and share a world with `?seed=12345`.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. To run the simulation headless and print the evolutionary stats over 30,000 ticks:

```bash
node tools/headless.mjs 42
```

## Code map

- `js/genome.js`: genes, mutation, crossover, genetic distance, body plan, brain layout
- `js/world.js`: terrain, plants, trees, physics, senses, brain evaluation, eating, combat, breeding, species, groups, statistics
- `js/render.js`: pixel-art sprites made from genomes, terrain baking, day/night, glow
- `js/main.js`: UI, charts, tree of life, inspector, brain view, controls

## Inspiration

Primordia draws on artificial-life work like [Polyworld](https://en.wikipedia.org/wiki/Polyworld) by Larry Yaeger (vision feeding a neural network, Hebbian learning, predation, mating), [The Bibites](https://thebibites.itch.io/the-bibites), [evolv.io](https://github.com/wrapperband/evolve.io), and the speciation ideas in [NEAT](https://nn.cs.utexas.edu/downloads/papers/stanley.phd04.pdf). All of the code here is original.

MIT licensed · a Ralpberry Labs toy.
