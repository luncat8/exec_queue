/*
 * Headless run: checks queue invariants and samples stock/queue behaviour.
 * Run: node experiments/sim_measure.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Sim = require('../sim.js');

const SIM_MINUTES = 20000;
const STEP = 5;

const sim = new Sim(11);
const started = process.hrtime.bigint();
let minStock = Infinity;
let maxStock = -Infinity;
let sumStock = 0;
let samples = 0;
let belowQuarter = 0;
let belowHalf = 0;
let belowThreeQuarters = 0;
let minQueue = Infinity;
let maxQueue = 0;
let sumQueue = 0;
let stepSamples = 0;
const emptyBins = [];

for (let minute = 0; minute < SIM_MINUTES; minute += STEP) {
	sim.step(STEP);
	const pending = sim.events.peekTime();
	if (pending < sim.t) throw new Error('pending event in the past at ' + sim.t);
	for (let s = 0; s < Sim.SHIPS; s++) {
		if (sim.shipAlive[s] === 0) continue;
		if (sim.shipArrive[s] < sim.t) throw new Error('ship arrival in the past at ' + sim.t);
		if (sim.shipArrive[s] <= sim.shipDepart[s]) throw new Error('ship without travel time');
	}
	const stocks = sim.stock;
	let empties = 0;
	for (let i = 0; i < stocks.length; i++) {
		const value = stocks[i];
		if (value < minStock) minStock = value;
		if (value > maxStock) maxStock = value;
		sumStock += value;
		samples += 1;
		if (value < 5) empties += 1;
		if (value < Sim.STOCK_MAX * 0.25) belowQuarter += 1;
		if (value < Sim.STOCK_MAX * 0.5) belowHalf += 1;
		if (value < Sim.STOCK_MAX * 0.75) belowThreeQuarters += 1;
	}
	const queueSize = sim.events.size;
	if (queueSize < minQueue) minQueue = queueSize;
	if (queueSize > maxQueue) maxQueue = queueSize;
	sumQueue += queueSize;
	stepSamples += 1;
	if (empties > 0) emptyBins.push(minute + ':' + empties);
}

const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
const report = [
	'# sim measure, seed=11, minutes=' + SIM_MINUTES + ', step=' + STEP,
	'cpu_ms=' + elapsedMs.toFixed(1),
	'events=' + sim.processed + ' events_per_sim_min=' + (sim.processed / SIM_MINUTES).toFixed(3),
	'events_per_cpu_s=' + Math.round(sim.processed / elapsedMs * 1000),
	'ships_alive=' + sim.shipCount + ' spawned=' + sim.spawned + ' retired=' + sim.retired,
	'delivered=' + Math.round(sim.delivered) + ' delivered_per_sim_min=' + (sim.delivered / SIM_MINUTES).toFixed(2),
	'queue_min=' + minQueue + ' queue_avg=' + (sumQueue / stepSamples).toFixed(2) + ' queue_max=' + maxQueue + ' queue_peak=' + sim.queuePeak,
	'stock_min=' + minStock.toFixed(1) + ' stock_avg=' + (sumStock / samples).toFixed(1) + ' stock_max=' + maxStock.toFixed(1),
	'stock_fill_pct=' + (sumStock / samples / Sim.STOCK_MAX * 100).toFixed(1) +
		' lt25=' + (belowQuarter / samples * 100).toFixed(1) +
		' lt50=' + (belowHalf / samples * 100).toFixed(1) +
		' lt75=' + (belowThreeQuarters / samples * 100).toFixed(1),
	'empty_steps=' + emptyBins.length + ' of ' + stepSamples + ' (' + (emptyBins.length / stepSamples * 100).toFixed(1) + '%)',
	'empty_first=' + (emptyBins.slice(0, 8).join(' ') || 'none')
];
const text = report.join('\n') + '\n';
console.log(text.trimEnd());
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'logs', 'sim-measure.log'), text);
