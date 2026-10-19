function PriorityQueue() {
	const heap = [];
	return {
		push(item) {
			heap.push(item);
			let i = heap.length - 1;
			while (i > 0) {
				const p = (i - 1) >> 1;
				if (heap[i].time < heap[p].time) {
					const t = heap[i];
					heap[i] = heap[p];
					heap[p] = t;
					i = p;
				} else break;
			}
		},
		pop() {
			if (heap.length === 0) return null;
			const top = heap[0];
			const last = heap.pop();
			if (heap.length > 0) {
				heap[0] = last;
				let i = 0;
				while (true) {
					let l = i * 2 + 1;
					let r = l + 1;
					let m = i;
					if (l < heap.length && heap[l].time < heap[m].time) m = l;
					if (r < heap.length && heap[r].time < heap[m].time) m = r;
					if (m !== i) {
						const t = heap[i];
						heap[i] = heap[m];
						heap[m] = t;
						i = m;
					} else break;
				}
			}
			return top;
		},
		peek() { return heap.length ? heap[0] : null; },
		size() { return heap.length; },
		toArray() { return heap.slice(); }
	};
}
if (typeof module !== 'undefined' && module.exports) module.exports = PriorityQueue;
