/*
 * Headless GUI smoke test: stubs the DOM and canvas so gui.js can run under
 * node. Catches console errors, broken element ids and control wiring without
 * a browser. Run: node experiments/gui_smoke.js
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
		this.textContent = '';
		this.value = '0';
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
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	}
	dispatch(type, event) {
		for (const fn of this.listeners.get(type) || []) fn(event || {});
	}
	getBoundingClientRect() {
		return { left: 0, top: 0, width: 1280, height: 800 };
	}
	/* the log panel is built once, so read its rows back through this */
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
			get(object, prop) {
				if (prop in object) return object[prop];
				if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
				return () => {};
			},
			set(object, prop, value) {
				object[prop] = value;
				return true;
			}
		});
	}
}

const ids = [
	'c', 'qtl', 'clock', 'qlen', 'events', 'ships', 'delivered', 'consumed', 'next',
	'logRate', 'logBody', 'speed', 'speedLabel', 'fleet', 'fleetLabel', 'pause', 'reset'
];
const elements = new Map(ids.map(id => [id, new Element(id)]));
elements.get('speed').value = '593'; // mirrors index.html
elements.get('fleet').value = '30';
const modeButtons = [new Element('continuous'), new Element('jump')];
modeButtons[0].dataset.mode = 'continuous';
modeButtons[1].dataset.mode = 'jump';

let now = 0;
const frames = [];
const windowListeners = new Map();

const sandbox = {
	console,
	document: {
		getElementById: id => elements.get(id),
		querySelectorAll: selector => (selector === '[data-mode]' ? modeButtons : []),
		createElement: tag => new Element(tag)
	},
	performance: { now: () => now },
	requestAnimationFrame: callback => frames.push(callback),
	window: {
		innerWidth: 1280,
		innerHeight: 800,
		devicePixelRatio: 1,
		addEventListener(type, fn) {
			if (!windowListeners.has(type)) windowListeners.set(type, []);
			windowListeners.get(type).push(fn);
		}
	}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['exec_queue.js', 'sim.js', 'gui.js']) {
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

const clock = () => elements.get('clock').textContent;
const events = () => Number(elements.get('events').textContent);
const ships = () => Number.parseInt(elements.get('ships').textContent, 10);
const stat = id => Number(elements.get(id).textContent);

assert.strictEqual(elements.get('qtl').width, 380, 'queue timeline canvas must be sized once at setup');
runFrames(60, 16.7);
assert(clock().startsWith('day 1'), 'clock must render');
assert(events() > 50, 'a minute of trade must process events, got ' + events());
const fleet = ships();
assert(fleet >= 20 && fleet <= 30, 'fleet must be sailing, got ' + fleet);
assert.strictEqual(elements.get('ships').textContent, fleet + ' / 30', 'fleet stat must show the cap');
assert(stat('delivered') > 0, 'ships must deliver cargo');
assert(stat('consumed') > 0, 'ports must eat part of their stock');
const logText = elements.get('logBody').visibleText();
assert(logText.includes('arrive') || logText.includes('consume'), 'event log must fill, got: ' + logText.slice(0, 80));
assert(elements.get('logBody').children.length === 15, 'log rows are preallocated once');

modeButtons[1].dispatch('click');
elements.get('speed').value = '900';
elements.get('speed').dispatch('input');
assert(elements.get('speedLabel').textContent.includes('30 min steps'));
runFrames(120, 16.7);
assert(events() > 500, 'jump mode must process many events, got ' + events());

elements.get('pause').dispatch('click');
assert.strictEqual(elements.get('pause').textContent, 'play');
runFrames(12, 16.7);
const pausedClock = clock();
runFrames(30, 16.7);
assert.strictEqual(clock(), pausedClock, 'paused sim must not advance');
elements.get('pause').dispatch('click');

const canvas = elements.get('c');
const scale = Math.min(1280 / 1600, 800 / 1000) * 0.92;
canvas.dispatch('click', {
	clientX: (1280 - 1600 * scale) / 2 + 250 * scale,
	clientY: (800 - 1000 * scale) / 2 + 300 * scale
});
runFrames(30, 16.7);

elements.get('fleet').value = '6';
elements.get('fleet').dispatch('input');
assert.strictEqual(elements.get('fleetLabel').textContent, '6', 'fleet label must follow the slider');
runFrames(240, 16.7);
assert(ships() <= 6, 'fleet slider must cap the fleet, got ' + ships());
elements.get('fleet').value = '30';
elements.get('fleet').dispatch('input');
runFrames(120, 16.7);

windowListeners.get('resize')[0]();
const beforeReset = events();
elements.get('reset').dispatch('click');
runFrames(60, 16.7);
assert(clock().startsWith('day 1'), 'reset must return to day 1');
assert(events() < beforeReset, 'reset must restart the event count');

console.log('gui_smoke: ok, ' + clock() + ', events=' + events() + ', ships=' + ships());
