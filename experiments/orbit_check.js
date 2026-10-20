/*
 * Orbital trade invariants: ellipse rendezvous, nearest-N links, colony growth
 * and event-time independence. Run: node experiments/orbit_check.js
 */
'use strict';

const assert = require('assert');
const Sim = require('../orbit_sim.js');

function checkPorts(sim) {
	assert(sim.portCount <= Sim.PLANETS, 'ports must fit planets');
	let activePlanets = 0;
	for (let planet = 0; planet < Sim.PLANETS; planet++) {
		const state = sim.planetState[planet];
		assert(state === 0 || state === 1 || state === 2, 'bad planet state');
		if (state === 1) activePlanets += 1;
	}
	assert.strictEqual(activePlanets, sim.portCount, 'active planet count must match ports');
	assert.strictEqual(
		sim.planetEmpty + sim.reserved + sim.portCount,
		Sim.PLANETS,
		'planet states must partition the map'
	);
	assert.strictEqual(sim.shipCount, sim.portCount, 'one ship per port');
	for (let p = 0; p < sim.portCount; p++) {
		const planet = sim.portPlanet[p];
		assert.strictEqual(sim.planetPort[planet], p, 'planet port backlink');
		assert.strictEqual(sim.planetState[planet], 1, 'port planet must be active');
		assert(sim.portProgress[p] >= 0, 'progress must stay non-negative');
		assert(Number.isFinite(sim.portStock[p * Sim.GOODS + sim.portSpec[p]]), 'finite stock');
	}
}

function checkShips(sim) {
	for (let ship = 0; ship < sim.shipCount; ship++) {
		const target = sim.shipTarget[ship];
		if (sim.shipState[ship] === 0) {
			assert(sim.shipDock[ship] < sim.portCount, 'docked ship needs a port');
			continue;
		}
		assert.strictEqual(sim.shipState[ship], 1, 'bad ship state');
		assert(target < sim.portCount, 'sailing ship needs a target port');
		assert(sim.shipArrive[ship] > sim.t - 1e-9, 'sailing ship must arrive in the future');
		assert.strictEqual(
			sim.shipAimX[ship],
			sim.portX(target, sim.shipArrive[ship]),
			'cached aim x must match the ellipse at arrival'
		);
		assert.strictEqual(
			sim.shipAimY[ship],
			sim.portY(target, sim.shipArrive[ship]),
			'cached aim y must match the ellipse at arrival'
		);
	}
}

function checkLinks(sim) {
	for (let p = 0; p < sim.portCount; p++) {
		const count = sim.partnerCount[p];
		const expected = Math.min(sim.partnerN, sim.portCount - 1);
		assert.strictEqual(count, expected, 'partner count must be nearest N');
		const base = p * Sim.MAX_LINKS;
		for (let k = 0; k < count; k++) {
			const q = sim.partners[base + k];
			assert(q !== Sim.NO_PORT && q !== p && q < sim.portCount,
				'partner must be another active port');
		}
	}
}

function checkNearest(sim) {
	sim.refreshPartners();
	for (let p = 0; p < sim.portCount; p++) {
		const px = sim.portX(p, sim.t);
		const py = sim.portY(p, sim.t);
		const order = [];
		for (let q = 0; q < sim.portCount; q++) {
			if (q === p) continue;
			const dx = px - sim.portX(q, sim.t);
			const dy = py - sim.portY(q, sim.t);
			order.push({ q, d: dx * dx + dy * dy });
		}
		order.sort((a, b) => a.d - b.d);
		const base = p * Sim.MAX_LINKS;
		for (let k = 0; k < sim.partnerCount[p]; k++) {
			assert.strictEqual(sim.partners[base + k], order[k].q,
				'nearest-N list must be distance-sorted');
		}
	}
}

const sim = new Sim(9);
assert.strictEqual(sim.portCount, Sim.INITIAL_PORTS, 'initial port count');
assert.strictEqual(sim.planetEmpty, Sim.PLANETS - Sim.INITIAL_PORTS, 'initial empty planets');
assert.strictEqual(sim.events.size, 1 + Sim.INITIAL_PORTS, 'one load per port plus the tick');
checkPorts(sim);
checkLinks(sim);
checkNearest(sim);

let lastSent = 0;
for (let minute = 0; minute < 1500; minute++) {
	sim.step(1);
	checkPorts(sim);
	checkShips(sim);
	if (sim.coloniesSent === lastSent) continue;
	for (let p = 0; p < sim.portCount; p++) {
		if (sim.builderActive[p] === 0) continue;
		const dx = sim.builderStartX[p] - sim.builderEndX[p];
		const dy = sim.builderStartY[p] - sim.builderEndY[p];
		const distance = Math.sqrt(dx * dx + dy * dy);
		assert(distance <= Sim.EXPAND_RADIUS + 1e-6,
			'colony target must be inside the port radius');
		assert.strictEqual(sim.planetState[sim.builderTarget[p]], 2,
			'target planet must be reserved');
	}
	lastSent = sim.coloniesSent;
}
checkLinks(sim);
checkNearest(sim);
assert.strictEqual(sim.maxAimError, 0, 'fixed-point rendezvous must land exactly');
assert(sim.routes > 300, 'ships must keep sailing');
assert(sim.delivered > 10000, 'trade must deliver cargo');
assert(sim.coloniesBuilt >= 12, 'trade must grow the network');
assert(sim.portCount >= 20, 'late run must have most planets settled');
assert(sim.planetEmpty >= 0 && sim.planetEmpty <= Sim.PLANETS - Sim.INITIAL_PORTS, 'empty count');
console.log('sim: ' + sim.portCount + ' ports, ' + sim.coloniesBuilt + ' colonies, ' +
	sim.routes + ' routes, ' + Math.round(sim.delivered) + ' delivered, aim error 0');

/* changing N rewires the same port without touching the rest of the world */
const before = sim.partnerCount[0];
sim.setPartners(2);
assert.strictEqual(sim.partnerCount[0], Math.min(2, sim.portCount - 1));
sim.setPartners(6);
assert.strictEqual(sim.partnerCount[0], Math.min(6, sim.portCount - 1));
sim.setPartners(4);
assert.strictEqual(sim.partnerCount[0], before);
checkLinks(sim);

/* the clock is only a target: one jump and many small steps must agree */
function fingerprint(world) {
	const parts = [
		world.t, world.portCount, world.planetEmpty, world.reserved, world.builders,
		world.routes, world.coloniesSent, world.coloniesBuilt, world.delivered,
		world.shipCount, world.events.size, world.logHead, world.maxAimError
	];
	for (let i = 0; i < world.portCount * Sim.GOODS; i++) {
		parts.push(world.portStock[i].toFixed(9));
	}
	for (let i = 0; i < world.portCount; i++) {
		parts.push(world.portProgress[i].toFixed(9));
	}
	for (let i = 0; i < world.shipCount; i++) {
		parts.push(world.shipState[i]);
		parts.push(world.shipAimX[i].toFixed(9));
		parts.push(world.shipAimY[i].toFixed(9));
	}
	return parts.join(',');
}

const smallSteps = new Sim(21);
for (let minute = 0; minute < 900; minute++) smallSteps.step(1);
const bigSteps = new Sim(21);
for (let step = 0; step < 25; step++) bigSteps.step(36);
const singleJump = new Sim(21);
singleJump.step(900);
assert.strictEqual(fingerprint(smallSteps), fingerprint(bigSteps),
	'36-minute steps must match one-minute steps');
assert.strictEqual(fingerprint(smallSteps), fingerprint(singleJump),
	'one jump must match one-minute steps');
console.log('jump: 900 minutes identical at 1, 36 and 900 minute steps');
console.log('orbit check ok');
