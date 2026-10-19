/* Correctness checks for exec_queue.js. Run: node experiments/queue_check.js */
'use strict';

const assert = require('assert');
const ExecQueue = require('../exec_queue.js');

function randomEvents(count) {
	let seed = 1234567;
	const rand = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	const events = [];
	for (let i = 0; i < count; i++) {
		events.push({ time: Math.floor(rand() * 10000), ref: i });
	}
	return events;
}

function checkOrdering() {
	const events = randomEvents(5000);
	const queue = new ExecQueue(4);
	for (const event of events) queue.push(event.time, 0, event.ref);
	let last = -Infinity;
	let count = 0;
	queue.drainUntil(Infinity, (time) => {
		assert(time >= last, 'events must be processed in time order');
		last = time;
		count += 1;
	});
	assert.strictEqual(count, events.length, 'every event must be processed exactly once');
	assert.strictEqual(queue.size, 0, 'queue must be empty after draining');
}

function checkDraftScenario() {
	// delivery ship arrives at 10, two loaders at 11 and 12 take the cargo.
	const queue = new ExecQueue(8);
	const names = ['delivery', 'loader a', 'loader b'];
	const log = [];
	queue.push(10, 0, 0);
	queue.push(11, 0, 1);
	queue.push(12, 0, 2);
	queue.drainUntil(12, (time, kind, ref) => log.push(time + ' ' + names[ref]));
	assert.deepStrictEqual(log, ['10 delivery', '11 loader a', '12 loader b']);
}

function checkChainingAcrossJump() {
	// handler reschedules itself 5 sim minutes later; a single 100 minute jump
	// must run 20 chained events, each starting from its own event time.
	const queue = new ExecQueue(8);
	const seen = [];
	queue.push(3, 0, 0);
	queue.drainUntil(100, (time, kind, ref) => {
		seen.push(time);
		if (ref < 30) queue.push(time + 5, 0, ref + 1);
	});
	assert.deepStrictEqual(seen, [3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93, 98]);
	assert.strictEqual(queue.peekTime(), 103, 'event beyond the jump target must stay queued');
}

function checkGrowth() {
	const queue = new ExecQueue(1);
	for (let i = 0; i < 1000; i++) queue.push(1000 - i, 0, i);
	let last = -Infinity;
	let count = 0;
	queue.drainUntil(Infinity, (time) => {
		assert(time >= last);
		last = time;
		count += 1;
	});
	assert.strictEqual(count, 1000);
}

checkOrdering();
checkDraftScenario();
checkChainingAcrossJump();
checkGrowth();
console.log('queue_check: ok');
