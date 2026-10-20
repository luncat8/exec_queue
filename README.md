# exec_queue

A time-ordered discrete-event queue (binary min-heap over typed arrays) and a
sea-trade demo built on it. Open `index.html` directly (`file://`): classic
scripts, no build step, no dependencies.

## demo

Six ports trade three goods (grain, timber, iron). Each port draws three
horizontal supply bars by default and eats part of its own stock every ten minutes. A ship
loads one good, sails, docks, unloads, and loads before its next voyage. Ships wait at the port when
no good has at least six units available.
Every arrival, load, unload, dispatch and consumption is an event in the min-heap keyed by
its time; handlers start the next voyage from that event time, not from the
frame clock.

- `continuous` / `jump` — smooth frame stepping, or the clock advances in fixed
  30-minute jumps. One jump can process many voyages at once.
- speed slider — simulation minutes per real second (1–1000). In jump mode it
  sets how often a 30-minute step happens.
- fleet slider — cap on ships (4–30). A request that finds the fleet full waits
  in the queue instead of vanishing.
- **ship options** — GLM-style ships/stock bars, route lines, and docking are
  enabled by default. Optional position smoothing restores the old trailing
  effect; leave it off for exact straight-line travel. Changing docking resets
  the simulation; disabling it restores instant turnaround and empty voyages.
- click a ship, choose a destination, and press **reroute**, or **sink ship**.
  Rerouting starts from its current world position and retains cargo. Sinking
  discards cargo and removes the ship (no automatic replacement).
- click a port to dispatch a ship (deferred until a slot frees); `space` pauses;
  `j` jumps 30 minutes; `reset` reseeds.

HUD: time, queue length, processed events, fleet, delivered units, consumed
units, next event, a 20-minute timeline of queued events, and a live event log.

## queue

`exec_queue.js` stores `time / kind / ref / revision` in parallel typed arrays and keeps
them heap-ordered. Handlers may push new events while a batch is being drained.

```js
const queue = new ExecQueue(64);
queue.push(time, kind, ref, revision);      // O(log n)
queue.peekTime();                 // earliest time, Infinity when empty
queue.drainUntil(target, handler); // pops every event with time <= target
queue.size;
```

The handler receives `(time, kind, ref, revision)`. Ship events carry a revision
checked against the slot's current revision and alive flag. Rerouting schedules
one new event; sinking invalidates the old one. Obsolete entries remain in the
heap until due, then are skipped without delivery or follow-up events. Revisions
persist across slot reuse. Queue size includes stale entries; the timeline hides
them. Port events use revision zero.

A sorted array needs an O(n) memmove per insertion. `experiments/queue_bench.js`
measures both for 50,000 events (13x faster for push + drain), and
`experiments/queue_ab.js` compares every queue in this repo on one event stream.

## simulation

`sim.js` owns all state: six ports, 30 ship slots, three goods. Each ship has
exactly one current ship event (arrival, load, or unload), each port one consumption tick. Production
accrues between events (`produce(time - t)` inside the event handler), so a
37-minute jump produces exactly the same state as 37 one-minute steps — checked
by `experiments/sim_jump_check.js`.

## files

- `exec_queue.js` — the queue
- `sim.js` — headless sea-trade simulation
- `gui.js` — canvas renderer and controls
- `index.html`, `style.css` — the page
- `experiments/` — node checks, benchmarks, headless GUI smoke test
- `archive/` — plans, worklogs, the implementation comparison

### implementations

The root demo is the best of four builds; the others are kept for reference and
still run:

- `A2026/` — the previous root implementation, archived as a whole (page, three
  modules, its experiments and its logs)
- `Beam1/Beam-1.html` — array-of-objects heap, single good, `js/queue.js`
- `GLM5.3-sea-trade-queue-demo.html` — five goods, produce/spawn events, log
- `GPT6Luna.html` — four ports, three ships, stock chart

`archive/0.2.0-comparison.md` has the side-by-side, the defects found in each
one and the queue benchmark.

## checks

```sh
node experiments/queue_check.js
node experiments/queue_bench.js
node experiments/queue_ab.js
node experiments/sim_jump_check.js
node experiments/sim_events_check.js
node experiments/sim_measure.js
node experiments/gui_smoke.js
```