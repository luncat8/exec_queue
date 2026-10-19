/*
 * Min-heap queue vs sorted-array queue: push + drain throughput.
 * Run: node experiments/queue_bench.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ExecQueue = require('../exec_queue.js');

const COUNT = 50000;

function makeEvents(count) {
	let seed = 987654321;
	const times = new Float64Array(count);
	const refs = new Uint32Array(count);
	for (let i = 0; i < count; i++) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		times[i] = seed % 1000000;
		refs[i] = i;
	}
	return { times, refs };
}

function runHeap(events) {
	const queue = new ExecQueue(1024);
	const start = process.hrtime.bigint();
	for (let i = 0; i < COUNT; i++) queue.push(events.times[i], 0, events.refs[i]);
	let last = -Infinity;
	let checksum = 0;
	queue.drainUntil(Infinity, (time, kind, ref) => {
		if (time < last) throw new Error('heap ordering broken');
		last = time;
		checksum += ref;
	});
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, checksum };
}

function runSortedArray(events) {
	const times = new Float64Array(COUNT);
	const refs = new Uint32Array(COUNT);
	let size = 0;
	const start = process.hrtime.bigint();
	for (let i = 0; i < COUNT; i++) {
		const time = events.times[i];
		let lo = 0;
		let hi = size;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (times[mid] <= time) lo = mid + 1;
			else hi = mid;
		}
		times.copyWithin(lo + 1, lo, size);
		refs.copyWithin(lo + 1, lo, size);
		times[lo] = time;
		refs[lo] = events.refs[i];
		size += 1;
	}
	let last = -Infinity;
	let checksum = 0;
	for (let i = 0; i < COUNT; i++) {
		if (times[i] < last) throw new Error('sorted-array ordering broken');
		last = times[i];
		checksum += refs[i];
	}
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, checksum };
}

const events = makeEvents(COUNT);
runHeap(events);
runSortedArray(events); // warm up
const heap = runHeap(events);
const sorted = runSortedArray(events);

if (heap.checksum !== sorted.checksum) throw new Error('implementations disagree');

const lines = [
	'# queue bench, node ' + process.version + ', events=' + COUNT + ' (push + drain)',
	'min-heap ms=' + heap.ms.toFixed(3) + ' ops_per_s=' + Math.round(COUNT * 2 / heap.ms * 1000),
	'sorted-array ms=' + sorted.ms.toFixed(3) + ' ops_per_s=' + Math.round(COUNT * 2 / sorted.ms * 1000),
	'speedup x' + (sorted.ms / heap.ms).toFixed(1)
];
const text = lines.join('\n') + '\n';
console.log(text.trimEnd());
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'logs', 'queue-bench.log'), text);
