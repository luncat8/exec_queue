/*
 * Headless measurement of the orbital demo: expansion pace, trade throughput,
 * queue depth and the cost of a realistic frame loop. Prints one compact block
 * for experiments/logs/orbit.log. Run: node experiments/orbit_measure.js
 */
'use strict';

const Sim = require('../orbit_sim.js');

function colonisation(seed) {
	const sim = new Sim(seed);
	const marks = [];
	let built = 0;
	for (let minute = 1; minute <= 900; minute++) {
		sim.step(1);
		while (built < sim.coloniesBuilt) {
			built += 1;
			marks.push(minute);
		}
	}
	return { sim, marks };
}

for (const seed of [1, 2, 3, 7, 9]) {
	const { sim, marks } = colonisation(seed);
	const at = minutes => marks.filter(mark => mark <= minutes).length;
	const gaps = marks.map((mark, i) => i === 0 ? mark : mark - marks[i - 1]);
	const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
	console.log('seed ' + seed +
		' | ports 8→' + sim.portCount +
		' | colonies at 2h ' + at(120) + ', 4h ' + at(240) + ', 8h ' + at(480) + ', 15h ' + at(900) +
		' | avg ' + averageGap.toFixed(1) + ' min/colony' +
		' | routes ' + sim.routes +
		' | delivered ' + Math.round(sim.delivered) +
		' | aim ' + sim.maxAimError +
		' | queue peak ' + sim.queuePeak);
}

/* a realistic frame: 60 fps at speed 3 for one real minute */
const frameSim = new Sim(7);
const started = process.hrtime.bigint();
for (let frame = 0; frame < 3600; frame++) frameSim.step(3 * 16.7 / 1000);
const frameMs = Number(process.hrtime.bigint() - started) / 1e6;
console.log('frames 3600 (' + (3600 * 16.7 / 1000).toFixed(0) + ' sim minutes)' +
	' | step total ' + frameMs.toFixed(1) + ' ms' +
	' | ' + (frameMs / 3600 * 1000).toFixed(1) + ' µs/frame' +
	' | events ' + frameSim.processed +
	' | ports ' + frameSim.portCount);

/* long run: the queue must stay bounded while the network is saturated */
const longSim = new Sim(7);
const longStart = process.hrtime.bigint();
for (let step = 0; step < 400; step++) longSim.step(60);
const longMs = Number(process.hrtime.bigint() - longStart) / 1e6;
console.log('long 24000 minutes | ports ' + longSim.portCount +
	' | colonies ' + longSim.coloniesBuilt +
	' | routes ' + longSim.routes +
	' | delivered ' + Math.round(longSim.delivered) +
	' | queue now ' + longSim.events.size + ' peak ' + longSim.queuePeak +
	' | sim time ' + longMs.toFixed(0) + ' ms');
