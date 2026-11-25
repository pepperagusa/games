// The Wave — hold to fly up at 45°, release to fly down at 45°. 20 levels + a level editor.
(() => {
  'use strict';

  const WL = window.WaveLevels;
  const { CELL, ROWS, WORLD_H, BLOCK, SPIKE, SLOPE } = WL;
  const COLORS = { bg: '#070815', solid: '#141633', edge: '#ff4f8b', wave: '#5ef2ff', gold: '#ffd166' };

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  // ---------- Canvas sizing ----------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  // Play view: fit the 600-unit-tall world, but always show at least ~720 units ahead.
  function playView() {
    const scale = Math.min(H / WORLD_H, W / 720);
    return { scale, offY: (H - WORLD_H * scale) / 2, viewW: W / scale };
  }
  function editorView() {
    const top = $('edTop').offsetHeight, bot = $('edBottom').offsetHeight;
    const scale = Math.max(0.2, (H - top - bot) / WORLD_H);
    return { scale, offY: top, viewW: W / scale };
  }

  // ---------- Storage ----------
  function load(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
  }
  const progress = load('thewave.progress', { done: [], best: [] });
  let customs = load('thewave.custom', []);

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  // ---------- Screens ----------
  let screen = 'menu';
  const PANELS = ['menu', 'levels', 'mylevels', 'hud', 'msg', 'edTop', 'edBottom'];
  function showScreen(name) {
    screen = name;
    for (const id of PANELS) $(id).classList.add('hidden');
    if (name === 'menu') $('menu').classList.remove('hidden');
    if (name === 'levels') { buildLevelGrid(); $('levels').classList.remove('hidden'); }
    if (name === 'mylevels') { buildCustomList(); $('mylevels').classList.remove('hidden'); }
    if (name === 'play') $('hud').classList.remove('hidden');
    if (name === 'editor') {
      $('edTop').classList.remove('hidden');
      $('edBottom').classList.remove('hidden');
      syncEditorUI();
    }
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.go)));
  $('btnPlay').addEventListener('click', () => showScreen('levels'));
  $('btnCreate').addEventListener('click', () => showScreen('mylevels'));

  // ---------- Level select ----------
  const isUnlocked = (i) => i === 0 || !!progress.done[i - 1];
  function buildLevelGrid() {
    const grid = $('levelGrid');
    grid.innerHTML = '';
    for (let i = 0; i < WL.COUNT; i++) {
      const b = document.createElement('button');
      const unlocked = isUnlocked(i);
      b.className = 'level-btn' + (progress.done[i] ? ' done' : '') + (unlocked ? '' : ' locked');
      b.disabled = !unlocked;
      b.title = WL.getLevel(i).name;
      const pct = progress.done[i] ? '★ done' : unlocked ? `${progress.best[i] || 0}%` : '🔒';
      b.innerHTML = `<span class="num">${i + 1}</span><span class="pct">${pct}</span>`;
      b.addEventListener('click', () => startPlay(WL.getLevel(i), { kind: 'level', index: i }));
      grid.appendChild(b);
    }
  }

  // ---------- Custom levels list ----------
  function saveCustoms() { store('thewave.custom', customs); }
  function buildCustomList() {
    const list = $('customList');
    list.innerHTML = '';
    $('customEmpty').classList.toggle('hidden', customs.length > 0);
    for (const lv of customs) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = lv.name;
      li.appendChild(name);
      const add = (label, fn, cls) => {
        const b = document.createElement('button');
        b.textContent = label;
        if (cls) b.className = cls;
        b.addEventListener('click', fn);
        li.appendChild(b);
      };
      add('▶ Play', () => startPlay(lv, { kind: 'custom', id: lv.id }), 'primary');
      add('Edit', () => openEditor(lv));
      add('Share', () => shareLevel(lv));
      add('Delete', () => {
        if (!confirm(`Delete "${lv.name}"?`)) return;
        customs = customs.filter((x) => x.id !== lv.id);
        saveCustoms();
        buildCustomList();
      });
      list.appendChild(li);
    }
  }

  function encodeLevel(lv) {
    const json = JSON.stringify({ n: lv.name, s: lv.speed, o: lv.objects });
    return 'WAVE1:' + btoa(unescape(encodeURIComponent(json)));
  }
  function decodeLevel(code) {
    const raw = code.trim().replace(/^WAVE1:/, '');
    const obj = JSON.parse(decodeURIComponent(escape(atob(raw))));
    const speed = Number(obj.s);
    if (!Array.isArray(obj.o) || !(speed >= 200 && speed <= 800)) throw new Error('bad level');
    const objects = obj.o.filter((o) => Array.isArray(o) && o.length >= 3 &&
      Number.isInteger(o[0]) && o[0] >= 0 && o[0] < 5000 &&
      Number.isInteger(o[1]) && o[1] >= 1 && o[1] <= ROWS - 2 &&
      (o[2] === BLOCK || o[2] === SPIKE || o[2] === SLOPE)).map((o) => [o[0], o[1], o[2], (o[3] | 0) & 3]);
    return { name: String(obj.n || 'Imported level').slice(0, 30), speed, objects };
  }
  function shareLevel(lv) {
    const code = encodeLevel(lv);
    const fallback = () => prompt('Copy this level code:', code);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => toast('Level code copied!'), fallback);
    } else fallback();
  }
  $('btnImport').addEventListener('click', () => {
    const code = prompt('Paste a level code:');
    if (!code) return;
    try {
      const lv = decodeLevel(code);
      lv.id = 'lv' + Date.now();
      customs.push(lv);
      saveCustoms();
      buildCustomList();
      toast(`Imported "${lv.name}"`);
    } catch {
      toast('That code is not a valid level');
    }
  });
  $('btnNewLevel').addEventListener('click', () => openEditor(null));

  // ---------- Playing ----------
  let play = null;
  let holding = false;

  function startPlay(data, source) {
    play = { data, L: WL.compile(data), source, attempts: 0 };
    showScreen('play');
    $('hudName').textContent = source.kind === 'level' ? `${source.index + 1}. ${data.name}` : data.name;
    resetRun();
    play.state = 'ready';
    showMsg({
      title: source.kind === 'level' ? `Level ${source.index + 1}` : source.kind === 'test' ? 'Test run' : data.name,
      sub: source.kind === 'level' ? data.name : 'Reach the finish line',
      prompt: 'Tap, click or press Space to start',
      buttons: [],
    });
  }

  function resetRun() {
    play.attempts++;
    play.wave = { x: 0, y: WORLD_H / 2, up: false };
    play.trail = [{ x: 0, y: WORLD_H / 2 }];
    play.particles = [];
    play.shake = 0;
    play.pct = 0;
    $('hudAttempt').textContent = `Attempt ${play.attempts}`;
    updateHud();
  }

  function showMsg({ title, sub, prompt, buttons, win }) {
    $('msgTitle').textContent = title;
    $('msgSub').textContent = sub || '';
    $('msgPrompt').textContent = prompt || '';
    const box = $('msgButtons');
    box.innerHTML = '';
    for (const [label, fn, primary] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.addEventListener('click', fn);
      box.appendChild(b);
    }
    $('msg').classList.toggle('win', !!win);
    $('msg').classList.remove('hidden');
  }
  const hideMsg = () => $('msg').classList.add('hidden');

  function exitPlay() {
    holding = false;
    const s = play.source;
    if (s.kind === 'test') showScreen('editor');
    else if (s.kind === 'custom') showScreen('mylevels');
    else showScreen('levels');
  }
  $('btnQuit').addEventListener('click', exitPlay);

  function setUp(v) {
    const w = play.wave;
    if (w.up === v) return;
    w.up = v;
    play.trail.push({ x: w.x, y: w.y });
  }

  function press() {
    holding = true;
    if (screen !== 'play' || !play) return;
    if (play.state === 'ready') {
      hideMsg();
      play.state = 'playing';
      setUp(true);
    } else if (play.state === 'dead') {
      if (performance.now() - play.deadAt < 350) return;
      hideMsg();
      resetRun();
      play.state = 'playing';
      setUp(true);
    } else if (play.state === 'playing') {
      setUp(true);
    }
  }
  function release() {
    holding = false;
    if (screen === 'play' && play && play.state === 'playing') setUp(false);
  }

  function updateHud() {
    $('hudPct').textContent = `${play.pct}%`;
    $('progressFill').style.width = `${play.pct}%`;
  }

  function die() {
    const w = play.wave;
    play.state = 'dead';
    play.deadAt = performance.now();
    play.shake = 14;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 340;
      play.particles.push({ x: w.x, y: w.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.5, max: 0.9 });
    }
    const s = play.source;
    let sub = `${play.pct}%`;
    if (s.kind === 'level') {
      const prev = progress.best[s.index] || 0;
      if (play.pct > prev) {
        progress.best[s.index] = play.pct;
        store('thewave.progress', progress);
        if (prev > 0) sub += '  — new best!';
      }
    }
    const back = s.kind === 'test' ? 'Editor' : s.kind === 'custom' ? 'Back' : 'Levels';
    setTimeout(() => {
      if (play && play.state === 'dead' && screen === 'play') {
        showMsg({ title: 'CRASHED', sub, prompt: 'Tap or press Space to retry', buttons: [[back, exitPlay]] });
      }
    }, 350);
  }

  function win() {
    const s = play.source;
    play.state = 'won';
    play.pct = 100;
    updateHud();
    const buttons = [];
    if (s.kind === 'level') {
      progress.done[s.index] = true;
      progress.best[s.index] = 100;
      store('thewave.progress', progress);
      if (s.index + 1 < WL.COUNT) {
        buttons.push(['Next level ▶', () => startPlay(WL.getLevel(s.index + 1), { kind: 'level', index: s.index + 1 }), true]);
      }
      buttons.push(['Levels', exitPlay]);
    } else if (s.kind === 'test') {
      buttons.push(['Back to editor', exitPlay, true]);
    } else {
      buttons.push(['Play again', () => startPlay(play.data, play.source), true]);
      buttons.push(['Back', exitPlay]);
    }
    const last = s.kind === 'level' && s.index === WL.COUNT - 1;
    showMsg({
      title: last ? 'YOU BEAT THE WAVE!' : 'LEVEL COMPLETE',
      sub: `${play.data.name} — ${play.attempts} attempt${play.attempts === 1 ? '' : 's'}`,
      buttons,
      win: true,
    });
  }

  function updatePlay(dt) {
    const p = play;
    if (p.state === 'playing') {
      const w = p.wave;
      const end = p.L.length * CELL;
      const dist = p.L.speed * dt;
      const steps = Math.max(1, Math.ceil(dist / 4));
      const dx = dist / steps;
      for (let i = 0; i < steps; i++) {
        w.x += dx;
        w.y += (w.up ? -1 : 1) * dx; // 45°: vertical speed equals horizontal speed
        if (WL.collide(p.L, w.x, w.y)) { die(); break; }
        if (w.x >= end) { win(); break; }
      }
      const pct = Math.min(100, Math.floor((w.x / end) * 100));
      if (pct !== p.pct) { p.pct = pct; updateHud(); }
      const camX = w.x - playView().viewW * 0.3;
      while (p.trail.length > 2 && p.trail[1].x < camX - 20) p.trail.shift();
    }
    for (const q of p.particles) {
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.95; q.vy *= 0.95;
      q.life -= dt;
    }
    p.particles = p.particles.filter((q) => q.life > 0);
    p.shake = Math.max(0, p.shake - dt * 40);
  }

  // ---------- Editor ----------
  const editor = {
    id: null, map: new Map(), speed: 400, camX: -2 * CELL,
    tool: 'block', dir: WL.UP, drag: null, hover: null, dirty: false, L: null,
  };
  const DIR_ARROWS = ['▲', '▶', '▼', '◀'];
  const SLOPE_GLYPHS = ['◣', '◢', '◥', '◤'];

  function openEditor(lv) {
    editor.id = lv ? lv.id : null;
    editor.map = new Map();
    if (lv) for (const [c, r, t, dir] of lv.objects) editor.map.set(c * ROWS + r, { c, r, t, dir: dir || 0 });
    editor.speed = lv ? lv.speed : 400;
    editor.camX = -2 * CELL;
    editor.dirty = false;
    $('edName').value = lv ? lv.name : '';
    $('edSpeed').value = String(editor.speed);
    if ($('edSpeed').value !== String(editor.speed)) {
      const o = document.createElement('option');
      o.value = String(editor.speed);
      o.textContent = `Custom (${editor.speed})`;
      $('edSpeed').appendChild(o);
      $('edSpeed').value = String(editor.speed);
    }
    recompileEditor();
    showScreen('editor');
  }

  function editorData() {
    return {
      name: $('edName').value.trim() || 'Untitled level',
      speed: editor.speed,
      objects: [...editor.map.values()].map((o) => [o.c, o.r, o.t, o.dir]),
    };
  }
  function recompileEditor() {
    editor.L = WL.compile(editorData());
    syncScroll();
  }

  function syncEditorUI() {
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === editor.tool));
    $('edDir').textContent = `⟳ ${editor.tool === 'spike' ? DIR_ARROWS[editor.dir] : SLOPE_GLYPHS[editor.dir]}`;
    syncScroll();
  }
  function maxCam() { return (editor.L.length + 5) * CELL - editorView().viewW; }
  function clampCam() { editor.camX = Math.max(-2 * CELL, Math.min(Math.max(-2 * CELL, maxCam()), editor.camX)); }
  function syncScroll() {
    if (!editor.L) return;
    const s = $('edScroll');
    s.max = String(Math.max(0, Math.round(maxCam() + 2 * CELL)));
    s.value = String(Math.round(editor.camX + 2 * CELL));
  }

  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => { editor.tool = b.dataset.tool; syncEditorUI(); }));
  $('edDir').addEventListener('click', () => { editor.dir = (editor.dir + 1) % 4; syncEditorUI(); });
  $('edSpeed').addEventListener('change', (e) => { editor.speed = Number(e.target.value); editor.dirty = true; });
  $('edName').addEventListener('input', () => { editor.dirty = true; });
  $('edScroll').addEventListener('input', (e) => { editor.camX = Number(e.target.value) - 2 * CELL; });
  $('edClear').addEventListener('click', () => {
    if (editor.map.size && confirm('Remove everything from this level?')) {
      editor.map.clear();
      editor.dirty = true;
      recompileEditor();
    }
  });
  $('edBack').addEventListener('click', () => {
    if (editor.dirty && !confirm('Leave without saving your changes?')) return;
    showScreen('mylevels');
  });
  $('edSave').addEventListener('click', () => {
    const data = editorData();
    if (!editor.id) editor.id = 'lv' + Date.now();
    const lv = { id: editor.id, ...data };
    const idx = customs.findIndex((x) => x.id === editor.id);
    if (idx >= 0) customs[idx] = lv; else customs.push(lv);
    saveCustoms();
    $('edName').value = data.name;
    editor.dirty = false;
    toast('Saved!');
  });
  $('edTest').addEventListener('click', () => startPlay(editorData(), { kind: 'test' }));

  function cellAt(clientX, clientY) {
    const v = editorView();
    const wx = editor.camX + clientX / v.scale;
    const wy = (clientY - v.offY) / v.scale;
    return { c: Math.floor(wx / CELL), r: Math.floor(wy / CELL) };
  }

  function applyTool(c, r, mode) {
    if (c < 0 || r < 1 || r > ROWS - 2) return;
    const key = c * ROWS + r;
    const cur = editor.map.get(key);
    if (mode === 'erase') {
      if (!cur) return;
      editor.map.delete(key);
    } else if (mode === 'block') {
      if (cur && cur.t === BLOCK) return;
      editor.map.set(key, { c, r, t: BLOCK, dir: 0 });
    } else if (mode === 'spike' || mode === 'slope') {
      const t = mode === 'spike' ? SPIKE : SLOPE;
      if (cur && cur.t === t && cur.dir === editor.dir) return;
      editor.map.set(key, { c, r, t, dir: editor.dir });
    }
    editor.dirty = true;
    recompileEditor();
  }

  function editorPointerDown(e) {
    const { c, r } = cellAt(e.clientX, e.clientY);
    if (editor.tool === 'pan' || e.button === 1) {
      editor.drag = { mode: 'pan', startX: e.clientX, startCam: editor.camX };
      return;
    }
    let mode = e.button === 2 ? 'erase' : editor.tool;
    if (mode === 'spike' || mode === 'slope') {
      // Tapping an existing slope/spike of the same kind rotates it.
      const cur = editor.map.get(c * ROWS + r);
      if (cur && cur.t === (mode === 'spike' ? SPIKE : SLOPE)) {
        cur.dir = (cur.dir + 1) % 4;
        editor.dir = cur.dir;
        editor.dirty = true;
        recompileEditor();
        syncEditorUI();
        return;
      }
    }
    editor.drag = { mode, last: `${c},${r}` };
    applyTool(c, r, mode);
  }
  function editorPointerMove(e) {
    const { c, r } = cellAt(e.clientX, e.clientY);
    editor.hover = e.pointerType === 'mouse' ? { c, r } : null;
    const d = editor.drag;
    if (!d) return;
    if (d.mode === 'pan') {
      editor.camX = d.startCam - (e.clientX - d.startX) / editorView().scale;
      clampCam();
      syncScroll();
    } else if (`${c},${r}` !== d.last) {
      d.last = `${c},${r}`;
      applyTool(c, r, d.mode);
    }
  }

  canvas.addEventListener('wheel', (e) => {
    if (screen !== 'editor') return;
    e.preventDefault();
    editor.camX += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / editorView().scale;
    clampCam();
    syncScroll();
  }, { passive: false });

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (screen === 'play') press();
    else if (screen === 'editor') { canvas.setPointerCapture(e.pointerId); editorPointerDown(e); }
  });
  canvas.addEventListener('pointermove', (e) => { if (screen === 'editor') editorPointerMove(e); });
  canvas.addEventListener('pointerleave', () => { editor.hover = null; });
  const endPointer = () => { release(); editor.drag = null; };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  window.addEventListener('blur', endPointer);
  window.addEventListener('contextmenu', (e) => { if (e.target === canvas) e.preventDefault(); });

  const FLY_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (screen === 'play') {
      if (FLY_KEYS.includes(e.code)) {
        e.preventDefault();
        if (e.repeat) return;
        if (play.state === 'won') { const b = $('msgButtons').querySelector('button'); if (b) b.click(); return; }
        press();
      } else if (e.code === 'Escape') exitPlay();
    } else if (screen === 'editor') {
      const tools = { Digit1: 'block', Digit2: 'slope', Digit3: 'spike', Digit4: 'erase', Digit5: 'pan' };
      if (tools[e.code]) { editor.tool = tools[e.code]; syncEditorUI(); }
      else if (e.code === 'KeyR') { editor.dir = (editor.dir + 1) % 4; syncEditorUI(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { editor.camX += CELL * 3; clampCam(); syncScroll(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { editor.camX -= CELL * 3; clampCam(); syncScroll(); }
    }
  });
  window.addEventListener('keyup', (e) => { if (FLY_KEYS.includes(e.code)) release(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });

  // ---------- Rendering ----------
  function drawWorld(L, camX, view, opts = {}) {
    const { scale, offY, viewW } = view;
    const sx = opts.shake ? (Math.random() - 0.5) * opts.shake : 0;
    const sy = opts.shake ? (Math.random() - 0.5) * opts.shake : 0;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, (-camX * scale + sx) * DPR, (offY + sy) * DPR);

    // Background grid.
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    if (opts.editor) {
      ctx.strokeStyle = 'rgba(120,130,220,0.16)';
      const c0 = Math.floor(camX / CELL);
      for (let c = c0; c * CELL < camX + viewW; c++) { ctx.moveTo(c * CELL, CELL); ctx.lineTo(c * CELL, WORLD_H - CELL); }
      for (let r = 1; r < ROWS; r++) { ctx.moveTo(camX, r * CELL); ctx.lineTo(camX + viewW, r * CELL); }
    } else {
      ctx.strokeStyle = 'rgba(120,130,220,0.07)';
      const gx = camX * 0.5, step = 60;
      for (let x = Math.floor(gx / step) * step; x < gx + viewW + step; x += step) {
        const wx = x - gx + camX;
        ctx.moveTo(wx, 0); ctx.lineTo(wx, WORLD_H);
      }
      for (let y = 0; y <= WORLD_H; y += step) { ctx.moveTo(camX, y); ctx.lineTo(camX + viewW, y); }
    }
    ctx.stroke();

    // Ceiling and floor.
    ctx.fillStyle = COLORS.solid;
    ctx.fillRect(camX - 10, 0, viewW + 20, CELL);
    ctx.fillRect(camX - 10, WORLD_H - CELL, viewW + 20, CELL);

    // Blocks and spikes in view.
    const c0 = Math.floor(camX / CELL) - 1, c1 = Math.ceil((camX + viewW) / CELL) + 1;
    // Is side `side` of cell (c, r) fully solid? Used to hide edges between touching pieces.
    const solid = (c, r, side) => r <= 0 || r >= ROWS - 1 || WL.fullSides(L.map.get(c * ROWS + r)).includes(side);
    ctx.fillStyle = COLORS.solid;
    ctx.beginPath();
    const edges = new Path2D();
    const spikes = new Path2D();
    const slopes = new Path2D();
    for (let c = c0; c <= c1; c++) {
      for (let r = 1; r < ROWS - 1; r++) {
        const o = L.map.get(c * ROWS + r);
        if (!o) continue;
        const x = c * CELL, y = r * CELL;
        if (o.t === BLOCK) {
          ctx.rect(x, y, CELL, CELL);
          if (!solid(c, r - 1, 'b')) { edges.moveTo(x, y); edges.lineTo(x + CELL, y); }
          if (!solid(c, r + 1, 't')) { edges.moveTo(x, y + CELL); edges.lineTo(x + CELL, y + CELL); }
          if (!solid(c - 1, r, 'r')) { edges.moveTo(x, y); edges.lineTo(x, y + CELL); }
          if (!solid(c + 1, r, 'l')) { edges.moveTo(x + CELL, y); edges.lineTo(x + CELL, y + CELL); }
        } else if (o.t === SLOPE) {
          const p = WL.slopePoints(c, r, o.dir); // [leg end, right-angle corner, leg end]
          slopes.moveTo(p[0][0], p[0][1]); slopes.lineTo(p[1][0], p[1][1]); slopes.lineTo(p[2][0], p[2][1]); slopes.closePath();
          edges.moveTo(p[0][0], p[0][1]); edges.lineTo(p[2][0], p[2][1]); // the diagonal face
          const legs = WL.fullSides(o);
          const nb = { t: [0, -1, 'b'], b: [0, 1, 't'], l: [-1, 0, 'r'], r: [1, 0, 'l'] };
          for (const side of legs) {
            const [dc, dr, opp] = nb[side];
            if (solid(c + dc, r + dr, opp)) continue;
            const x0 = side === 'r' ? x + CELL : x, y0 = side === 'b' ? y + CELL : y;
            edges.moveTo(x0, y0);
            if (side === 't' || side === 'b') edges.lineTo(x0 + CELL, y0); else edges.lineTo(x0, y0 + CELL);
          }
        } else {
          const p = WL.spikePoints(c, r, o.dir, 0.92);
          spikes.moveTo(p[0][0], p[0][1]); spikes.lineTo(p[1][0], p[1][1]); spikes.lineTo(p[2][0], p[2][1]); spikes.closePath();
        }
      }
    }
    ctx.fill();
    ctx.fill(slopes);
    // Floor/ceiling edge lines, skipping where blocks touch them.
    for (let c = c0; c <= c1; c++) {
      if (!solid(c, 1, 't')) { edges.moveTo(c * CELL, CELL); edges.lineTo(c * CELL + CELL, CELL); }
      if (!solid(c, ROWS - 2, 'b')) { edges.moveTo(c * CELL, WORLD_H - CELL); edges.lineTo(c * CELL + CELL, WORLD_H - CELL); }
    }
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 2;
    ctx.stroke(edges);
    ctx.fillStyle = COLORS.edge;
    ctx.fill(spikes);

    // Finish line.
    const fx = L.length * CELL;
    if (fx > camX - 20 && fx < camX + viewW + 20) {
      for (let r = 1; r < ROWS - 1; r++) {
        for (let k = 0; k < 2; k++) {
          ctx.fillStyle = (r + k) % 2 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.15)';
          ctx.fillRect(fx + k * (CELL / 2), r * CELL, CELL / 2, CELL);
        }
      }
    }
  }

  function drawWave(w, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w.x, w.y);
    ctx.rotate(w.up ? -Math.PI / 4 : Math.PI / 4);
    ctx.shadowColor = COLORS.wave;
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#eafdff';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function renderPlay() {
    const view = playView();
    const p = play;
    const camX = p.wave.x - view.viewW * 0.3;
    drawWorld(p.L, camX, view, { shake: p.shake });

    // Zigzag trail.
    ctx.save();
    ctx.strokeStyle = 'rgba(94,242,255,0.85)';
    ctx.shadowColor = COLORS.wave;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p.trail[0].x, p.trail[0].y);
    for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
    ctx.lineTo(p.wave.x, p.wave.y);
    ctx.stroke();
    ctx.restore();

    if (p.state !== 'dead') drawWave(p.wave);

    for (const q of p.particles) {
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = COLORS.wave;
      ctx.fillRect(q.x - 2.5, q.y - 2.5, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  function renderEditor() {
    const view = editorView();
    clampCam();
    drawWorld(editor.L, editor.camX, view, { editor: true });

    // Start marker.
    drawWave({ x: 0, y: WORLD_H / 2, up: false }, 0.8);

    // Hover preview.
    const h = editor.hover;
    if (h && !editor.drag && h.r >= 1 && h.r <= ROWS - 2 && h.c >= 0 && editor.tool !== 'pan') {
      ctx.globalAlpha = 0.45;
      if (editor.tool === 'erase') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(h.c * CELL + 2, h.r * CELL + 2, CELL - 4, CELL - 4);
      } else if (editor.tool === 'block') {
        ctx.fillStyle = COLORS.edge;
        ctx.fillRect(h.c * CELL, h.r * CELL, CELL, CELL);
      } else {
        const p = editor.tool === 'slope' ? WL.slopePoints(h.c, h.r, editor.dir) : WL.spikePoints(h.c, h.r, editor.dir, 0.92);
        ctx.fillStyle = COLORS.edge;
        ctx.beginPath(); ctx.moveTo(...p[0]); ctx.lineTo(...p[1]); ctx.lineTo(...p[2]); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  let menuCam = 0;
  function renderMenuBackground(dt) {
    const view = playView();
    const L = menuBg();
    menuCam += 120 * dt;
    if (menuCam > L.length * CELL) menuCam = -view.viewW;
    drawWorld(L, menuCam, view);
  }
  let menuL = null;
  const menuBg = () => menuL || (menuL = WL.compile(WL.getLevel(2)));

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    if (screen === 'play' && play) { updatePlay(dt); renderPlay(); }
    else if (screen === 'editor') renderEditor();
    else renderMenuBackground(dt);
    requestAnimationFrame(frame);
  }
  showScreen('menu');
  requestAnimationFrame(frame);
})();
