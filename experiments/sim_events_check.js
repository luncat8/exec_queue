/*
 * Event-model invariants: every living ship has exactly one current ship event,
 * no event is scheduled in the past, and a port request made while the fleet
 * is full is deferred rather than dropped. Run: node experiments/sim_events_check.js
 */
'use strict';

const assert = require('assert');
const Sim = require('../sim.js');

function countArrivals(sim, ship) {
	let count = 0;
	const kinds = sim.events.kind;
	const refs = sim.events.ref;
	for (let i = 0; i < sim.events.size; i++) {
		if ((kinds[i] === Sim.KIND_ARRIVE || kinds[i] === Sim.KIND_LOAD || kinds[i] === Sim.KIND_UNLOAD) &&
			refs[i] === ship && sim.events.revision[i] === sim.shipRevision[ship]) count += 1;
	}
	return count;
}

function countKind(sim, kind, ref) {
	let count = 0;
	for (let i = 0; i < sim.events.size; i++) {
		if (sim.events.kind[i] === kind && sim.events.ref[i] === ref) count += 1;
	}
	return count;
}

function checkInvariants(sim) {
	assert(sim.events.peekTime() >= sim.t, 'no event may sit in the past at t=' + sim.t);
	for (let ship = 0; ship < Sim.SHIPS; ship++) {
		if (sim.shipAlive[ship] === 0) continue;
		assert.strictEqual(countArrivals(sim, ship), 1, 'living ship ' + ship + ' must have one current event');
		if (sim.shipState[ship] === Sim.SAILING) assert(sim.shipArrive[ship] >= sim.t, 'ship ' + ship + ' arrival must be in the future');
	}
	// one self-rescheduling consumption tick per port, never two
	for (let port = 0; port < Sim.PORTS; port++) {
		assert.strictEqual(countKind(sim, Sim.KIND_CONSUME, port), 1, 'port ' + port + ' must have one consume tick');
	}
	assert(sim.logCount <= Sim.LOG, 'event log ring must stay bounded');
	// the cap gates spawns only: a lowered cap drains the fleet by retirement
	assert(sim.shipCount <= Sim.SHIPS, 'fleet must stay inside the slot array');
}

const sim = new Sim(5);
while (sim.shipCount < Sim.SHIPS) sim.step(5);
checkInvariants(sim);

const requested = [];
const dispatch = sim.dispatch.bind(sim);
sim.dispatch = function (time, port) {
	const before = sim.spawned;
	dispatch(time, port);
	if (sim.spawned > before && port !== Sim.NO_PORT) requested.push(port);
};
sim.requestShip(3);
let waited = 0;
while (requested.length === 0 && waited < 500) {
	sim.step(1);
	waited += 1;
	checkInvariants(sim);
}
assert.deepStrictEqual(requested, [3], 'the click must dispatch from port 3 once a slot frees');
assert(waited > 0, 'a full fleet must defer the click instead of spawning immediately');
assert(sim.shipCount >= 1);

const shipped = sim.spawned;
for (let minute = 0; minute < 3000; minute += 7) {
	sim.step(7);
	checkInvariants(sim);
}
assert(sim.spawned > shipped, 'retirements must keep being replaced');
assert(sim.consumed > 0, 'ports must consume part of their stock');

// lowering the cap stops new spawns; the fleet drains as ships retire
sim.setFleet(4);
let peak = sim.shipCount;
for (let minute = 0; minute < 4000; minute += 11) {
	sim.step(11);
	assert(sim.shipCount <= peak, 'lowering the cap must not spawn more ships, got ' + sim.shipCount);
	peak = Math.max(peak, sim.shipCount);
	checkInvariants(sim);
}
assert(sim.shipCount <= 4, 'the fleet must drain to the lowered cap, got ' + sim.shipCount);
sim.setFleet(Sim.SHIPS);
for (let minute = 0; minute < 2000; minute += 11) {
	sim.step(11);
	checkInvariants(sim);
}
assert(sim.shipCount > 4, 'raising the cap must let the queued dispatch requests through');

console.log('sim_events_check: ok, deferred click served after ' + waited + ' min, events=' + sim.processed +
	', consumed=' + Math.round(sim.consumed));
