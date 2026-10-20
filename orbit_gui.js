/*
 * Canvas renderer and controls for the orbital trade demo.
 *
 * Port positions come from the closed-form ellipse in orbit_sim.js, so nothing
 * here integrates motion or recomputes a route. The per-frame path reuses typed
 * arrays, cached elements, cached glow sprites and a preallocated log row pool.
 */
(function () {
	'use strict';

	const $ = id => document.getElementById(id);
	const TAU = Math.PI * 2;
	const CAP = OrbitSim.PORTS;
	const NO_PORT = OrbitSim.NO_PORT;
	const NO_GOOD = OrbitSim.NO_GOOD;
	const EXPAND_COST = OrbitSim.EXPAND_COST;
	const GOOD_COLORS = ['#67e0ff', '#ffb26b', '#c58bff'];
	const GOOD_GLOWS = [
		'rgba(103, 224, 255, 0.55)',
		'rgba(255, 178, 107, 0.55)',
		'rgba(197, 139, 255, 0.55)'
	];
	const GOOD_NAMES = OrbitSim.GOOD_NAMES;
	const KIND_TAGS = ['load', 'arrive', 'colony', 'online', 'start'];
	const KIND_CLASS = ['load', 'arrive', 'colony', 'port', 'start'];
	const STAR_COLORS = ['#cfe6ff', '#9fc4e8', '#ffe3c2'];
	const COLONY_COLOR = '#8ef0c0';
	const COLONY_GLOW = 'rgba(142, 240, 192, 0.5)';
	const HUD_INTERVAL = 100;
	const LOG_ROWS = 12;
	const STAR_COUNT = 240;
	const STATION_R = 5.6;
	const PROGRESS_R = 11;
	const DOCK_OFFSET = 15;
	const HOVER_PX = 17;
	const NO_DASH = [];

	const canvas = $('c');
	const ctx = canvas.getContext('2d');
	const backdrop = document.createElement('canvas');
	const backCtx = backdrop.getContext('2d');
	const view = { dpr: 1, scale: 1, offX: 0, offY: 0 };

	const clockEl = $('clock');
	const portsEl = $('ports');
	const emptyEl = $('empty');
	const shipsEl = $('ships');
	const routesEl = $('routes');
	const deliveredEl = $('delivered');
	const coloniesEl = $('colonies');
	const aimEl = $('aim');
	const queueEl = $('queue');
	const logBody = $('logBody');
	const speedSlider = $('speed');
	const speedLabel = $('speedLabel');
	const partnersSlider = $('partners');
	const partnersLabel = $('partnersLabel');
	const pauseButton = $('pause');
	const resetButton = $('reset');
	const orbitsBox = $('orbits');
	const linksBox = $('links');
	const routesBox = $('routesOn');

	const portPX = new Float64Array(CAP);
	const portPY = new Float64Array(CAP);
	const shipPX = new Float64Array(CAP);
	const shipPY = new Float64Array(CAP);
	const shipAngle = new Float64Array(CAP);
	const logRows = [];
	const glows = GOOD_GLOWS.map(makeGlow);
	const colonyGlow = makeGlow(COLONY_GLOW);

	let sim = new OrbitSim(7);
	let seed = 7;
	let paused = false;
	let speed = 3;
	let showOrbits = orbitsBox.checked;
	let showLinks = linksBox.checked;
	let showRoutes = routesBox.checked;
	let pointerX = -1;
	let pointerY = -1;
	let hoverPort = -1;
	let hoverTitle = '';
	let hoverLine1 = '';
	let hoverLine2 = '';
	let framePulse = 0.5;
	let hudAt = -Infinity;
	let lastLogHead = -1;
	let lastFrame = performance.now();

	function makeGlow(fill) {
		const sprite = document.createElement('canvas');
		sprite.width = 64;
		sprite.height = 64;
		const paint = sprite.getContext('2d');
		const gradient = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, fill);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
		paint.fillStyle = gradient;
		paint.fillRect(0, 0, 64, 64);
		return sprite;
	}

	function seedRandom(value) {
		let a = value >>> 0;
		return function () {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function roundedRect(x, y, width, height, radius) {
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.arcTo(x + width, y, x + width, y + height, radius);
		ctx.arcTo(x + width, y + height, x, y + height, radius);
		ctx.arcTo(x, y + height, x, y, radius);
		ctx.arcTo(x, y, x + width, y, radius);
		ctx.closePath();
	}

	function paintBackdrop(width, height) {
		const dpr = view.dpr;
		backdrop.width = Math.round(width * dpr);
		backdrop.height = Math.round(height * dpr);
		backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const sky = backCtx.createLinearGradient(0, 0, 0, height);
		sky.addColorStop(0, '#06101f');
		sky.addColorStop(0.55, '#030912');
		sky.addColorStop(1, '#02060c');
		backCtx.fillStyle = sky;
		backCtx.fillRect(0, 0, width, height);

		const cool = backCtx.createRadialGradient(
			width * 0.18, height * 0.18, 0,
			width * 0.18, height * 0.18, width * 0.62
		);
		cool.addColorStop(0, 'rgba(34, 92, 156, 0.20)');
		cool.addColorStop(1, 'rgba(0, 0, 0, 0)');
		backCtx.fillStyle = cool;
		backCtx.fillRect(0, 0, width, height);
		const warm = backCtx.createRadialGradient(
			width * 0.84, height * 0.78, 0,
			width * 0.84, height * 0.78, width * 0.4
		);
		warm.addColorStop(0, 'rgba(120, 62, 150, 0.12)');
		warm.addColorStop(1, 'rgba(0, 0, 0, 0)');
		backCtx.fillStyle = warm;
		backCtx.fillRect(0, 0, width, height);

		const stars = seedRandom(31);
		for (let i = 0; i < STAR_COUNT; i++) {
			const x = stars() * width;
			const y = stars() * height;
			const size = 0.6 + stars() * 1.3;
			backCtx.globalAlpha = 0.18 + stars() * 0.62;
			backCtx.fillStyle = STAR_COLORS[i % STAR_COLORS.length];
			backCtx.fillRect(x, y, size, size);
		}
		backCtx.globalAlpha = 0.5;
		backCtx.strokeStyle = '#bcdcff';
		backCtx.lineWidth = 0.7;
		for (let i = 0; i < 9; i++) {
			const x = stars() * width;
			const y = stars() * height;
			backCtx.beginPath();
			backCtx.moveTo(x - 4, y);
			backCtx.lineTo(x + 4, y);
			backCtx.moveTo(x, y - 4);
			backCtx.lineTo(x, y + 4);
			backCtx.stroke();
		}
		backCtx.globalAlpha = 1;

		backCtx.setTransform(
			dpr * view.scale, 0, 0, dpr * view.scale,
			dpr * view.offX, dpr * view.offY
		);
		backCtx.fillStyle = 'rgba(7, 16, 30, 0.36)';
		backCtx.fillRect(0, 0, OrbitSim.WORLD_W, OrbitSim.WORLD_H);
		backCtx.strokeStyle = 'rgba(96, 150, 200, 0.045)';
		backCtx.lineWidth = 1;
		backCtx.beginPath();
		for (let x = 200; x < OrbitSim.WORLD_W; x += 200) {
			backCtx.moveTo(x, 0);
			backCtx.lineTo(x, OrbitSim.WORLD_H);
		}
		for (let y = 200; y < OrbitSim.WORLD_H; y += 200) {
			backCtx.moveTo(0, y);
			backCtx.lineTo(OrbitSim.WORLD_W, y);
		}
		backCtx.stroke();
		backCtx.strokeStyle = 'rgba(103, 224, 255, 0.10)';
		backCtx.strokeRect(0, 0, OrbitSim.WORLD_W, OrbitSim.WORLD_H);
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
		view.scale = Math.min(
			(width - 28) / OrbitSim.WORLD_W,
			(height - 28) / OrbitSim.WORLD_H
		);
		view.offX = (width - OrbitSim.WORLD_W * view.scale) / 2;
		view.offY = (height - OrbitSim.WORLD_H * view.scale) / 2;
		paintBackdrop(width, height);
		hudAt = -Infinity;
	}

	function updatePortPositions() {
		for (let p = 0; p < sim.portCount; p++) {
			portPX[p] = sim.portX(p, sim.t);
			portPY[p] = sim.portY(p, sim.t);
		}
	}

	function updateShipPositions() {
		for (let ship = 0; ship < sim.shipCount; ship++) {
			if (sim.shipState[ship] === 0) {
				const port = sim.shipDock[ship];
				const angle = sim.shipDockAngle[ship];
				shipPX[ship] = portPX[port] + Math.cos(angle) * DOCK_OFFSET;
				shipPY[ship] = portPY[port] + Math.sin(angle) * DOCK_OFFSET;
				shipAngle[ship] = angle + Math.PI * 0.5;
				continue;
			}
			const span = sim.shipArrive[ship] - sim.shipDepart[ship];
			let f = span > 0 ? (sim.t - sim.shipDepart[ship]) / span : 1;
			if (f < 0) f = 0;
			else if (f > 1) f = 1;
			shipPX[ship] = sim.shipStartX[ship] +
				(sim.shipAimX[ship] - sim.shipStartX[ship]) * f;
			shipPY[ship] = sim.shipStartY[ship] +
				(sim.shipAimY[ship] - sim.shipStartY[ship]) * f;
			shipAngle[ship] = Math.atan2(
				sim.shipAimY[ship] - sim.shipStartY[ship],
				sim.shipAimX[ship] - sim.shipStartX[ship]
			);
		}
	}

	function updateHover() {
		if (pointerX < 0 || pointerY < 0) {
			hoverPort = -1;
			return;
		}
		const wx = (pointerX - view.offX) / view.scale;
		const wy = (pointerY - view.offY) / view.scale;
		const reach = HOVER_PX / view.scale;
		let best = reach * reach;
		let hit = -1;
		for (let p = 0; p < sim.portCount; p++) {
			const dx = portPX[p] - wx;
			const dy = portPY[p] - wy;
			const dist = dx * dx + dy * dy;
			if (dist < best) {
				best = dist;
				hit = p;
			}
		}
		if (hit !== hoverPort) {
			hoverPort = hit;
			updateHoverInfo();
		}
	}

	function orbitTrail(planet, colour) {
		/* fading arc behind the station shows which way the ellipse turns */
		const omega = sim.orbitOmega[planet];
		const phase = sim.orbitPhase[planet] + omega * sim.t;
		const behind = omega < 0;
		ctx.strokeStyle = colour;
		ctx.setLineDash(NO_DASH);
		for (let k = 0; k < 4; k++) {
			const near = phase - (behind ? -1 : 1) * 0.16 * k;
			const far = phase - (behind ? -1 : 1) * 0.16 * (k + 1);
			ctx.beginPath();
			ctx.ellipse(
				sim.planetX[planet], sim.planetY[planet],
				sim.orbitRX[planet], sim.orbitRY[planet],
				sim.orbitTilt[planet], near, far, behind
			);
			ctx.globalAlpha = 0.3 * (1 - k * 0.22);
			ctx.lineWidth = 1.4 - k * 0.25;
			ctx.stroke();
		}
	}

	function drawOrbits() {
		ctx.lineWidth = 1;
		for (let planet = 0; planet < OrbitSim.PLANETS; planet++) {
			const port = sim.planetPort[planet];
			const active = port !== NO_PORT;
			const colour = active ? GOOD_COLORS[sim.portSpec[port]] : '#3a5573';
			ctx.beginPath();
			ctx.ellipse(
				sim.planetX[planet], sim.planetY[planet],
				sim.orbitRX[planet], sim.orbitRY[planet],
				sim.orbitTilt[planet], 0, TAU
			);
			ctx.strokeStyle = colour;
			ctx.globalAlpha = active ? 0.17 : 0.17;
			ctx.setLineDash(active ? NO_DASH : [3, 7]);
			ctx.stroke();
			if (!active) continue;
			orbitTrail(planet, colour);
		}
		ctx.globalAlpha = 1;
		ctx.setLineDash(NO_DASH);
	}

	function drawLinks() {
		ctx.beginPath();
		for (let p = 0; p < sim.portCount; p++) {
			const base = p * OrbitSim.MAX_LINKS;
			const count = sim.partnerCount[p];
			for (let k = 0; k < count; k++) {
				const q = sim.partners[base + k];
				if (q === NO_PORT || q <= p) continue;
				ctx.moveTo(portPX[p], portPY[p]);
				ctx.lineTo(portPX[q], portPY[q]);
			}
		}
		ctx.strokeStyle = 'rgba(126, 180, 230, 0.11)';
		ctx.lineWidth = 0.8;
		ctx.globalAlpha = 1;
		ctx.stroke();
	}

	function drawPlanets() {
		for (let planet = 0; planet < OrbitSim.PLANETS; planet++) {
			const port = sim.planetPort[planet];
			const state = sim.planetState[planet];
			const x = sim.planetX[planet];
			const y = sim.planetY[planet];
			const r = sim.planetR[planet];
			ctx.beginPath();
			ctx.arc(x, y, r, 0, TAU);
			if (state === 1) {
				const colour = GOOD_COLORS[sim.portSpec[port]];
				ctx.fillStyle = '#101d31';
				ctx.fill();
				ctx.strokeStyle = colour;
				ctx.globalAlpha = 0.72;
				ctx.lineWidth = 1.4;
				ctx.setLineDash(NO_DASH);
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(x, y, r + 4, 0, TAU);
				ctx.globalAlpha = 0.12;
				ctx.lineWidth = 2.4;
				ctx.stroke();
				continue;
			}
			ctx.fillStyle = state === 2 ? '#131b16' : '#08111d';
			ctx.fill();
			ctx.strokeStyle = state === 2 ? COLONY_COLOR : 'rgba(78, 108, 138, 0.7)';
			ctx.globalAlpha = state === 2 ? 0.75 : 0.75;
			ctx.lineWidth = 1;
			ctx.setLineDash(state === 2 ? [2, 3] : NO_DASH);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
		ctx.setLineDash(NO_DASH);
	}

	function drawBuilders(now) {
		ctx.lineWidth = 1;
		for (let p = 0; p < sim.portCount; p++) {
			if (sim.builderActive[p] === 0) continue;
			const span = sim.builderArrive[p] - sim.builderDepart[p];
			let f = span > 0 ? (sim.t - sim.builderDepart[p]) / span : 1;
			if (f < 0) f = 0;
			else if (f > 1) f = 1;
			const x = sim.builderStartX[p] + (sim.builderEndX[p] - sim.builderStartX[p]) * f;
			const y = sim.builderStartY[p] + (sim.builderEndY[p] - sim.builderStartY[p]) * f;
			if (showRoutes) {
				ctx.beginPath();
				ctx.moveTo(sim.builderStartX[p], sim.builderStartY[p]);
				ctx.lineTo(sim.builderEndX[p], sim.builderEndY[p]);
				ctx.strokeStyle = COLONY_COLOR;
				ctx.globalAlpha = 0.2;
				ctx.setLineDash([2, 6]);
				ctx.stroke();
			}
			ctx.globalAlpha = 0.5;
			ctx.drawImage(colonyGlow, x - 18, y - 18, 36, 36);
			ctx.beginPath();
			ctx.arc(sim.builderEndX[p], sim.builderEndY[p], 12 + framePulse * 6, 0, TAU);
			ctx.strokeStyle = COLONY_COLOR;
			ctx.globalAlpha = 0.4;
			ctx.setLineDash(NO_DASH);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(x, y - 6);
			ctx.lineTo(x + 4.4, y);
			ctx.lineTo(x, y + 6);
			ctx.lineTo(x - 4.4, y);
			ctx.closePath();
			ctx.fillStyle = COLONY_COLOR;
			ctx.globalAlpha = 0.95;
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		ctx.setLineDash(NO_DASH);
	}

	function drawRoutes() {
		for (let ship = 0; ship < sim.shipCount; ship++) {
			if (sim.shipState[ship] === 0) continue;
			const good = sim.shipGood[ship];
			const colour = good === NO_GOOD ? '#8aa6bd' : GOOD_COLORS[good];
			ctx.beginPath();
			ctx.moveTo(sim.shipStartX[ship], sim.shipStartY[ship]);
			ctx.lineTo(sim.shipAimX[ship], sim.shipAimY[ship]);
			ctx.strokeStyle = colour;
			ctx.globalAlpha = 0.2;
			ctx.lineWidth = 0.9;
			ctx.setLineDash([4, 5]);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(sim.shipAimX[ship], sim.shipAimY[ship], 3.6, 0, TAU);
			ctx.globalAlpha = 0.62;
			ctx.setLineDash(NO_DASH);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
		ctx.setLineDash(NO_DASH);
	}

	function drawStations(now) {
		for (let p = 0; p < sim.portCount; p++) {
			const spec = sim.portSpec[p];
			const colour = GOOD_COLORS[spec];
			const planet = sim.portPlanet[p];
			const x = portPX[p];
			const y = portPY[p];
			ctx.beginPath();
			ctx.moveTo(sim.planetX[planet], sim.planetY[planet]);
			ctx.lineTo(x, y);
			ctx.strokeStyle = colour;
			ctx.globalAlpha = 0.22;
			ctx.lineWidth = 0.8;
			ctx.setLineDash(NO_DASH);
			ctx.stroke();
			ctx.globalAlpha = 0.62;
			ctx.drawImage(glows[spec], x - 24, y - 24, 48, 48);
			ctx.beginPath();
			ctx.moveTo(x, y - STATION_R);
			ctx.lineTo(x + STATION_R, y);
			ctx.lineTo(x, y + STATION_R);
			ctx.lineTo(x - STATION_R, y);
			ctx.closePath();
			ctx.fillStyle = '#06101b';
			ctx.globalAlpha = 1;
			ctx.fill();
			ctx.strokeStyle = colour;
			ctx.lineWidth = 1.6;
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(x, y, 1.7, 0, TAU);
			ctx.fillStyle = colour;
			ctx.fill();
		}

		for (let p = 0; p < sim.portCount; p++) {
			const grown = sim.portProgress[p] / EXPAND_COST;
			const progress = grown > 1 ? 1 : grown;
			const ready = progress >= 1;
			if (progress <= 0.002) continue;
			/* a full ring only pulses while there is still somewhere to expand */
			let alpha = 0.62;
			if (ready) alpha = 0.35;
			if (ready && sim.planetEmpty > 0) alpha = 0.4 + framePulse * 0.55;
			ctx.beginPath();
			ctx.arc(portPX[p], portPY[p], PROGRESS_R,
				-Math.PI * 0.5, -Math.PI * 0.5 + TAU * progress);
			ctx.strokeStyle = COLONY_COLOR;
			ctx.globalAlpha = alpha;
			ctx.lineWidth = ready ? 2.4 : 1.6;
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}

	function drawShips() {
		for (let ship = 0; ship < sim.shipCount; ship++) {
			const x = shipPX[ship];
			const y = shipPY[ship];
			const angle = shipAngle[ship];
			const sailing = sim.shipState[ship] === 1;
			const good = sim.shipGood[ship];
			const colour = good === NO_GOOD ? '#a8bfd3' : GOOD_COLORS[good];
			let size = sailing ? 4.2 : 3.4;
			if (sailing && good !== NO_GOOD) {
				size += 2.4 * Math.min(1, sim.shipAmount[ship] / OrbitSim.SHIP_CAPACITY);
			}
			if (sailing) {
				ctx.beginPath();
				ctx.moveTo(x - Math.cos(angle) * 13, y - Math.sin(angle) * 13);
				ctx.lineTo(x - Math.cos(angle) * 3, y - Math.sin(angle) * 3);
				ctx.strokeStyle = colour;
				ctx.globalAlpha = 0.3;
				ctx.lineWidth = 1.2;
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
			ctx.lineTo(x + Math.cos(angle + 2.6) * size * 0.8,
				y + Math.sin(angle + 2.6) * size * 0.8);
			ctx.lineTo(x + Math.cos(angle - 2.6) * size * 0.8,
				y + Math.sin(angle - 2.6) * size * 0.8);
			ctx.closePath();
			ctx.fillStyle = colour;
			ctx.globalAlpha = 1;
			ctx.fill();
			ctx.strokeStyle = 'rgba(3, 8, 16, 0.85)';
			ctx.lineWidth = 0.7;
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}

	function drawHoverWorld() {
		if (hoverPort < 0) return;
		const spec = sim.portSpec[hoverPort];
		const colour = GOOD_COLORS[spec];
		const x = portPX[hoverPort];
		const y = portPY[hoverPort];
		const base = hoverPort * OrbitSim.MAX_LINKS;
		const count = sim.partnerCount[hoverPort];

		ctx.beginPath();
		ctx.arc(x, y, OrbitSim.EXPAND_RADIUS, 0, TAU);
		ctx.strokeStyle = colour;
		ctx.globalAlpha = 0.17;
		ctx.lineWidth = 1;
		ctx.setLineDash([5, 10]);
		ctx.stroke();

		ctx.beginPath();
		for (let k = 0; k < count; k++) {
			const q = sim.partners[base + k];
			if (q === NO_PORT) continue;
			ctx.moveTo(x, y);
			ctx.lineTo(portPX[q], portPY[q]);
		}
		ctx.strokeStyle = colour;
		ctx.globalAlpha = 0.48;
		ctx.lineWidth = 1.1;
		ctx.setLineDash(NO_DASH);
		ctx.stroke();

		for (let k = 0; k < count; k++) {
			const q = sim.partners[base + k];
			if (q === NO_PORT) continue;
			ctx.beginPath();
			ctx.arc(portPX[q], portPY[q], 9, 0, TAU);
			ctx.strokeStyle = colour;
			ctx.globalAlpha = 0.4;
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		const target = sim.scoreTarget(hoverPort);
		if (target !== NO_PORT) {
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(sim.planetX[target], sim.planetY[target]);
			ctx.strokeStyle = COLONY_COLOR;
			ctx.globalAlpha = 0.45;
			ctx.lineWidth = 1.1;
			ctx.setLineDash([3, 5]);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(sim.planetX[target], sim.planetY[target],
				15 + framePulse * 5, 0, TAU);
			ctx.globalAlpha = 0.6;
			ctx.setLineDash(NO_DASH);
			ctx.stroke();
		}

		ctx.beginPath();
		ctx.arc(x, y, 16, 0, TAU);
		ctx.strokeStyle = colour;
		ctx.globalAlpha = 0.55;
		ctx.lineWidth = 1.2;
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.setLineDash(NO_DASH);
	}

	function drawHoverCard() {
		if (hoverPort < 0 || pointerX < 0) return;
		const width = 224;
		const height = 76;
		let x = pointerX + 18;
		let y = pointerY + 18;
		if (x + width > window.innerWidth - 12) x = pointerX - width - 14;
		if (y + height > window.innerHeight - 12) y = pointerY - height - 14;
		roundedRect(x, y, width, height, 9);
		ctx.fillStyle = 'rgba(5, 13, 24, 0.94)';
		ctx.fill();
		ctx.strokeStyle = GOOD_COLORS[sim.portSpec[hoverPort]];
		ctx.globalAlpha = 0.4;
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillStyle = GOOD_COLORS[sim.portSpec[hoverPort]];
		roundedRect(x, y + 10, 2.5, height - 20, 1.5);
		ctx.fill();
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
		ctx.fillText(hoverTitle, x + 12, y + 18);
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillStyle = '#cfe0f0';
		ctx.fillText(hoverLine1, x + 12, y + 39);
		ctx.fillStyle = '#8fa8bf';
		ctx.fillText(hoverLine2, x + 12, y + 58);
	}

	function draw(now) {
		framePulse = 0.5 + 0.5 * Math.sin(now * 0.005);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(backdrop, 0, 0);
		ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		ctx.save();
		ctx.translate(view.offX, view.offY);
		ctx.scale(view.scale, view.scale);
		if (showOrbits) drawOrbits();
		if (showLinks) drawLinks();
		drawPlanets();
		drawBuilders(now);
		if (showRoutes) drawRoutes();
		drawStations(now);
		drawShips();
		drawHoverWorld();
		ctx.restore();
		drawHoverCard();
	}

	function formatClock(minutes) {
		const total = Math.floor(minutes);
		const hours = Math.floor(total / 60);
		const mins = total % 60;
		return 't+ ' + (hours < 10 ? '0' : '') + hours + ':' +
			(mins < 10 ? '0' : '') + mins;
	}

	function formatShort(minutes) {
		const total = Math.floor(minutes);
		const hours = Math.floor(total / 60);
		const mins = total % 60;
		return (hours < 10 ? '0' : '') + hours + ':' +
			(mins < 10 ? '0' : '') + mins;
	}

	function buildLogRows() {
		for (let i = 0; i < LOG_ROWS; i++) {
			const row = document.createElement('div');
			row.className = 'lrow';
			const time = document.createElement('span');
			time.className = 'lt';
			const kind = document.createElement('span');
			kind.className = 'lk';
			const text = document.createElement('span');
			text.className = 'lm';
			row.appendChild(time);
			row.appendChild(kind);
			row.appendChild(text);
			logBody.appendChild(row);
			logRows.push({ row, time, kind, text });
		}
	}

	function updateLog() {
		const rows = Math.min(sim.logCount, LOG_ROWS);
		for (let i = 0; i < rows; i++) {
			const slot = (sim.logHead - 1 - i + OrbitSim.LOG_SIZE) % OrbitSim.LOG_SIZE;
			const kind = sim.logKind[slot];
			const a = sim.logA[slot];
			const b = sim.logB[slot];
			const good = sim.logGood[slot];
			const amount = sim.logAmount[slot];
			const element = logRows[i];
			element.row.className = 'lrow ' + KIND_CLASS[kind] + (i === 0 ? ' fresh' : '');
			element.time.textContent = formatShort(sim.logTime[slot]);
			element.kind.textContent = KIND_TAGS[kind];
			if (kind === OrbitSim.LOG_START) {
				element.text.textContent = a + ' ports · ' + b + ' empty planets';
			} else if (kind === OrbitSim.LOG_LOAD) {
				element.text.textContent = 'P' + a + ' → P' + b + ' · ' +
					Math.round(amount) + ' ' + GOOD_NAMES[good];
			} else if (kind === OrbitSim.LOG_ARRIVE) {
				element.text.textContent = good === NO_GOOD || amount <= 0
					? 'P' + a + ' · ship docked'
					: 'P' + a + ' ← P' + b + ' · ' + Math.round(amount) + ' ' + GOOD_NAMES[good];
			} else if (kind === OrbitSim.LOG_COLONY) {
				element.text.textContent = 'P' + a + ' → planet ' + b;
			} else {
				element.text.textContent = 'P' + a + ' colony online';
			}
		}
		for (let i = 0; i < LOG_ROWS; i++) {
			logRows[i].row.style.display = i < rows ? '' : 'none';
		}
		lastLogHead = sim.logHead;
	}

	function updateHoverInfo() {
		if (hoverPort < 0) {
			hoverTitle = '';
			hoverLine1 = '';
			hoverLine2 = '';
			return;
		}
		const spec = sim.portSpec[hoverPort];
		const progress = Math.min(1, sim.portProgress[hoverPort] / EXPAND_COST);
		hoverTitle = 'PORT ' + hoverPort + ' · ' + GOOD_NAMES[spec];
		hoverLine1 = 'trade ' + Math.round(sim.portTrade[hoverPort]) +
			' · growth ' + Math.round(progress * 100) + '%';
		if (sim.builderActive[hoverPort] === 1) {
			hoverLine2 = 'colony ship → planet ' + sim.builderTarget[hoverPort];
			return;
		}
		if (progress >= 1) {
			hoverLine2 = 'colony ship ready';
			return;
		}
		const base = hoverPort * OrbitSim.MAX_LINKS;
		const count = sim.partnerCount[hoverPort];
		let links = 'links';
		for (let k = 0; k < count; k++) {
			const q = sim.partners[base + k];
			if (q !== NO_PORT) links += ' ' + q;
		}
		hoverLine2 = count > 0 ? links : 'no neighbours';
	}

	function updateHud(now) {
		if (now - hudAt < HUD_INTERVAL) return;
		hudAt = now;
		clockEl.textContent = formatClock(sim.t);
		portsEl.textContent = sim.portCount + ' / ' + OrbitSim.PLANETS;
		emptyEl.textContent = sim.planetEmpty;
		shipsEl.textContent = sim.shipCount;
		routesEl.textContent = sim.routes;
		deliveredEl.textContent = Math.round(sim.delivered);
		coloniesEl.textContent = sim.coloniesBuilt + ' / ' +
			(OrbitSim.PLANETS - OrbitSim.INITIAL_PORTS);
		aimEl.textContent = sim.maxAimError < 0.0005
			? '0.000 px'
			: sim.maxAimError.toFixed(3) + ' px';
		queueEl.textContent = sim.events.size;
		if (sim.logHead !== lastLogHead) updateLog();
		updateHoverInfo();
	}

	function setPaused(value) {
		paused = value;
		pauseButton.textContent = paused ? 'play' : 'pause';
		pauseButton.classList.toggle('on', paused);
	}

	function setSpeed(value) {
		speed = value;
		speedLabel.textContent = '×' + value;
	}

	function reset() {
		seed = (seed + 1) >>> 0;
		if (seed === 0) seed = 1;
		sim = new OrbitSim(seed);
		sim.setPartners(Number(partnersSlider.value));
		hoverPort = -1;
		lastLogHead = -1;
		hudAt = -Infinity;
		updateHud(performance.now());
	}

	function frame(now) {
		const dt = Math.min(0.1, (now - lastFrame) / 1000);
		lastFrame = now;
		if (!paused && dt > 0) sim.step(dt * speed);
		updatePortPositions();
		updateShipPositions();
		updateHover();
		draw(now);
		updateHud(now);
		requestAnimationFrame(frame);
	}

	speedSlider.addEventListener('input', () => {
		setSpeed(Number(speedSlider.value));
	});
	partnersSlider.addEventListener('input', () => {
		partnersLabel.textContent = partnersSlider.value;
		sim.setPartners(Number(partnersSlider.value));
		hudAt = -Infinity;
	});
	pauseButton.addEventListener('click', () => setPaused(!paused));
	resetButton.addEventListener('click', reset);
	orbitsBox.addEventListener('change', () => {
		showOrbits = orbitsBox.checked;
	});
	linksBox.addEventListener('change', () => {
		showLinks = linksBox.checked;
	});
	routesBox.addEventListener('change', () => {
		showRoutes = routesBox.checked;
	});
	canvas.addEventListener('pointermove', event => {
		const rect = canvas.getBoundingClientRect();
		pointerX = event.clientX - rect.left;
		pointerY = event.clientY - rect.top;
	});
	canvas.addEventListener('pointerleave', () => {
		pointerX = -1;
		pointerY = -1;
		hoverPort = -1;
	});
	window.addEventListener('resize', resize);
	window.addEventListener('keydown', event => {
		if (event.code !== 'Space') return;
		const tag = event.target && event.target.tagName;
		if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
		event.preventDefault();
		setPaused(!paused);
	});

	buildLogRows();
	sim.setPartners(Number(partnersSlider.value));
	setSpeed(Number(speedSlider.value));
	partnersLabel.textContent = partnersSlider.value;
	resize();
	updateLog();
	updateHud(performance.now());
	requestAnimationFrame(frame);
})();
