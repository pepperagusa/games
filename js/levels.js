// The Wave — level data, level generation and collision.
// Works in the browser (window.WaveLevels) and in Node (module.exports) so levels can be verified offline.
(function (root) {
  'use strict';

  const CELL = 30;          // grid cell size in world units
  const ROWS = 20;          // rows 0 and 19 are the solid ceiling and floor
  const WORLD_H = CELL * ROWS;
  const WAVE_R = 6;         // collision radius of the wave
  const BLOCK = 0, SPIKE = 1, SLOPE = 2, BOOST = 3;
  // Speed boosters: dir 0 = regular (1 arrow), 1 = double arrow (+1/4), 2 = triple arrow (+1/4 of double).
  const BOOST_MULT = [1, 1.25, 1.25 * 1.25];
  // Slope direction = which corner holds the right angle (the solid corner):
  // 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left.
  // Spike direction = where the tip points.
  const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;

  const NAMES = [
    'First Flight', 'Gentle Drift', 'Needle Gates', 'Low Ceiling', 'Islands',
    'Split Paths', 'Tight Squeeze', 'Thorn Garden', 'The Tunnel', 'Switchback',
    'Rush Hour', 'Serpent', 'Static', 'Razor Wire', 'Pressure',
    'Glass Teeth', 'Overdrive', 'The Gauntlet', 'Event Horizon', 'Wavelength',
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Built-in level generator (deterministic per level) ----------
  function generate(i) {
    const rnd = mulberry32(9001 + i * 7919);
    const R = (a, b) => a + rnd() * (b - a);
    const RI = (a, b) => Math.floor(R(a, b + 1));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const d = i / 19;

    const speed = Math.round(330 + 190 * d);
    const length = 200 + 14 * i;
    const cells = new Map();
    const put = (c, r, t, dir = 0) => {
      if (r < 1 || r > ROWS - 2 || c < 0) return;
      cells.set(c * ROWS + r, [c, r, t, dir]);
    };

    const gMin = Math.max(3, 6 - Math.round(3 * d)); // smallest opening, in rows
    const gMax = gMin + 2;
    const spikeTips = i >= 1;

    let col = 18;            // empty runway at the start
    let centers = [10];      // gap centers (in rows) the wave could be coming from
    const reach = (target) => Math.max(...centers.map((c) => Math.abs(c - target)));
    const baseSpacing = () => RI(Math.round(10 - 5 * d), Math.round(14 - 6 * d));
    const spacingFor = (rows) => Math.max(baseSpacing(), Math.ceil(rows * 1.35) + 2);

    function floorCeilingSpikes(from, to) {
      if (i < 2 || to - from < 5 || rnd() > 0.3 + 0.4 * d) return;
      const onFloor = rnd() < 0.5;
      const n = RI(2, Math.min(6, to - from - 2));
      const start = RI(from + 1, to - n - 1);
      for (let k = 0; k < n; k++) {
        if (onFloor) put(start + k, ROWS - 2, SPIKE, UP);
        else put(start + k, 1, SPIKE, DOWN);
      }
    }

    // Speed boosters (levels 11+): a full column of boosters in the open space before a section,
    // so the wave can't miss it. A boosted stretch lasts a few sections, then a blue booster resets it.
    let pendingBoost = -1, boostNow = 0, boostLeft = 0;
    function placeBoost(spacing) {
      if (pendingBoost < 0) return;
      const c = col + Math.floor(spacing / 2);
      for (let r = 1; r <= ROWS - 2; r++) if (!cells.has(c * ROWS + r)) put(c, r, BOOST, pendingBoost);
      pendingBoost = -1;
    }
    function planBoost() {
      if (i < 10) return;
      if (boostNow === 0) {
        if (rnd() < 0.2 + 0.15 * d) {
          boostNow = pendingBoost = i >= 15 && rnd() < 0.5 ? 2 : 1;
          boostLeft = RI(2, 4);
        }
      } else if (--boostLeft <= 0) {
        boostNow = pendingBoost = 0;
      }
    }

    function gate() {
      const g = RI(gMin, gMax);
      const prev = centers[Math.floor(rnd() * centers.length)];
      const top = clamp(Math.round(prev - g / 2 + R(-6 + 2 * d, 6 - 2 * d)), 3, 16 - g + 1);
      const center = top + g / 2;
      const spacing = spacingFor(reach(center));
      floorCeilingSpikes(col, col + spacing);
      placeBoost(spacing);
      col += spacing;
      const w = RI(1, 1 + Math.round(2 * d));
      const bot = top + g - 1;
      for (let c = col; c < col + w; c++) {
        for (let r = 1; r < top; r++) {
          if (spikeTips && r === top - 1) put(c, r, SPIKE, DOWN);
          else put(c, r, BLOCK);
        }
        for (let r = bot + 1; r <= ROWS - 2; r++) {
          if (spikeTips && r === bot + 1) put(c, r, SPIKE, UP);
          else put(c, r, BLOCK);
        }
      }
      col += w;
      centers = [center];
    }

    function island() {
      const g = gMin + 1;
      const h = RI(2, 3);
      const s = i >= 6 ? 1 : 0;
      const mMin = g + 1 + s, mMax = ROWS - 1 - h - s - g;
      const m = RI(mMin, mMax);
      const above = 1 + (m - 1 - s) / 2;
      const belowTop = m + h + s;
      const below = belowTop + (ROWS - 1 - belowTop) / 2;
      const need = Math.min(reach(above), reach(below));
      const spacing = spacingFor(need);
      floorCeilingSpikes(col, col + spacing);
      placeBoost(spacing);
      col += spacing;
      const w = RI(2, 4);
      for (let c = col; c < col + w; c++) {
        for (let r = m; r < m + h; r++) put(c, r, BLOCK);
        if (s) { put(c, m - 1, SPIKE, UP); put(c, m + h, SPIKE, DOWN); }
        // Harder levels pinch the outer paths with border spikes.
        if (i >= 12 && c === col + 1) {
          if (rnd() < 0.5) put(c, 1, SPIKE, DOWN); else put(c, ROWS - 2, SPIKE, UP);
        }
      }
      col += w;
      centers = [above, below];
    }

    function tunnel() {
      const g = Math.max(4, gMin + (i < 13 ? 1 : 0));
      const prev = centers[Math.floor(rnd() * centers.length)];
      let top = clamp(Math.round(prev - g / 2), 2, ROWS - 2 - g);
      const spacing = spacingFor(reach(top + g / 2));
      placeBoost(spacing);
      col += spacing;
      const L = RI(8, 10 + Math.round(16 * d));
      let slope = 0, segLeft = 0;
      const tops = [];
      for (let k = 0; k < L; k++, col++) {
        if (segLeft <= 0) {
          const opts = [-1, 0, 1];
          slope = opts[Math.floor(rnd() * 3)];
          segLeft = RI(2, 6);
        }
        segLeft--;
        if (k > 0) {
          let nt = top + slope;
          if (nt < 2 || nt > ROWS - 2 - g) { slope = -slope; nt = top + slope; }
          top = nt;
        }
        for (let r = 1; r < top; r++) put(col, r, BLOCK);
        for (let r = top + g; r <= ROWS - 2; r++) put(col, r, BLOCK);
        tops.push(top);
      }
      const start = col - L;
      for (let k = 1; k < L - 1; k++) {
        const c = start + k, t = tops[k], up = tops[k + 1] < t, wasHigher = tops[k - 1] < t;
        const down = tops[k + 1] > t, wasLower = tops[k - 1] > t;
        // Ceiling of the tunnel (bottom face of the top wall).
        if (up !== wasHigher && t - 1 >= 1) put(c, t - 1, SLOPE, up ? 3 : 2);
        // Floor of the tunnel (top face of the bottom wall).
        const w = t + g;
        if (down !== wasLower && w <= ROWS - 2) put(c, w, SLOPE, down ? 0 : 1);
      }
      centers = [top + g / 2];
    }

    while (col < length - 34) {
      planBoost();
      const roll = rnd();
      const pTunnel = i >= 8 ? 0.15 + 0.15 * d : 0;
      const pIsland = i >= 4 ? 0.2 + 0.1 * d : 0;
      if (roll < pTunnel) tunnel();
      else if (roll < pTunnel + pIsland) island();
      else gate();
    }

    return { name: NAMES[i], speed, length, objects: [...cells.values()] };
  }

  const cache = [];
  function getLevel(i) {
    if (!cache[i]) cache[i] = generate(i);
    return cache[i];
  }

  // ---------- Compile & collision ----------
  function levelLength(objects) {
    let max = 0;
    for (const o of objects) max = Math.max(max, o[0]);
    return Math.max(60, max + 15);
  }

  function compile(data) {
    const map = new Map();
    for (const [c, r, t, dir] of data.objects) map.set(c * ROWS + r, { c, r, t, dir: dir || 0 });
    const length = data.length || levelLength(data.objects);
    return { name: data.name, speed: data.speed, length, map };
  }

  function spikePoints(c, r, dir, shrink = 1) {
    const x = c * CELL, y = r * CELL, s = CELL;
    let pts;
    if (dir === UP) pts = [[x, y + s], [x + s, y + s], [x + s / 2, y]];
    else if (dir === DOWN) pts = [[x, y], [x + s, y], [x + s / 2, y + s]];
    else if (dir === RIGHT) pts = [[x, y], [x, y + s], [x + s, y + s / 2]];
    else pts = [[x + s, y], [x + s, y + s], [x, y + s / 2]];
    if (shrink !== 1) {
      const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
      const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
      pts = pts.map(([px, py]) => [cx + (px - cx) * shrink, cy + (py - cy) * shrink]);
    }
    return pts;
  }

  function slopePoints(c, r, dir) {
    const x = c * CELL, y = r * CELL, s = CELL;
    const corners = [[x, y + s], [x + s, y + s], [x + s, y], [x, y]]; // BL, BR, TR, TL
    return [corners[(dir + 3) % 4], corners[dir], corners[(dir + 1) % 4]];
  }
  // Which sides of a cell are completely solid ('t','r','b','l').
  function fullSides(o) {
    if (!o) return '';
    if (o.t === BLOCK) return 'trbl';
    if (o.t === SLOPE) return ['lb', 'br', 'rt', 'tl'][o.dir];
    return '';
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function pointInTri(px, py, p) {
    const s = (a, b) => (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
    const d1 = s(p[0], p[1]), d2 = s(p[1], p[2]), d3 = s(p[2], p[0]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }

  // Does a wave at (x, y) touch anything?
  function collide(L, x, y) {
    const r = WAVE_R;
    if (y - r < CELL || y + r > WORLD_H - CELL) return true;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
    for (let c = c0; c <= c1; c++) {
      for (let rr = r0; rr <= r1; rr++) {
        const o = L.map.get(c * ROWS + rr);
        if (!o || o.t === BOOST) continue;
        if (o.t === BLOCK) {
          const nx = Math.max(c * CELL, Math.min(x, c * CELL + CELL));
          const ny = Math.max(rr * CELL, Math.min(y, rr * CELL + CELL));
          if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
        } else {
          const slope = o.t === SLOPE;
          const p = slope ? slopePoints(c, rr, o.dir) : spikePoints(c, rr, o.dir, 0.72);
          const rad = slope ? r : r * 0.8;
          if (pointInTri(x, y, p)) return true;
          for (let k = 0; k < 3; k++) {
            const a = p[k], b = p[(k + 1) % 3];
            if (distToSeg(x, y, a[0], a[1], b[0], b[1]) < rad) return true;
          }
        }
      }
    }
    return false;
  }

  // Which booster (0..2) is the wave touching at (x, y)? -1 if none.
  function boostAt(L, x, y) {
    const r = WAVE_R;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
    for (let c = c0; c <= c1; c++) {
      for (let rr = r0; rr <= r1; rr++) {
        const o = L.map.get(c * ROWS + rr);
        if (o && o.t === BOOST) return o.dir;
      }
    }
    return -1;
  }

  const api = {
    CELL, ROWS, WORLD_H, WAVE_R, BLOCK, SPIKE, SLOPE, BOOST, BOOST_MULT, UP, RIGHT, DOWN, LEFT,
    COUNT: NAMES.length,
    getLevel, compile, collide, boostAt, spikePoints, slopePoints, fullSides, levelLength,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaveLevels = api;
})(typeof window !== 'undefined' ? window : this);
