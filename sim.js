/*
 * Sea-trade simulation driven entirely by the discrete-event queue.
 * Every ship has exactly one future arrival event; ports schedule dispatch
 * events for new ships. Handlers use the event time (not the frame clock)
 * as the new departure time, so a clock jump over several voyages stays
 * consistent.
 */
(function (root) {
	'use strict';

	const ExecQueue = typeof module !== 'undefined' && module.exports
		? require('./exec_queue.js')
		: root.ExecQueue;

	const PORTS = 6;
	const GOODS = 3;
	const SHIPS = 30;
	const NO_GOOD = 255;
	const NO_PORT = 255;
	const STOCK_MAX = 120;
	const HOLD_MAX = 26;
	const SHIP_SPEED = 70; // world px per sim minute
	const RETIRE_TRIPS = 6;
	const RETIRE_CHANCE = 0.12;
	const KIND_DISPATCH = 0;
	const KIND_ARRIVE = 1;

	const WORLD_W = 1600;
	const WORLD_H = 1000;
	const PORT_X = [250, 660, 1260, 1400, 880, 360];
	const PORT_Y = [300, 130, 240, 620, 800, 720];

	function seedRandom(seed) {
		let a = seed >>> 0;
		return function () {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function Sim(seed) {
		this.rand = seedRandom(seed || 1);
		this.t = 0;
		this.events = new ExecQueue(512);
		this.handleEvent = this.handleEvent.bind(this);
		this.processed = 0;
		this.spawned = 0;
		this.retired = 0;
		this.delivered = 0;
		this.shipCount = 0;
		this.queuePeak = 0;
		this.lastPort = 0;
		this.lastGood = NO_GOOD;
		this.stock = new Float64Array(PORTS * GOODS);
		this.production = new Float64Array(PORTS * GOODS);
		this.shipAlive = new Uint8Array(SHIPS);
		this.shipFrom = new Uint8Array(SHIPS);
		this.shipTo = new Uint8Array(SHIPS);
		this.shipDepart = new Float64Array(SHIPS);
		this.shipArrive = new Float64Array(SHIPS);
		this.shipHold = new Float64Array(SHIPS);
		this.shipCargo = new Uint8Array(SHIPS);
		this.shipTrips = new Uint16Array(SHIPS);
		this.shipGen = new Uint32Array(SHIPS);
		for (let i = 0; i < PORTS * GOODS; i++) {
			this.stock[i] = 40 + this.rand() * 50;
			this.production[i] = 1.5 + this.rand() * 2;
		}
		for (let i = 0; i < SHIPS; i++) {
			const delay = i < 10 ? 0 : (i - 10) * 3 + this.rand() * 6;
			this.events.push(delay, KIND_DISPATCH, NO_PORT);
		}
	}

	/* production accrues up to each event time, so handlers always see the
	 * supplies that existed when the event actually happened. */
	Sim.prototype.produce = function (simMinutes) {
		if (!(simMinutes > 0)) return;
		const stock = this.stock;
		const production = this.production;
		for (let i = 0; i < stock.length; i++) {
			const grown = stock[i] + production[i] * simMinutes;
			stock[i] = grown > STOCK_MAX ? STOCK_MAX : grown;
		}
	};

	Sim.prototype.handleEvent = function (time, kind, ref) {
		this.produce(time - this.t);
		this.t = time;
		this.processed += 1;
		if (kind === KIND_ARRIVE) this.arrive(time, ref);
		else this.dispatch(time, ref);
	};

	Sim.prototype.dispatch = function (time, port) {
		const requested = port !== NO_PORT;
		if (this.shipCount >= SHIPS) {
			// a full fleet defers the request instead of dropping it
			this.events.push(time + 10 + this.rand() * 40, KIND_DISPATCH, port);
			return;
		}
		const ship = this.freeShip();
		if (ship < 0) return;
		const home = requested ? port : Math.floor(this.rand() * PORTS);
		this.shipAlive[ship] = 1;
		this.shipGen[ship] += 1;
		this.shipCount += 1;
		this.shipTrips[ship] = 0;
		this.shipCargo[ship] = NO_GOOD;
		this.shipHold[ship] = 0;
		this.shipFrom[ship] = home;
		this.shipTo[ship] = home;
		this.shipDepart[ship] = time;
		this.shipArrive[ship] = time;
		this.spawned += 1;
		this.load(ship, home, time);
	};

	Sim.prototype.arrive = function (time, ship) {
		const port = this.shipTo[ship];
		const cargo = this.shipCargo[ship];
		if (cargo !== NO_GOOD) {
			const slot = port * GOODS + cargo;
			const stock = this.stock[slot] + this.shipHold[ship];
			this.stock[slot] = stock > STOCK_MAX ? STOCK_MAX : stock;
			this.delivered += this.shipHold[ship];
		}
		this.lastPort = port;
		this.lastGood = cargo;
		this.shipCargo[ship] = NO_GOOD;
		this.shipHold[ship] = 0;
		const trips = this.shipTrips[ship];
		if (trips >= RETIRE_TRIPS && this.rand() < RETIRE_CHANCE) {
			this.retire(ship, time);
			return;
		}
		this.shipTrips[ship] = trips + 1;
		this.load(ship, port, time);
	};

	Sim.prototype.load = function (ship, port, time) {
		const stock = this.stock;
		const base = port * GOODS;
		const total = stock[base] + stock[base + 1] + stock[base + 2];
		if (total > 1) {
			let pick = this.rand() * total;
			let good = GOODS - 1;
			for (let g = 0; g < GOODS; g++) {
				pick -= stock[base + g];
				if (pick <= 0) {
					good = g;
					break;
				}
			}
			const available = stock[base + good];
			const hold = available < HOLD_MAX ? available : HOLD_MAX;
			stock[base + good] -= hold;
			this.shipCargo[ship] = good;
			this.shipHold[ship] = hold;
		}
		let dest = Math.floor(this.rand() * (PORTS - 1));
		if (dest >= port) dest += 1;
		const dx = PORT_X[dest] - PORT_X[port];
		const dy = PORT_Y[dest] - PORT_Y[port];
		const travel = Math.sqrt(dx * dx + dy * dy) / SHIP_SPEED;
		this.shipFrom[ship] = port;
		this.shipTo[ship] = dest;
		this.shipDepart[ship] = time;
		this.shipArrive[ship] = time + travel;
		this.events.push(time + travel, KIND_ARRIVE, ship);
	};

	Sim.prototype.retire = function (ship, time) {
		this.shipAlive[ship] = 0;
		this.shipCount -= 1;
		this.retired += 1;
		this.events.push(time + 5 + this.rand() * 15, KIND_DISPATCH, NO_PORT);
	};

	Sim.prototype.freeShip = function () {
		for (let i = 0; i < SHIPS; i++) if (this.shipAlive[i] === 0) return i;
		return -1;
	};

	Sim.prototype.requestShip = function (port) {
		this.events.push(this.t, KIND_DISPATCH, port);
	};

	Sim.prototype.step = function (simMinutes) {
		if (!(simMinutes > 0)) return;
		const target = this.t + simMinutes;
		this.events.drainUntil(target, this.handleEvent);
		this.produce(target - this.t);
		this.t = target;
		if (this.events.size > this.queuePeak) this.queuePeak = this.events.size;
	};

	Sim.SHIPS = SHIPS;
	Sim.PORTS = PORTS;
	Sim.GOODS = GOODS;
	Sim.NO_GOOD = NO_GOOD;
	Sim.NO_PORT = NO_PORT;
	Sim.STOCK_MAX = STOCK_MAX;
	Sim.HOLD_MAX = HOLD_MAX;
	Sim.WORLD_W = WORLD_W;
	Sim.WORLD_H = WORLD_H;
	Sim.PORT_X = PORT_X;
	Sim.PORT_Y = PORT_Y;

	if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
	else root.Sim = Sim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
