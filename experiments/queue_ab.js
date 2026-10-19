/*
 * A/B benchmark of every queue implementation in the repo.
 *
 * All four are binary min-heaps, but not the same structure: A2026 keeps
 * time/kind/ref in parallel typed arrays and allocates nothing per event,
 * Beam1 / GLM5.3 / GPT6Luna store one object per event in a plain array.
 * This measures them on one identical event stream, at the queue depths the
 * sea-trade sims actually use as well as at bulk size.
 *
 * Run: node experiments/queue_ab.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---- implementations ------------------------------------------------- */

/* Extract `class EventQueue {...}` from a single-file html by brace counting. */
function extractClass(file, name) {
	const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
	const start = source.indexOf(name);
	if (start < 0) throw new Error(name + ' not found in ' + file);
	let depth = 0;
	let opened = false;
	for (let i = source.indexOf('{', start); i < source.length; i++) {
		const ch = source[i];
		if (ch === '{') {
			depth += 1;
			opened = true;
		} else if (ch === '}') {
			depth -= 1;
			if (opened && depth === 0) return source.slice(start, i + 1);
		}
	}
	throw new Error('unterminated ' + name + ' in ' + file);
}

function classFromFile(file, marker, name) {
	return new Function(extractClass(file, marker) + '\nreturn ' + name + ';')();
}

const typed = require(path.join(ROOT, 'A2026', 'exec_queue.js'));
const beam = require(path.join(ROOT, 'Beam1', 'js', 'queue.js'));
const glm = classFromFile('GLM5.3-sea-trade-queue-demo.html', 'class EventQueue', 'EventQueue');
const gpt = classFromFile('GPT6Luna.html', 'class EventQueue', 'EventQueue');

/*
 * Common shape: push(time, kind, ref), peekTime(), drainUntil(t, fn), size().
 * The object queues are drained with their own peek/pop, exactly as their
 * demo loop does it; the one object per event they allocate is part of their
 * design, not of the harness.
 */
const IMPLS = [
	{
		name: 'A2026 typed arrays',
		create() {
			const q = new typed(1024);
			return {
				push: q.push.bind(q),
				peekTime: q.peekTime.bind(q),
				size: () => q.size,
				drainUntil(target, onEvent) {
					q.drainUntil(target, onEvent);
				}
			};
		}
	},
	{
		name: 'Beam1 objects',
		create() {
			const q = beam();
			return {
				push: (t, k, r) => q.push({ time: t, type: k, ship: r }),
				peekTime: () => {
					const e = q.peek();
					return e ? e.time : Infinity;
				},
				size: () => q.size(),
				drainUntil(target, onEvent) {
					for (;;) {
						const e = q.peek();
						if (!e || e.time > target) return;
						q.pop();
						onEvent(e.time, e.type, e.ship);
					}
				}
			};
		}
	},
	{
		name: 'GLM5.3 objects + fifo',
		create() {
			const q = new glm();
			return {
				push: (t, k, r) => q.push({ t, type: k, ship: r }),
				peekTime: () => {
					const e = q.peek();
					return e ? e.t : Infinity;
				},
				size: () => q.size,
				drainUntil(target, onEvent) {
					for (;;) {
						const e = q.peek();
						if (!e || e.t > target) return;
						q.pop();
						onEvent(e.t, e.type, e.ship);
					}
				}
			};
		}
	},
	{
		name: 'GPT6Luna objects',
		create() {
			const q = new gpt();
			return {
				push: (t, k, r) => q.push({ time: t, type: k, ship: r }),
				peekTime: () => {
					const e = q.peek();
					return e ? e.time : Infinity;
				},
				size: () => q.items.length,
				drainUntil(target, onEvent) {
					for (;;) {
						const e = q.peek();
						if (!e || e.time > target) return;
						q.pop();
						onEvent(e.time, e.type, e.ship);
					}
				}
			};
		}
	}
];

/* ---- identical event streams ---------------------------------------- */

function stream(count, horizon) {
	let seed = 987654321;
	const times = new Float64Array(count);
	const kinds = new Uint8Array(count);
	const refs = new Uint32Array(count);
	for (let i = 0; i < count; i++) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		times[i] = seed % horizon;
		kinds[i] = (seed >>> 20) & 1;
		refs[i] = i;
	}
	return { times, kinds, refs };
}

/*
 * Bulk: push everything, then drain everything - the deepest heaps and the
 * worst case for insertion (random order).
 */
function bulk(impl, events, count) {
	const q = impl.create();
	let checksum = 0;
	let last = -Infinity;
	const start = process.hrtime.bigint();
	for (let i = 0; i < count; i++) q.push(events.times[i], events.kinds[i], events.refs[i]);
	q.drainUntil(Infinity, (time, kind, ref) => {
		if (time < last) throw new Error(impl.name + ': heap order broken');
		last = time;
		checksum = (checksum + time * 7 + kind * 13 + ref) | 0;
	});
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, checksum, ops: count * 2 };
}

/*
 * Sim shape: the clock advances and one event arrives per step, so the heap
 * stays around `depth` entries - what the demos really do at any speed.
 */
function steady(impl, depth, steps) {
	const q = impl.create();
	const rng = mulberry32(4242);
	let time = 0;
	let checksum = 0;
	const start = process.hrtime.bigint();
	for (let step = 0; step < steps; step++) {
		time += 1 + rng() * 3;
		q.push(time + rng() * 40, 1, step & 63);
		q.drainUntil(time, (t, kind, ref) => {
			checksum = (checksum + t * 7 + kind * 13 + ref) | 0;
		});
	}
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, checksum, ops: steps * 2 };
}

/* Deep pile drained by few big jumps - the time-slider at maximum. */
function burst(impl, depth, bursts) {
	const q = impl.create();
	const rng = mulberry32(777);
	let time = 0;
	let checksum = 0;
	const start = process.hrtime.bigint();
	for (let b = 0; b < bursts; b++) {
		for (let i = 0; i < depth; i++) q.push(time + rng() * depth * 2, i & 1, i);
		time += depth * 2;
		q.drainUntil(time, (t, kind, ref) => {
			checksum = (checksum + t * 7 + kind * 13 + ref) | 0;
		});
	}
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, checksum, ops: depth * bursts * 2 };
}

function mulberry32(a) {
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/* ---- report ---------------------------------------------------------- */

function table(title, workload, results) {
	const best = Math.min(...results.map(r => r.ms));
	const lines = ['\n' + title];
	lines.push('impl'.padEnd(24) + 'ms'.padStart(10) + 'ops/s'.padStart(12) + 'rel'.padStart(8) + '  checksum');
	for (const r of results) {
		lines.push(
			r.name.padEnd(24) +
			r.ms.toFixed(2).padStart(10) +
			Math.round(r.ops / r.ms * 1000).toLocaleString('en-US').padStart(12) +
			('x' + (r.ms / best).toFixed(2)).padStart(8) +
			'  ' + r.checksum
		);
	}
	return lines.join('\n');
}

function bestOf(workload, perImpl) {
	const out = [];
	for (const impl of IMPLS) {
		const first = workload(impl);
		const best = Math.min(first.ms, workload(impl).ms, workload(impl).ms);
		out.push({ name: impl.name, ms: best, checksum: first.checksum, ops: first.ops });
	}
	return out;
}

const BULK = 200000;
const bulkEvents = stream(BULK, BULK);
const bulkResults = bestOf(impl => bulk(impl, bulkEvents, BULK));
const steadyResults = bestOf(impl => steady(impl, 64, 400000));
const burstResults = bestOf(impl => burst(impl, 2000, 150));

for (const [name, results] of [
	['bulk 200k random times, then drain all', bulkResults],
	['steady depth 64, 400k clock steps (sim shape)', steadyResults],
	['burst depth 2000, 150 jumps (max speed)', burstResults]
]) {
	const checksums = new Set(results.map(r => r.checksum));
	if (checksums.size !== 1) throw new Error(name + ': implementations disagree: ' + [...checksums]);
}

const text = [
	'# queue A/B, node ' + process.version + ', best of 3 runs',
	table('bulk 200k random times, then drain all', null, bulkResults),
	table('steady depth 64, 400k clock steps (sim shape)', null, steadyResults),
	table('burst depth 2000, 150 jumps (max speed)', null, burstResults)
].join('\n') + '\n';

console.log(text.trimEnd());
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'logs', 'queue-ab.log'), text);