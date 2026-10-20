'use strict';
const assert = require('assert');
const Sim = require('../sim.js');
const ExecQueue = require('../exec_queue.js');

// Revisions survive heap growth, sifting and handler-triggered pushes.
const queue = new ExecQueue(1);
for (let i = 80; i >= 0; i--) queue.push(i, 1, i, i + 100);
queue.drainUntil(100, (time, kind, ref, revision) => {
	assert.strictEqual(revision, ref + 100);
	assert.strictEqual(time, ref);
});

const sim = new Sim(7);
sim.events.clear();
sim.dispatch(0, 0);
assert.notStrictEqual(sim.shipState[0], Sim.SAILING);
sim.step(0.4);
assert.strictEqual(sim.shipState[0], Sim.SAILING);
sim.step(1);
const before = {};
const after = {};
sim.position(0, before);
const oldTime = sim.shipArrive[0];
const oldRevision = sim.shipRevision[0];
const oldDest = sim.shipTo[0];
assert(sim.reroute(0, (oldDest + 1) % Sim.PORTS));
sim.position(0, after);
assert(Math.abs(before.x - after.x) < 1e-9);
assert(Math.abs(before.y - after.y) < 1e-9);
assert(sim.shipRevision[0] > oldRevision);
const delivered = sim.delivered;
sim.handleEvent(oldTime, Sim.KIND_ARRIVE, 0, oldRevision);
assert.strictEqual(sim.delivered, delivered);
assert.strictEqual(sim.skipped, 1);
const staleRevision = sim.shipRevision[0];
assert(sim.sinkShip(0));
assert(!sim.sinkShip(0));
assert.strictEqual(sim.shipCount, 0);
sim.dispatch(sim.t, 2);
assert.strictEqual(sim.shipCount, 1);
sim.handleEvent(sim.t, Sim.KIND_ARRIVE, 0, staleRevision);
assert.strictEqual(sim.skipped, 2, 'recycled slots reject old events');
sim.step(100);
assert(sim.skipped >= 4, 'stale heap entries are eventually drained');

const waiting = new Sim(2);
waiting.events.clear();
waiting.stock.fill(0);
waiting.production.fill(0);
waiting.dispatch(0, 0);
waiting.step(2);
assert.strictEqual(waiting.shipState[0], 3);
assert.strictEqual(waiting.shipFrom[0], 0);
waiting.stock[0] = 20;
waiting.step(0.5);
assert.strictEqual(waiting.shipState[0], Sim.SAILING);
assert.strictEqual(waiting.shipHold[0], 20);

const instant = new Sim(7, false);
instant.events.clear();
instant.dispatch(0, 0);
assert.strictEqual(instant.shipState[0], Sim.SAILING);
instant.step(100);
assert(instant.delivered > 0);
console.log('sim_updates_check: ok, revisions, reroute continuity, sinking, reuse, waiting, instant mode');
