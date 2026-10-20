/*
 * Headless GUI smoke test for orbit_trade.html. Stubs the DOM and canvas so
 * orbit_gui.js runs under node: element ids, controls, hover, resize, log rows
 * and the frame loop without a browser. Run: node experiments/orbit_gui_smoke.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList() {
	const set = new Set();
	return {
		toggle(name, on) {
			if (on) set.add(name);
			else set.delete(name);
		},
		contains(name) {
			return set.has(name);
		}
	};
}

class Element {
	constructor(id) {
		this.id = id;
		this.tagName = id === 'c' ? 'CANVAS' : 'DIV';
		this.textContent = '';
		this.value = '0';
		this.checked = false;
		this.dataset = {};
		this.style = {};
		this.classList = makeClassList();
		this.listeners = new Map();
		this.width = 0;
		this.height = 0;
		this.children = [];
	}
	appendChild(child) {
		this.children.push(child);
	}
	addEventListener(type, callback) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(callback);
	}
	dispatch(type, event) {
		for (const callback of this.listeners.get(type) || []) callback(event || {});
	}
	getBoundingClientRect() {
		return { left: 0, top: 0, width: 1280, height: 800 };
	}
	visibleText() {
		return this.children
			.filter(child => child.style.display !== 'none')
			.map(row => row.children.map(cell => cell.textContent).join(' '))
			.join('|');
	}
	getContext() {
		const gradient = { addColorStop() {} };
		const target = { canvas: this };
		return new Proxy(target, {
			get(object, property) {
				if (property in object) return object[property];
				if (property === 'createLinearGradient' || property === 'createRadialGradient') {
					return () => gradient;
				}
				return () => {};
			},
			set(object, property, value) {
				object[property] = value;
				return true;
			}
		});
	}
}

const ids = [
	'c', 'clock', 'ports', 'empty', 'ships', 'routes', 'delivered', 'colonies',
	'aim', 'queue', 'logBody', 'speed', 'speedLabel', 'partners', 'partnersLabel',
	'pause', 'reset', 'orbits', 'links', 'routesOn'
];
const elements = new Map(ids.map(id => [id, new Element(id)]));
elements.get('speed').value = '3';
elements.get('partners').value = '4';
elements.get('orbits').checked = true;
elements.get('links').checked = true;
elements.get('routesOn').checked = true;

let now = 0;
const frames = [];
const windowListeners = new Map();
const windowStub = {
	innerWidth: 1280,
	innerHeight: 800,
	devicePixelRatio: 1,
	addEventListener(type, callback) {
		if (!windowListeners.has(type)) windowListeners.set(type, []);
		windowListeners.get(type).push(callback);
	}
};
const sandbox = {
	console,
	document: {
		getElementById: id => elements.get(id),
		createElement: tag => new Element(tag)
	},
	performance: { now: () => now },
	requestAnimationFrame: callback => frames.push(callback),
	window: windowStub
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['exec_queue.js', 'orbit_sim.js', 'orbit_gui.js']) {
	vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
}

function runFrames(count, step) {
	for (let i = 0; i < count; i++) {
		now += step;
		const callback = frames.shift();
		assert(callback, 'frame loop must stay scheduled');
		callback(now);
	}
}

function fireWindow(type, event) {
	for (const callback of windowListeners.get(type) || []) callback(event || {});
}

const clock = () => elements.get('clock').textContent;
const stat = id => String(elements.get(id).textContent);

runFrames(40, 16.7);
assert(clock().startsWith('t+ 00:'), 'clock must render, got ' + clock());
assert.strictEqual(stat('ports'), '8 / 26');
assert.strictEqual(stat('empty'), '18');
assert.strictEqual(stat('ships'), '8');
assert(Number(stat('queue')) > 0, 'queue must hold scheduled work');
assert(stat('colonies') === '0 / 18');
assert(stat('aim') === '0.000 px', 'routes must be solved exactly, got ' + stat('aim'));
assert(elements.get('logBody').visibleText().includes('empty planets'), 'start row must render');

/* four thousand frames at speed 3 is 200 sim minutes: the first colony wave */
runFrames(4000, 16.7);
assert(Number(stat('delivered')) > 0, 'ships must deliver cargo');
assert(Number(stat('routes')) > 50, 'ships must reuse routes');
assert(!stat('colonies').startsWith('0 /'), 'trade must found a colony, got ' + stat('colonies'));
assert(elements.get('logBody').visibleText().includes('colony'), 'colony row must render');
assert(Number(stat('ports').split(' ')[0]) > 8, 'port count must grow');
assert(stat('aim') === '0.000 px', 'rendezvous must stay exact');

/* pause freezes the clock, play resumes it */
const pausedClock = clock();
elements.get('pause').dispatch('click');
runFrames(80, 16.7);
assert.strictEqual(clock(), pausedClock, 'pause must hold the clock');
elements.get('pause').dispatch('click');
runFrames(200, 16.7);
assert.notStrictEqual(clock(), pausedClock, 'play must advance the clock');

/* sliders and toggles are wired without errors */
elements.get('speed').value = '12';
elements.get('speed').dispatch('input');
assert.strictEqual(elements.get('speedLabel').textContent, '×12');
elements.get('partners').value = '2';
elements.get('partners').dispatch('input');
assert.strictEqual(elements.get('partnersLabel').textContent, '2');
elements.get('orbits').checked = false;
elements.get('orbits').dispatch('change');
elements.get('links').checked = false;
elements.get('links').dispatch('change');
elements.get('routesOn').checked = false;
elements.get('routesOn').dispatch('change');
runFrames(30, 16.7);

/* hover and leave must not throw, even with overlays disabled */
elements.get('c').dispatch('pointermove', { clientX: 640, clientY: 400 });
runFrames(3, 16.7);
elements.get('c').dispatch('pointerleave');
runFrames(3, 16.7);

/* resize rebuilds the backdrop and keeps the loop alive */
windowStub.innerWidth = 900;
windowStub.innerHeight = 600;
fireWindow('resize');
assert.strictEqual(elements.get('c').width, 900, 'backing store must follow the viewport');
runFrames(10, 16.7);

/* reset reseeds, restores eight ports and keeps the chosen link count */
const oldSeed = sandbox.OrbitSim;
elements.get('reset').dispatch('click');
runFrames(60, 16.7);
assert.strictEqual(stat('ports'), '8 / 26', 'reset must restore initial ports');
assert.strictEqual(stat('colonies'), '0 / 18', 'reset must clear colonies');
assert(elements.get('logBody').visibleText().includes('empty planets'), 'reset log must start over');
assert(sandbox.OrbitSim === oldSeed);

/* space toggles pause from the page, not from a control */
const beforeSpace = clock();
fireWindow('keydown', {
	code: 'Space',
	target: { tagName: 'BODY' },
	preventDefault() {}
});
runFrames(80, 16.7);
assert.strictEqual(clock(), beforeSpace, 'space must pause');
fireWindow('keydown', {
	code: 'Space',
	target: { tagName: 'BODY' },
	preventDefault() {}
});

console.log('orbit gui smoke ok');
