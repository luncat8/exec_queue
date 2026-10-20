/*
 * Sea-trade simulation driven entirely by the discrete-event queue.
 *
 * Ports schedule dispatch and consumption; ships schedule arrival, unloading,
 * and loading (retrying while cargo is scarce). Ship event revisions allow
 * lazy cancellation without heap searches. Schedule from event time, not the
 * frame clock, so clock jumps preserve the same simulation.
 */
(function (root) {
	'use strict';

	const ExecQueue = typeof module !== 'undefined' && module.exports
		? require('./exec_queue.js')
		: root.ExecQueue;

	const PORTS = 6;
	const GOODS = 3;
	const SHIPS = 30;
	const LOG = 64;
	const NO_GOOD = 255;
	const NO_PORT = 255;
	const STOCK_MAX = 120;
	const HOLD_MAX = 26;
	const SHIP_SPEED = 70; // world px per sim minute at speed 1.0
	const RETIRE_TRIPS = 6;
	const RETIRE_CHANCE = 0.12;
	const CONSUME_MINUTES = 10;
	const SINK_SHARE = 0.92; // fraction of production the port itself eats
	const KIND_DISPATCH = 0;
	const KIND_ARRIVE = 1;
	const KIND_CONSUME = 2;
	const KIND_LOAD = 3;
	const KIND_UNLOAD = 4;
	const SAILING = 0, LOADING = 1, UNLOADING = 2, WAITING = 3;

	const WORLD_W = 1600;
	const WORLD_H = 1000;
	const PORT_X = [250, 660, 1260, 1400, 880, 360];
	const PORT_Y = [300, 130, 240, 620, 800, 720];
	const PORT_NAMES = ['Northport', 'Saltbay', 'Ironhook', 'Farreach', 'Lowmarsh', 'Highcross'];
	const GOOD_NAMES = ['grain', 'timber', 'iron'];

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

	function Sim(seed, docking = true) {
		this.docking = docking;
		this.positionScratch = { x: 0, y: 0, angle: 0 };
		this.skipped = 0;
		this.sunk = 0;
		this.rand = seedRandom(seed || 1);
		this.t = 0;
		this.events = new ExecQueue(512);
		this.handleEvent = this.handleEvent.bind(this);
		this.processed = 0;
		this.spawned = 0;
		this.retired = 0;
		this.delivered = 0;
		this.consumed = 0;
		this.shipCount = 0;
		this.fleetMax = SHIPS;
		this.queuePeak = 0;
		this.lastPort = 0;
		this.lastGood = NO_GOOD;
		this.stock = new Float64Array(PORTS * GOODS);
		this.production = new Float64Array(PORTS * GOODS);
		this.sink = new Float64Array(PORTS * GOODS);
		this.shipAlive = new Uint8Array(SHIPS);
		this.shipFrom = new Uint8Array(SHIPS);
		this.shipTo = new Uint8Array(SHIPS);
		this.shipDepart = new Float64Array(SHIPS);
		this.shipArrive = new Float64Array(SHIPS);
		this.shipHold = new Float64Array(SHIPS);
		this.shipLimit = new Float64Array(SHIPS);
		this.shipSpeed = new Float64Array(SHIPS);
		this.shipCargo = new Uint8Array(SHIPS);
		this.shipTrips = new Uint16Array(SHIPS);
		this.shipState = new Uint8Array(SHIPS);
		this.shipRevision = new Uint32Array(SHIPS);
		this.shipStartX = new Float64Array(SHIPS);
		this.shipStartY = new Float64Array(SHIPS);
		this.shipDock = new Uint8Array(SHIPS);
		this.dockCounter = new Uint32Array(PORTS);
		this.shipGen = new Uint32Array(SHIPS);
		/* newest first: the gui reads this ring instead of logging in the sim */
		this.logTime = new Float64Array(LOG);
		this.logKind = new Uint8Array(LOG);
		this.logRef = new Uint16Array(LOG);
		this.logGood = new Uint8Array(LOG);
		this.logAmount = new Float64Array(LOG);
		this.logHead = 0;
		this.logCount = 0;
		for (let i = 0; i < PORTS * GOODS; i++) {
			this.stock[i] = 40 + this.rand() * 50;
			this.production[i] = 1.5 + this.rand() * 2;
			this.sink[i] = this.production[i] * SINK_SHARE;
		}
		for (let i = 0; i < SHIPS; i++) {
			this.shipLimit[i] = HOLD_MAX * (0.7 + this.rand() * 0.6);
			this.shipSpeed[i] = SHIP_SPEED * (0.75 + this.rand() * 0.5);
		}
		for (let p = 0; p < PORTS; p++) {
			this.events.push(this.rand() * CONSUME_MINUTES, KIND_CONSUME, p);
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

	Sim.prototype.logEvent = function (time, kind, port, good, amount) {
		const slot = this.logHead;
		this.logTime[slot] = time;
		this.logKind[slot] = kind;
		this.logRef[slot] = port;
		this.logGood[slot] = good;
		this.logAmount[slot] = amount;
		this.logHead = (slot + 1) % LOG;
		if (this.logCount < LOG) this.logCount += 1;
	};

	Sim.prototype.handleEvent = function (time, kind, ref, revision) {
		if (kind === KIND_ARRIVE || kind === KIND_LOAD || kind === KIND_UNLOAD) {
			if (!this.shipAlive[ref] || this.shipRevision[ref] !== revision) {
				this.skipped += 1;
				return;
			}
		}
		this.produce(time - this.t);
		this.t = time;
		this.processed += 1;
		if (kind === KIND_ARRIVE) this.arrive(time, ref);
		else if (kind === KIND_CONSUME) this.consume(time, ref);
		else if (kind === KIND_LOAD) this.load(ref, this.shipTo[ref], time);
		else if (kind === KIND_UNLOAD) this.unload(time, ref);
		else this.dispatch(time, ref);
	};

	/* the sink that makes supply a flow instead of a pile at STOCK_MAX */
	Sim.prototype.consume = function (time, port) {
		const base = port * GOODS;
		let eaten = 0;
		for (let g = 0; g < GOODS; g++) {
			const bin = base + g;
			const want = this.sink[bin] * CONSUME_MINUTES;
			const left = this.stock[bin] - want;
			if (left > 0) {
				this.stock[bin] = left;
				eaten += want;
				continue;
			}
			eaten += this.stock[bin];
			this.stock[bin] = 0;
		}
		this.consumed += eaten;
		this.events.push(time + CONSUME_MINUTES, KIND_CONSUME, port);
		if (eaten > 0) this.logEvent(time, KIND_CONSUME, port, NO_GOOD, eaten);
	};

	Sim.prototype.dispatch = function (time, port) {
		const requested = port !== NO_PORT;
		if (this.shipCount >= this.fleetMax) {
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
		this.logEvent(time, KIND_DISPATCH, home, NO_GOOD, 0);
		this.dock(ship, home);
		if (this.docking) this.scheduleShip(time + 0.4, KIND_LOAD, ship);
		else this.load(ship, home, time);
	};

	Sim.prototype.arrive = function (time, ship) {
		this.dock(ship, this.shipTo[ship]);
		if (!this.docking) return this.unload(time, ship);
		this.shipState[ship] = UNLOADING;
		this.scheduleShip(time + 0.4, KIND_UNLOAD, ship);
	};

	Sim.prototype.unload = function (time, ship) {
		const port = this.shipTo[ship];
		const cargo = this.shipCargo[ship];
		const hold = this.shipHold[ship];
		if (cargo !== NO_GOOD) {
			const slot = port * GOODS + cargo;
			const stock = this.stock[slot] + hold;
			this.stock[slot] = stock > STOCK_MAX ? STOCK_MAX : stock;
			this.delivered += hold;
		}
		this.lastPort = port;
		this.lastGood = cargo;
		this.logEvent(time, KIND_ARRIVE, port, cargo, hold);
		this.shipCargo[ship] = NO_GOOD;
		this.shipHold[ship] = 0;
		const trips = this.shipTrips[ship];
		if (trips >= RETIRE_TRIPS && this.rand() < RETIRE_CHANCE) {
			this.retire(ship, time);
			return;
		}
		this.shipTrips[ship] = trips + 1;
		if (!this.docking) return this.load(ship, port, time);
		this.shipState[ship] = LOADING;
		this.scheduleShip(time + 0.4, KIND_LOAD, ship);
	};

	/* Docked ships wait for a viable cargo; instant mode permits empty voyages. */
	Sim.prototype.load = function (ship, port, time) {
		const stock = this.stock;
		const base = port * GOODS;
		let total = 0;
		for (let g = 0; g < GOODS; g++) {
			if (!this.docking || stock[base + g] >= 6) total += stock[base + g];
		}
		if (this.docking && total === 0) {
			this.shipState[ship] = WAITING;
			this.scheduleShip(time + 0.4, KIND_LOAD, ship);
			return;
		}
		let good = NO_GOOD;
		if (total > 1) {
			let pick = this.rand() * total;
			good = GOODS - 1;
			for (let g = 0; g < GOODS; g++) {
				if (this.docking && stock[base + g] < 6) continue;
				pick -= stock[base + g];
				if (pick <= 0) {
					good = g;
					break;
				}
			}
			const available = stock[base + good];
			const hold = available < this.shipLimit[ship] ? available : this.shipLimit[ship];
			stock[base + good] -= hold;
			this.shipCargo[ship] = good;
			this.shipHold[ship] = hold;
		}
		const dest = this.pickDest(port, good);
		this.shipFrom[ship] = port;
		this.sail(ship, dest, time, PORT_X[port], PORT_Y[port]);
	};

	Sim.prototype.scheduleShip = function (time, kind, ship) {
		this.shipRevision[ship] += 1;
		this.events.push(time, kind, ship, this.shipRevision[ship]);
	};

	Sim.prototype.dock = function (ship, port) {
		this.shipState[ship] = LOADING;
		this.shipDock[ship] = this.dockCounter[port]++ % 8;
	};

	Sim.prototype.sail = function (ship, dest, time, x, y) {
		const travel = Math.hypot(PORT_X[dest] - x, PORT_Y[dest] - y) / this.shipSpeed[ship];
		this.shipState[ship] = SAILING;
		this.shipStartX[ship] = x;
		this.shipStartY[ship] = y;
		this.shipTo[ship] = dest;
		this.shipDepart[ship] = time;
		this.shipArrive[ship] = time + travel;
		this.scheduleShip(time + travel, KIND_ARRIVE, ship);
	};

	Sim.prototype.position = function (ship, out) {
		const port = this.shipTo[ship];
		if (this.shipState[ship] !== SAILING) {
			out.angle = -Math.PI / 2 + (this.shipDock[ship] - 3.5) * 0.32;
			out.x = PORT_X[port] + Math.cos(out.angle) * 26;
			out.y = PORT_Y[port] + Math.sin(out.angle) * 26;
			return;
		}
		const span = this.shipArrive[ship] - this.shipDepart[ship];
		const f = span > 0 ? Math.max(0, Math.min(1, (this.t - this.shipDepart[ship]) / span)) : 1;
		const x = this.shipStartX[ship], y = this.shipStartY[ship];
		out.x = x + (PORT_X[port] - x) * f;
		out.y = y + (PORT_Y[port] - y) * f;
		out.angle = Math.atan2(PORT_Y[port] - y, PORT_X[port] - x);
	};

	Sim.prototype.reroute = function (ship, port) {
		if (!this.shipAlive[ship] || port < 0 || port >= PORTS || !Number.isInteger(port)) return false;
		const position = this.positionScratch;
		this.position(ship, position);
		this.sail(ship, port, this.t, position.x, position.y);
		return true;
	};

	Sim.prototype.sinkShip = function (ship) {
		if (!this.shipAlive[ship]) return false;
		this.shipAlive[ship] = 0;
		this.shipRevision[ship] += 1;
		this.shipCount -= 1;
		this.shipHold[ship] = 0;
		this.shipCargo[ship] = NO_GOOD;
		this.sunk += 1;
		return true;
	};

	/* best of two random ports by how badly it misses the cargo */
	Sim.prototype.pickDest = function (port, good) {
		let dest = Math.floor(this.rand() * (PORTS - 1));
		if (dest >= port) dest += 1;
		if (good === NO_GOOD) return dest;
		let rival = Math.floor(this.rand() * (PORTS - 1));
		if (rival >= port) rival += 1;
		const best = STOCK_MAX - this.stock[dest * GOODS + good];
		const other = STOCK_MAX - this.stock[rival * GOODS + good];
		return other > best ? rival : dest;
	};

	Sim.prototype.retire = function (ship, time) {
		this.shipAlive[ship] = 0;
		this.shipRevision[ship] += 1;
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

	Sim.prototype.setFleet = function (count) {
		this.fleetMax = count;
	};

	Sim.prototype.step = function (simMinutes) {
		if (!(simMinutes > 0)) return;
		const target = this.t + simMinutes;
		this.events.drainUntil(target, this.handleEvent);
		this.produce(target - this.t);
		this.t = target;
		if (this.events.size > this.queuePeak) this.queuePeak = this.events.size;
	};

	Sim.KIND_LOAD = KIND_LOAD;
	Sim.KIND_UNLOAD = KIND_UNLOAD;
	Sim.SAILING = SAILING;
	Sim.SHIPS = SHIPS;
	Sim.PORTS = PORTS;
	Sim.GOODS = GOODS;
	Sim.LOG = LOG;
	Sim.NO_GOOD = NO_GOOD;
	Sim.NO_PORT = NO_PORT;
	Sim.STOCK_MAX = STOCK_MAX;
	Sim.HOLD_MAX = HOLD_MAX;
	Sim.CONSUME_MINUTES = CONSUME_MINUTES;
	Sim.KIND_DISPATCH = KIND_DISPATCH;
	Sim.KIND_ARRIVE = KIND_ARRIVE;
	Sim.KIND_CONSUME = KIND_CONSUME;
	Sim.WORLD_W = WORLD_W;
	Sim.WORLD_H = WORLD_H;
	Sim.PORT_X = PORT_X;
	Sim.PORT_Y = PORT_Y;
	Sim.PORT_NAMES = PORT_NAMES;
	Sim.GOOD_NAMES = GOOD_NAMES;

	if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
	else root.Sim = Sim;
})(typeof globalThis !== 'undefined' ? globalThis : this);