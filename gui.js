/*
 * Canvas renderer and controls. The sim owns all state; this file only reads
 * it and eases ship positions between clock jumps so discrete steps stay
 * readable. Per-frame work reuses preallocated arrays and cached elements.
 */
(function () {
	'use strict';

	const $ = id => document.getElementById(id);
	const TAU = Math.PI * 2;
	const GOOD_COLORS = ['#ff5f6d', '#48d18d', '#4f9dff'];
	const JUMP_MINUTES = 30;
	const BAR_HEIGHT = 54;
	const BAR_WIDTH = 12;
	const BAR_GAP = 5;
	const BAR_LIFT = 34;
	const PORT_RADIUS = 15;
	const HUD_INTERVAL = 100;
	const QUEUE_WINDOW = 20;
	const QTL_W = 190;
	const QTL_H = 44;
	const QTL_SCALE = 2;

	const canvas = $('c');
	const ctx = canvas.getContext('2d');
	const backdrop = document.createElement('canvas');
	const backCtx = backdrop.getContext('2d');
	const view = { dpr: 1, scale: 1, offX: 0, offY: 0 };
	const shipX = new Float32Array(Sim.SHIPS);
	const shipY = new Float32Array(Sim.SHIPS);
	const shipGen = new Uint32Array(Sim.SHIPS);
	const clockEl = $('clock');
	const qlenEl = $('qlen');
	const eventsEl = $('events');
	const shipsEl = $('ships');
	const deliveredEl = $('delivered');
	const nextEl = $('next');
	const queueCanvas = $('qtl');
	const queueCtx = queueCanvas.getContext('2d');
	const speedSlider = $('speed');
	const speedLabel = $('speedLabel');
	const pauseButton = $('pause');
	const modeButtons = document.querySelectorAll('[data-mode]');

	let sim = new Sim(7);
	let seed = 7;
	let paused = false;
	let mode = 'continuous';
	let speed = 60;
	let jumpAcc = 0;
	let lastProcessed = 0;
	let flashPort = -1;
	let flashColor = GOOD_COLORS[0];
	let flashAt = -Infinity;
	let hudAt = -Infinity;
	let lastFrame = performance.now();

	function paintBackdrop(width, height, dpr) {
		backdrop.width = Math.round(width * dpr);
		backdrop.height = Math.round(height * dpr);
		const water = backCtx.createLinearGradient(0, 0, 0, height);
		water.addColorStop(0, '#0a2b41');
		water.addColorStop(1, '#04121d');
		backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		backCtx.fillStyle = water;
		backCtx.fillRect(0, 0, width, height);
		backCtx.setTransform(
			dpr * view.scale, 0, 0, dpr * view.scale,
			dpr * view.offX, dpr * view.offY
		);
		backCtx.fillStyle = 'rgba(96, 176, 219, 0.16)';
		for (let y = 30; y < Sim.WORLD_H; y += 46) {
			for (let x = 30; x < Sim.WORLD_W; x += 46) backCtx.fillRect(x, y, 2, 2);
		}
		for (let p = 0; p < Sim.PORTS; p++) {
			const px = Sim.PORT_X[p];
			const py = Sim.PORT_Y[p];
			const glow = backCtx.createRadialGradient(px, py, 0, px, py, 170);
			glow.addColorStop(0, 'rgba(80, 180, 230, 0.13)');
			glow.addColorStop(1, 'rgba(80, 180, 230, 0)');
			backCtx.fillStyle = glow;
			backCtx.fillRect(px - 170, py - 170, 340, 340);
		}
	}

	function resize() {
		const width = window.innerWidth;
		const height = window.innerHeight;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
		view.dpr = dpr;
		view.scale = Math.min(width / Sim.WORLD_W, height / Sim.WORLD_H) * 0.92;
		view.offX = (width - Sim.WORLD_W * view.scale) / 2;
		view.offY = (height - Sim.WORLD_H * view.scale) / 2;
		paintBackdrop(width, height, dpr);
	}

	function drawFlash(px, py, now) {
		const age = (now - flashAt) / 900;
		if (age >= 1) return;
		ctx.globalAlpha = 1 - age;
		ctx.beginPath();
		ctx.arc(px, py, PORT_RADIUS + age * 60, 0, TAU);
		ctx.lineWidth = 2;
		ctx.strokeStyle = flashColor;
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	function drawPorts(now) {
		const stock = sim.stock;
		const barSpan = BAR_WIDTH * 3 + BAR_GAP * 2;
		for (let p = 0; p < Sim.PORTS; p++) {
			const px = Sim.PORT_X[p];
			const py = Sim.PORT_Y[p];
			const barX = px - barSpan / 2;
			const barTop = py - BAR_LIFT - BAR_HEIGHT;
			ctx.fillStyle = 'rgba(150, 205, 235, 0.08)';
			for (let g = 0; g < 3; g++) {
				ctx.fillRect(barX + g * (BAR_WIDTH + BAR_GAP), barTop, BAR_WIDTH, BAR_HEIGHT);
			}
			for (let g = 0; g < 3; g++) {
				const fill = stock[p * 3 + g] / Sim.STOCK_MAX * BAR_HEIGHT;
				ctx.fillStyle = GOOD_COLORS[g];
				ctx.fillRect(barX + g * (BAR_WIDTH + BAR_GAP), barTop + BAR_HEIGHT - fill, BAR_WIDTH, fill);
			}
			ctx.beginPath();
			ctx.arc(px, py, PORT_RADIUS, 0, TAU);
			ctx.fillStyle = '#0d3149';
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = '#2d6c92';
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(px, py, 4.5, 0, TAU);
			ctx.fillStyle = '#7fd3ff';
			ctx.fill();
			if (p === flashPort) drawFlash(px, py, now);
		}
	}

	function drawShips(dt) {
		const ease = 1 - Math.exp(-dt * 9);
		for (let i = 0; i < Sim.SHIPS; i++) {
			if (sim.shipAlive[i] === 0) continue;
			const from = sim.shipFrom[i];
			const to = sim.shipTo[i];
			const fx = Sim.PORT_X[from];
			const fy = Sim.PORT_Y[from];
			const tx = Sim.PORT_X[to];
			const ty = Sim.PORT_Y[to];
			const span = sim.shipArrive[i] - sim.shipDepart[i];
			let f = span > 0 ? (sim.t - sim.shipDepart[i]) / span : 1;
			f = f < 0 ? 0 : f > 1 ? 1 : f;
			const goalX = fx + (tx - fx) * f;
			const goalY = fy + (ty - fy) * f;
			// a recycled slot is a different ship: snap, do not sail to it
			if (sim.shipGen[i] !== shipGen[i]) {
				shipGen[i] = sim.shipGen[i];
				shipX[i] = goalX;
				shipY[i] = goalY;
			} else {
				shipX[i] += (goalX - shipX[i]) * ease;
				shipY[i] += (goalY - shipY[i]) * ease;
			}
			const cargo = sim.shipCargo[i];
			const size = 1 + (sim.shipHold[i] / Sim.HOLD_MAX) * 0.2;
			ctx.save();
			ctx.translate(shipX[i], shipY[i]);
			ctx.rotate(Math.atan2(ty - fy, tx - fx));
			ctx.beginPath();
			ctx.moveTo(10 * size, 0);
			ctx.lineTo(-6 * size, 5.5 * size);
			ctx.lineTo(-6 * size, -5.5 * size);
			ctx.closePath();
			ctx.fillStyle = cargo === Sim.NO_GOOD ? '#8fb3c8' : GOOD_COLORS[cargo];
			ctx.fill();
			ctx.lineWidth = 1.2;
			ctx.strokeStyle = 'rgba(3, 14, 22, 0.8)';
			ctx.stroke();
			ctx.restore();
		}
	}

	function draw(now, dt) {
		if (sim.processed !== lastProcessed) {
			lastProcessed = sim.processed;
			flashPort = sim.lastPort;
			flashColor = sim.lastGood === Sim.NO_GOOD ? '#9fd8ff' : GOOD_COLORS[sim.lastGood];
			flashAt = now;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(backdrop, 0, 0);
		ctx.setTransform(
			view.dpr * view.scale, 0, 0, view.dpr * view.scale,
			view.dpr * view.offX, view.dpr * view.offY
		);
		drawPorts(now);
		drawShips(dt);
	}

	function pad(value) {
		return value < 10 ? '0' + value : '' + value;
	}

	function formatClock(minutes) {
		const total = Math.floor(minutes);
		const day = Math.floor(total / 1440) + 1;
		const hh = Math.floor(total / 60) % 24;
		const mm = total % 60;
		return 'day ' + day + ' · ' + pad(hh) + ':' + pad(mm);
	}

	function formatNext(minutes) {
		if (!(minutes < Infinity)) return '—';
		if (minutes < 90) return minutes.toFixed(1) + ' min';
		return (minutes / 60).toFixed(1) + ' h';
	}

	/* Ticks are event times relative to the clock; a jump slides them left. */
	function drawTimeline() {
		const events = sim.events;
		queueCtx.clearRect(0, 0, QTL_W, QTL_H);
		queueCtx.fillStyle = 'rgba(120, 190, 230, 0.12)';
		for (let minute = 0; minute <= QUEUE_WINDOW; minute += 5) {
			queueCtx.fillRect(minute / QUEUE_WINDOW * QTL_W, QTL_H - 9, 1, 5);
		}
		for (let i = 0; i < events.size; i++) {
			const x = (events.time[i] - sim.t) / QUEUE_WINDOW * QTL_W;
			if (x < 0 || x >= QTL_W) continue;
			const arrival = events.kind[i] === 1;
			const cargo = arrival ? sim.shipCargo[events.ref[i]] : Sim.NO_GOOD;
			const height = arrival ? 24 : 13;
			queueCtx.fillStyle = cargo === Sim.NO_GOOD ? '#39708f' : GOOD_COLORS[cargo];
			queueCtx.fillRect(x, QTL_H - 11 - height, 2, height);
		}
		queueCtx.fillStyle = '#e8f6ff';
		queueCtx.fillRect(0, 0, 3, QTL_H);
	}

	function updateHud(now) {
		if (now - hudAt < HUD_INTERVAL) return;
		hudAt = now;
		clockEl.textContent = formatClock(sim.t);
		qlenEl.textContent = sim.events.size;
		eventsEl.textContent = sim.processed;
		shipsEl.textContent = sim.shipCount;
		deliveredEl.textContent = Math.round(sim.delivered);
		nextEl.textContent = formatNext(sim.events.peekTime() - sim.t);
		drawTimeline();
	}

	function advance(dt) {
		if (mode === 'continuous') {
			sim.step(dt * speed);
			return;
		}
		jumpAcc += dt;
		const interval = JUMP_MINUTES / speed;
		let jumps = 0;
		while (jumpAcc >= interval && jumps < 16) {
			jumpAcc -= interval;
			sim.step(JUMP_MINUTES);
			jumps += 1;
		}
		if (jumps === 16) jumpAcc = 0;
	}

	function updateSpeedLabel() {
		speedLabel.textContent = mode === 'jump'
			? '×' + speed + ' · ' + JUMP_MINUTES + ' min steps'
			: '×' + speed;
	}

	function decodeSpeed(value) {
		return Math.max(1, Math.round(Math.exp(value / 1000 * Math.log(1000))));
	}

	function setMode(next) {
		mode = next;
		jumpAcc = 0;
		for (let i = 0; i < modeButtons.length; i++) {
			modeButtons[i].classList.toggle('on', modeButtons[i].dataset.mode === mode);
		}
		updateSpeedLabel();
	}

	function setPaused(value) {
		paused = value;
		pauseButton.textContent = paused ? 'play' : 'pause';
	}

	function reset() {
		seed += 1;
		sim = new Sim(seed);
		lastProcessed = 0;
		jumpAcc = 0;
		flashPort = -1;
		shipGen.fill(0);
	}

	function frame(now) {
		const dt = Math.min(0.1, (now - lastFrame) / 1000);
		lastFrame = now;
		if (!paused && dt > 0) advance(dt);
		draw(now, dt);
		updateHud(now);
		requestAnimationFrame(frame);
	}

	pauseButton.addEventListener('click', () => setPaused(!paused));
	modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
	speedSlider.addEventListener('input', () => {
		speed = decodeSpeed(Number(speedSlider.value));
		updateSpeedLabel();
	});
	$('reset').addEventListener('click', reset);
	window.addEventListener('resize', resize);
	window.addEventListener('keydown', event => {
		if (event.code === 'Space') {
			event.preventDefault();
			setPaused(!paused);
			return;
		}
		if (event.code === 'KeyJ') sim.step(JUMP_MINUTES);
	});
	canvas.addEventListener('click', event => {
		const rect = canvas.getBoundingClientRect();
		const wx = (event.clientX - rect.left - view.offX) / view.scale;
		const wy = (event.clientY - rect.top - view.offY) / view.scale;
		let hit = -1;
		let best = 44 * 44;
		for (let p = 0; p < Sim.PORTS; p++) {
			const dx = wx - Sim.PORT_X[p];
			const dy = wy - Sim.PORT_Y[p];
			const d2 = dx * dx + dy * dy;
			if (d2 < best) {
				best = d2;
				hit = p;
			}
		}
		if (hit >= 0) sim.requestShip(hit);
	});

	queueCanvas.width = QTL_W * QTL_SCALE;
	queueCanvas.height = QTL_H * QTL_SCALE;
	queueCtx.setTransform(QTL_SCALE, 0, 0, QTL_SCALE, 0, 0);
	speed = decodeSpeed(Number(speedSlider.value));
	updateSpeedLabel();
	resize();
	requestAnimationFrame(frame);
})();
