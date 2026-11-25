// The Wave — hold to fly up at 45°, release to fly down at 45°. Don't touch anything.
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const titleEl = document.getElementById('title');
  const subtitleEl = document.getElementById('subtitle');
  const promptEl = document.getElementById('prompt');

  // ---------- World ----------
  // The world is 600 units tall; it is scaled to fit the screen height.
  const WORLD_H = 600;
  const BORDER = 30;          // solid floor and ceiling thickness
  const WAVE_R = 7;           // collision radius of the wave
  const SPIKE_H = 22;
  const START_SPEED = 380;    // units per second
  const MAX_SPEED = 600;

  let W = 0, H = 0, DPR = 1, scale = 1, viewW = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    scale = H / WORLD_H;
    viewW = W / scale;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Best score ----------
  const BEST_KEY = 'thewave.best';
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { best = 0; }
  bestEl.textContent = best;

  // ---------- State ----------
  let state = 'ready'; // ready | playing | dead
  let holding = false;
  let wave, obstacles, particles, trail, camX, nextGateX, lastGap, deadTime, shake, score;

  function reset() {
    wave = { x: 0, y: WORLD_H / 2, up: false, speed: START_SPEED };
    trail = [{ x: wave.x, y: wave.y }];
    obstacles = [];
    particles = [];
    camX = wave.x - viewW * 0.3;
    nextGateX = wave.x + viewW * 0.8;
    lastGap = { center: WORLD_H / 2, size: 260 };
    deadTime = 0;
    shake = 0;
    score = 0;
    scoreEl.textContent = '0';
  }
  reset();

  // ---------- Level generation ----------
  const rand = (a, b) => a + Math.random() * (b - a);

  // Difficulty 0..1 based on distance travelled.
  const difficulty = () => Math.min(1, wave.x / 30000);

  function addGate() {
    const d = difficulty();
    const width = rand(40, 90 + 60 * d);
    const spacing = rand(300, 420) - 120 * d;
    const size = Math.max(115, rand(230, 280) - 130 * d); // clear gap between spike tips

    // Keep the next gap reachable: the wave moves 1 unit up/down per unit forward.
    const maxShift = (spacing - width) * 0.75;
    const minC = BORDER + size / 2 + SPIKE_H + 10;
    const maxC = WORLD_H - BORDER - size / 2 - SPIKE_H - 10;
    let center = lastGap.center + rand(-maxShift, maxShift);
    center = Math.max(minC, Math.min(maxC, center));

    const x = nextGateX;
    const topEnd = center - size / 2 - SPIKE_H;    // bottom edge of top pillar
    const botStart = center + size / 2 + SPIKE_H;  // top edge of bottom pillar

    obstacles.push({ type: 'rect', x, y: 0, w: width, h: topEnd });
    obstacles.push({ type: 'rect', x, y: botStart, w: width, h: WORLD_H - botStart });

    // A row of spikes on each pillar tip, pointing into the gap.
    const n = Math.max(1, Math.round(width / 28));
    const sw = width / n;
    for (let i = 0; i < n; i++) {
      const sx = x + i * sw;
      obstacles.push({ type: 'spike', pts: [[sx, topEnd], [sx + sw, topEnd], [sx + sw / 2, topEnd + SPIKE_H]] });
      obstacles.push({ type: 'spike', pts: [[sx, botStart], [sx + sw, botStart], [sx + sw / 2, botStart - SPIKE_H]] });
    }

    // Sometimes add spikes on the floor or ceiling between gates.
    if (Math.random() < 0.35 + 0.3 * d) {
      const onFloor = Math.random() < 0.5;
      const count = Math.floor(rand(2, 5));
      const startX = x + width + rand(40, Math.max(50, spacing - width - 40 - count * 26));
      for (let i = 0; i < count; i++) {
        const sx = startX + i * 26;
        if (onFloor) {
          const yb = WORLD_H - BORDER;
          obstacles.push({ type: 'spike', pts: [[sx, yb], [sx + 26, yb], [sx + 13, yb - SPIKE_H * 1.4]] });
        } else {
          obstacles.push({ type: 'spike', pts: [[sx, BORDER], [sx + 26, BORDER], [sx + 13, BORDER + SPIKE_H * 1.4]] });
        }
      }
    }

    lastGap = { center, size };
    nextGateX = x + spacing;
  }

  // ---------- Collision ----------
  function circleRect(cx, cy, r, o) {
    const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
    const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function pointInTri(px, py, [a, b, c]) {
    const s = (p1, p2) => (px - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (py - p2[1]);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }
  function circleTri(cx, cy, r, pts) {
    if (pointInTri(cx, cy, pts)) return true;
    for (let i = 0; i < 3; i++) {
      const a = pts[i], b = pts[(i + 1) % 3];
      if (distToSeg(cx, cy, a[0], a[1], b[0], b[1]) < r) return true;
    }
    return false;
  }

  function collides() {
    if (wave.y - WAVE_R < BORDER || wave.y + WAVE_R > WORLD_H - BORDER) return true;
    for (const o of obstacles) {
      if (o.type === 'rect') {
        if (o.x > wave.x + 50 || o.x + o.w < wave.x - 50) continue;
        if (circleRect(wave.x, wave.y, WAVE_R, o)) return true;
      } else {
        if (o.pts[0][0] > wave.x + 50 || o.pts[1][0] < wave.x - 50) continue;
        if (circleTri(wave.x, wave.y, WAVE_R * 0.85, o.pts)) return true;
      }
    }
    return false;
  }

  // ---------- Input ----------
  function press() {
    if (state === 'ready') { start(); }
    else if (state === 'dead') {
      if (performance.now() - deadTime > 500) { reset(); start(); }
      return;
    }
    setHold(true);
  }
  function release() { setHold(false); }

  function setHold(h) {
    if (holding === h) return;
    holding = h;
    if (state === 'playing') {
      wave.up = h;
      trail.push({ x: wave.x, y: wave.y }); // corner of the zigzag
    }
  }

  window.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (!e.repeat) press();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') release();
  });

  function start() {
    state = 'playing';
    overlay.classList.add('hidden');
    wave.up = holding;
  }

  function die() {
    state = 'dead';
    deadTime = performance.now();
    shake = 14;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(80, 420);
      particles.push({ x: wave.x, y: wave.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, 0.9), max: 0.9 });
    }
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ }
    }
    titleEl.textContent = 'CRASHED';
    subtitleEl.textContent = `Score: ${score}${score === best && score > 0 ? '  (new best!)' : ''}`;
    promptEl.textContent = 'Tap, click or press Space to retry';
    setTimeout(() => { if (state === 'dead') overlay.classList.remove('hidden'); }, 450);
  }

  // ---------- Update ----------
  function update(dt) {
    if (state === 'playing') {
      wave.speed = Math.min(MAX_SPEED, START_SPEED + wave.x / 150);
      // 45°: vertical speed equals horizontal speed.
      wave.x += wave.speed * dt;
      wave.y += (wave.up ? -1 : 1) * wave.speed * dt;
      camX = wave.x - viewW * 0.3;

      while (nextGateX < camX + viewW + 200) addGate();
      obstacles = obstacles.filter((o) => (o.type === 'rect' ? o.x + o.w : o.pts[1][0]) > camX - 50);
      while (trail.length > 2 && trail[1].x < camX - 20) trail.shift();

      score = Math.floor(wave.x / 50);
      scoreEl.textContent = score;

      if (collides()) die();
    }

    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.95; p.vy *= 0.95;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    shake = Math.max(0, shake - dt * 40);
  }

  // ---------- Render ----------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#070815';
    ctx.fillRect(0, 0, W, H);

    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, (-camX * scale + sx) * DPR, sy * DPR);

    // Background grid (scrolls slower for depth).
    ctx.strokeStyle = 'rgba(120,130,220,0.08)';
    ctx.lineWidth = 1;
    const gx = camX * 0.5;
    const step = 60;
    ctx.beginPath();
    for (let x = Math.floor(gx / step) * step; x < gx + viewW + step; x += step) {
      const wx = x - gx + camX;
      ctx.moveTo(wx, 0); ctx.lineTo(wx, WORLD_H);
    }
    for (let y = 0; y <= WORLD_H; y += step) { ctx.moveTo(camX, y); ctx.lineTo(camX + viewW, y); }
    ctx.stroke();

    // Floor and ceiling.
    ctx.fillStyle = '#141633';
    ctx.fillRect(camX - 10, 0, viewW + 20, BORDER);
    ctx.fillRect(camX - 10, WORLD_H - BORDER, viewW + 20, BORDER);
    ctx.strokeStyle = '#ff4f8b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(camX - 10, BORDER); ctx.lineTo(camX + viewW + 10, BORDER);
    ctx.moveTo(camX - 10, WORLD_H - BORDER); ctx.lineTo(camX + viewW + 10, WORLD_H - BORDER);
    ctx.stroke();

    // Obstacles.
    for (const o of obstacles) {
      if (o.type === 'rect') {
        ctx.fillStyle = '#141633';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = '#ff4f8b';
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      } else {
        ctx.fillStyle = '#ff4f8b';
        ctx.beginPath();
        ctx.moveTo(o.pts[0][0], o.pts[0][1]);
        ctx.lineTo(o.pts[1][0], o.pts[1][1]);
        ctx.lineTo(o.pts[2][0], o.pts[2][1]);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Zigzag trail.
    if (state !== 'ready' || trail.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(94,242,255,0.85)';
      ctx.shadowColor = '#5ef2ff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
      ctx.lineTo(wave.x, wave.y);
      ctx.stroke();
      ctx.restore();
    }

    // The wave (arrow), pointing along its 45° direction.
    if (state !== 'dead') {
      ctx.save();
      ctx.translate(wave.x, wave.y);
      ctx.rotate(wave.up ? -Math.PI / 4 : Math.PI / 4);
      ctx.shadowColor = '#5ef2ff';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#eafdff';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -11);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-10, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Crash particles.
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = '#5ef2ff';
      ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
