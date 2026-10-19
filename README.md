# exec_queue

A time-ordered discrete-event queue (binary min-heap over typed arrays) and a
sea-trade demo built on it. Open `index.html` directly (`file://`): classic
scripts, no build step, no dependencies.

## demo

Six ports trade three goods (r, g, b). Each port draws three vertical supply
bars. A ship loads one good, sails, unloads, and immediately calculates its next
voyage. Every arrival is an event in the min-heap keyed by its arrival time; the
handler starts the next voyage from that event time, not from the frame clock.

- `continuous` / `jump` — smooth frame stepping, or the clock advances in fixed
  30-minute jumps. One jump can process many voyages at once.
- slider — simulation minutes per real second (1–1000). In jump mode it sets how
  often a 30-minute step happens.
- click a port to dispatch a ship (deferred until a slot frees if the fleet is
  full); `space` pauses; `j` jumps 30 minutes; `reset` reseeds.

HUD: time queue length, processed events, ships, delivered units, next event.

## queue

`exec_queue.js` stores `time / kind / ref` in parallel typed arrays and keeps
them heap-ordered. Handlers may push new events while a batch is being drained.

```js
const queue = new ExecQueue(64);
queue.push(time, kind, ref);      // O(log n)
queue.peekTime();                 // earliest time, Infinity when empty
queue.drainUntil(target, handler); // pops every event with time <= target
queue.size;
```

A sorted array needs an O(n) memmove per insertion. `experiments/queue_bench.js`
measures both for 50,000 events: the heap is about 13x faster for push + drain.

## simulation

`sim.js` owns all state: six ports, 30 ship slots, three goods. Each ship has
exactly one future arrival event. Ports schedule dispatch events for replacement
ships. Production accrues between events (`produce(time - t)` inside the event
handler), so a 37-minute jump produces exactly the same state as 37 one-minute
steps — checked by `experiments/sim_jump_check.js`.

## files

- `exec_queue.js` — the queue
- `sim.js` — headless sea-trade simulation
- `gui.js` — canvas renderer and controls
- `experiments/` — node checks, benchmarks, headless GUI smoke test
- `archive/` — plan and worklog

## checks

```sh
node experiments/queue_check.js
node experiments/queue_bench.js
node experiments/sim_jump_check.js
node experiments/sim_events_check.js
node experiments/sim_measure.js
node experiments/gui_smoke.js
```
