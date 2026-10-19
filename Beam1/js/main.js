const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const speedSlider = document.getElementById('speed');
const nshipsSlider = document.getElementById('nships');
const speedV = document.getElementById('speedv');
const nshipsV = document.getElementById('nshipsv');
const statsEl = document.getElementById('stats');
const infoEl = document.getElementById('info');

let ports = [];
let ships = [];
let q = PriorityQueue();
let simTime = 0;
let speed = 10;
let lastReal = performance.now();
let processed = 0;
const UNLOAD = 2;
const SHIP_SPEED = 40;

function resize() {
	canvas.width = canvas.clientWidth || 800;
	canvas.height = canvas.clientHeight || 600;
}

function dist(ax, ay, bx, by) {
	const dx = ax - bx;
	const dy = ay - by;
	return Math.hypot(dx, dy);
}

function tryDepart(ship, time) {
	if (ship.state !== 'idle') return false;
	const port = ports[ship.port];
	if (port.goods <= 0) {
		if (!ship.retryScheduled) {
			ship.retryScheduled = true;
			q.push({ time: time + 1, type: 'retry', ship: ship });
		}
		return false;
	}
	let dest = ship.port;
	while (dest === ship.port) dest = (Math.random() * ports.length) | 0;
	const load = Math.min(ship.cap, port.goods);
	port.goods -= load;
	ship.cargo = load;
	ship.from = ship.port;
	ship.to = dest;
	ship.depart = time;
	const d = dist(ports[ship.from].x, ports[ship.from].y, ports[ship.to].x, ports[ship.to].y);
	ship.arrive = time + d / ship.speed;
	ship.state = 'travel';
	ship.port = -1;
	ship.retryScheduled = false;
	q.push({ time: ship.arrive, type: 'arrival', ship: ship });
	return true;
}

function onArrival(ev, time) {
	const s = ev.ship;
	s.port = s.to;
	s.state = 'unloading';
	q.push({ time: time + UNLOAD, type: 'unload', ship: s });
}

function onUnload(ev, time) {
	const s = ev.ship;
	const p = s.to;
	ports[p].goods += s.cargo;
	s.cargo = 0;
	s.port = p;
	s.state = 'idle';
	s.from = null;
	s.to = null;
	for (let i = 0; i < ships.length; i++) {
		if (ships[i].state === 'idle' && ships[i].port === p) tryDepart(ships[i], time);
	}
}

function onRetry(ev, time) {
	const s = ev.ship;
	s.retryScheduled = false;
	if (s.state === 'idle') tryDepart(s, time);
}

function processEvent(ev) {
	if (ev.type === 'arrival') onArrival(ev, ev.time);
	else if (ev.type === 'unload') onUnload(ev, ev.time);
	else if (ev.type === 'retry') onRetry(ev, ev.time);
}

function step(dt) {
	const target = simTime + dt * speed;
	let guard = 0;
	while (q.size() > 0 && q.peek().time <= target && guard < 5000) {
		const ev = q.pop();
		simTime = ev.time;
		processEvent(ev);
		processed++;
		guard++;
	}
	simTime = target;
}

function updatePositions() {
	for (let i = 0; i < ships.length; i++) {
		const s = ships[i];
		if (s.state === 'travel') {
			const span = s.arrive - s.depart;
			let t = span > 0 ? (simTime - s.depart) / span : 1;
			if (t < 0) t = 0;
			if (t > 1) t = 1;
			const a = ports[s.from];
			const b = ports[s.to];
			s.x = a.x + (b.x - a.x) * t;
			s.y = a.y + (b.y - a.y) * t;
		} else if (s.port >= 0) {
			const p = ports[s.port];
			s.x = p.x;
			s.y = p.y;
		}
	}
}

function render() {
	const w = canvas.width;
	const h = canvas.height;
	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = '#0b1d2a';
	ctx.fillRect(0, 0, w, h);
	for (let i = 0; i < ports.length; i++) {
		const p = ports[i];
		ctx.fillStyle = '#2dd4bf';
		ctx.beginPath();
		ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#e6f1f7';
		ctx.font = '12px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText(p.name, p.x, p.y - 18);
		ctx.fillText('g:' + p.goods, p.x, p.y + 4);
		const barH = 60;
		const fillH = Math.min(barH, p.goods * 0.6);
		ctx.fillStyle = 'rgba(45,212,191,0.2)';
		ctx.fillRect(p.x + 16, p.y - barH, 8, barH);
		ctx.fillStyle = '#2dd4bf';
		ctx.fillRect(p.x + 16, p.y - fillH, 8, fillH);
	}
	for (let i = 0; i < ships.length; i++) {
		const s = ships[i];
		ctx.save();
		ctx.translate(s.x, s.y);
		if (s.state === 'travel' && s.from !== null && s.to !== null) {
			const a = ports[s.from];
			const b = ports[s.to];
			ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
		}
		if (s.state === 'travel') ctx.fillStyle = '#fbbf24';
		else if (s.state === 'unloading') ctx.fillStyle = '#f87171';
		else ctx.fillStyle = '#60a5fa';
		ctx.beginPath();
		ctx.moveTo(8, 0);
		ctx.lineTo(-6, 5);
		ctx.lineTo(-6, -5);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}
}

function updateUI() {
	speedV.textContent = speed >= 100 ? speed.toFixed(0) : speed.toFixed(1);
	nshipsV.textContent = nshipsSlider.value;
	statsEl.textContent = 'time ' + simTime.toFixed(1) + '  queue ' + q.size() + '  processed ' + processed + '  ships ' + ships.length;
	const arr = q.toArray().sort(function (a, b) { return a.time - b.time; }).slice(0, 8);
	let txt = '';
	for (let i = 0; i < arr.length; i++) {
		txt += arr[i].time.toFixed(1) + ' ' + arr[i].type + ' ship' + arr[i].ship.id + '  ';
	}
	infoEl.textContent = txt;
}

function init(n) {
	ports = [];
	ships = [];
	q = PriorityQueue();
	simTime = 0;
	processed = 0;
	const w = canvas.width;
	const h = canvas.height;
	const cx = w / 2;
	const cy = h / 2;
	const r = Math.min(w, h) * 0.35;
	const np = 5;
	for (let i = 0; i < np; i++) {
		const a = i / np * Math.PI * 2;
		ports.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, goods: 80 + ((Math.random() * 40) | 0), name: String.fromCharCode(65 + i) });
	}
	for (let i = 0; i < n; i++) {
		const p = (Math.random() * np) | 0;
		ships.push({ id: i, port: p, state: 'idle', cargo: 0, cap: 10 + ((Math.random() * 20) | 0), speed: SHIP_SPEED * (0.8 + Math.random() * 0.4), from: null, to: null, depart: 0, arrive: 0, x: 0, y: 0, retryScheduled: false });
		ships[ships.length - 1].x = ports[p].x;
		ships[ships.length - 1].y = ports[p].y;
	}
	for (let i = 0; i < ships.length; i++) tryDepart(ships[i], 0);
}

function frame(now) {
	const dt = (now - lastReal) / 1000;
	lastReal = now;
	if (dt > 0) step(Math.min(dt, 0.1));
	updatePositions();
	render();
	updateUI();
	requestAnimationFrame(frame);
}

speedSlider.addEventListener('input', function () {
	speed = Math.pow(10, parseFloat(speedSlider.value));
});
nshipsSlider.addEventListener('input', function () {
	nshipsV.textContent = nshipsSlider.value;
});
document.getElementById('reset').addEventListener('click', function () {
	resize();
	init(parseInt(nshipsSlider.value, 10));
});

resize();
init(parseInt(nshipsSlider.value, 10));
requestAnimationFrame(frame);
