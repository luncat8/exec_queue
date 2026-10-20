/*
 * Discrete-event time queue: binary min-heap over parallel typed arrays.
 * push/pop allocate nothing once capacity is reached. Equal timestamps are
 * intentionally unordered; simultaneity has no meaning for the simulation.
 */
(function (root) {
	'use strict';

	function ExecQueue(capacity) {
		const cap = capacity || 64;
		this.time = new Float64Array(cap);
		this.kind = new Uint8Array(cap);
		this.ref = new Uint32Array(cap);
		this.revision = new Uint32Array(cap);
		this.size = 0;
	}

	ExecQueue.prototype.grow = function () {
		const cap = this.time.length * 2;
		const time = new Float64Array(cap);
		time.set(this.time);
		const kind = new Uint8Array(cap);
		kind.set(this.kind);
		const ref = new Uint32Array(cap);
		ref.set(this.ref);
		const revision = new Uint32Array(cap);
		revision.set(this.revision);
		this.revision = revision;
		this.time = time;
		this.kind = kind;
		this.ref = ref;
	};

	ExecQueue.prototype.push = function (time, kind, ref, revision = 0) {
		if (this.size === this.time.length) this.grow();
		const times = this.time;
		const kinds = this.kind;
		const refs = this.ref;
		const revisions = this.revision;
		let i = this.size++;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (times[parent] <= time) break;
			times[i] = times[parent];
			kinds[i] = kinds[parent];
			refs[i] = refs[parent];
			revisions[i] = revisions[parent];
			i = parent;
		}
		times[i] = time;
		kinds[i] = kind;
		refs[i] = ref;
		revisions[i] = revision;
	};

	ExecQueue.prototype.popRoot = function () {
		const times = this.time;
		const kinds = this.kind;
		const refs = this.ref;
		const revisions = this.revision;
		const n = --this.size;
		if (n === 0) return;
		const time = times[n];
		const kind = kinds[n];
		const ref = refs[n];
		const revision = revisions[n];
		let i = 0;
		for (;;) {
			let child = i * 2 + 1;
			if (child >= n) break;
			const right = child + 1;
			if (right < n && times[right] < times[child]) child = right;
			if (times[child] >= time) break;
			times[i] = times[child];
			kinds[i] = kinds[child];
			refs[i] = refs[child];
			revisions[i] = revisions[child];
			i = child;
		}
		times[i] = time;
		kinds[i] = kind;
		refs[i] = ref;
		revisions[i] = revision;
	};

	/*
	 * Handler runs after the root is popped, so it may push follow-up events.
	 * Arrays are re-read through `this` every iteration because a push inside
	 * the handler can grow (reallocate) them.
	 */
	ExecQueue.prototype.drainUntil = function (target, onEvent) {
		while (this.size > 0 && this.time[0] <= target) {
			const time = this.time[0];
			const kind = this.kind[0];
			const ref = this.ref[0];
			const revision = this.revision[0];
			this.popRoot();
			onEvent(time, kind, ref, revision);
		}
	};

	ExecQueue.prototype.peekTime = function () {
		return this.size > 0 ? this.time[0] : Infinity;
	};

	ExecQueue.prototype.clear = function () {
		this.size = 0;
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = ExecQueue;
	else root.ExecQueue = ExecQueue;
})(typeof globalThis !== 'undefined' ? globalThis : this);
