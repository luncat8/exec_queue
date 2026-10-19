/*
 * A coarse clock must not change the simulation: stepping 1 minute at a time
 * and jumping 37 minutes at a time must reach identical state, because every
 * handler schedules the next voyage from the event time, never from the frame
 * clock. Run: node experiments/sim_jump_check.js
 */
'use strict';

const assert = require('assert');
const Sim = require('../sim.js');

const TOTAL = 6000;

function run(step) {
	const sim = new Sim(23);
	while (sim.t < TOTAL) sim.step(Math.min(step, TOTAL - sim.t));
	return sim;
}

function compare(fine, coarse) {
	assert.strictEqual(fine.t.toFixed(6), coarse.t.toFixed(6), 'clock must match');
	assert.strictEqual(fine.processed, coarse.processed, 'processed events must match');
	assert.strictEqual(fine.spawned, coarse.spawned, 'spawned ships must match');
	assert.strictEqual(fine.retired, coarse.retired, 'retired ships must match');
	assert.strictEqual(fine.shipCount, coarse.shipCount, 'fleet size must match');
	assert.strictEqual(fine.delivered.toFixed(6), coarse.delivered.toFixed(6), 'delivered cargo must match');
	for (let i = 0; i < fine.stock.length; i++) {
		assert.strictEqual(fine.stock[i].toFixed(6), coarse.stock[i].toFixed(6), 'stock ' + i + ' must match');
	}
	for (let s = 0; s < Sim.SHIPS; s++) {
		assert.strictEqual(fine.shipAlive[s], coarse.shipAlive[s], 'ship ' + s + ' alive must match');
		if (fine.shipAlive[s] === 0) continue;
		assert.strictEqual(fine.shipCargo[s], coarse.shipCargo[s], 'ship ' + s + ' cargo must match');
		assert.strictEqual(fine.shipTo[s], coarse.shipTo[s], 'ship ' + s + ' destination must match');
		assert.strictEqual(fine.shipDepart[s].toFixed(6), coarse.shipDepart[s].toFixed(6), 'ship ' + s + ' departure must match');
		assert.strictEqual(fine.shipArrive[s].toFixed(6), coarse.shipArrive[s].toFixed(6), 'ship ' + s + ' arrival must match');
		assert.strictEqual(fine.shipHold[s].toFixed(6), coarse.shipHold[s].toFixed(6), 'ship ' + s + ' hold must match');
	}
}

const fine = run(1);
const coarse = run(37);
compare(fine, coarse);
console.log('sim_jump_check: ok, events=' + fine.processed + ' ships=' + fine.shipCount);
