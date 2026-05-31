/* ───────────────────────────────────────────────────────────
   Belief + optimization field — ambient art background.

   A slowly drifting 2-D probability density (mixture of
   Gaussian bumps) painted as a soft topographic map: density
   cloud + iso-density contour rings (marching squares). On top,
   a Bayesian-optimization motif — ascent "walkers" that climb
   the landscape leaving fading query trails, and a crosshair
   ring that tracks the current optimum (incumbent best) as the
   objective changes. Uncertainty + sequential optimization, his
   two research themes, in one calm, slow-moving background.

   Aspect-aware, low-contrast, no dependencies.
   ─────────────────────────────────────────────────────────── */
(function () {
  const canvas = document.getElementById("gp");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const css = getComputedStyle(document.documentElement);
  const accent = (css.getPropertyValue("--accent") || "#1f4e79").trim();
  const A = hexToRgb(accent);

  // ── geometry / world domain ──
  let W = 0, H = 0, dpr = 1, DX = 1;
  let Nx = 1, Ny = 70;
  let Cx = 5, Cy = 80;
  let field, cgrid, img;
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");

  // ── belief: drifting Gaussian mixture ──
  let bumps = [];
  function buildBumps() {
    const K = Math.max(3, Math.min(7, Math.round(DX * 2) + 1));
    bumps = [];
    for (let k = 0; k < K; k++) {
      const hx = DX * ((k + 0.5) / K) + (Math.random() - 0.5) * DX * 0.12;
      bumps.push({
        hx, hy: 0.5 + (Math.random() - 0.5) * 0.34,
        ax: 0.18 + Math.random() * 0.22, ay: 0.12 + Math.random() * 0.14,
        fx: 0.5 + Math.random() * 0.7, fy: 0.5 + Math.random() * 0.7,
        px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
        s: 0.15 + Math.random() * 0.08,
        sp: 0.16 + Math.random() * 0.1, sph: Math.random() * Math.PI * 2,
        w: 0.65 + Math.random() * 0.5,
        cx: hx, cy: 0.5, _sx: 0.16, _sy: 0.16,
      });
    }
  }
  function positions(t) {
    for (const b of bumps) {
      b.cx = b.hx + b.ax * Math.sin(b.fx * t + b.px);
      b.cy = b.hy + b.ay * Math.sin(b.fy * t + b.py);
      b._sx = b.s * (1 + 0.28 * Math.sin(b.sp * t + b.sph));
      b._sy = b.s * (1 + 0.28 * Math.cos(b.sp * t + b.sph));
    }
  }
  function density(x, y) {
    let d = 0;
    for (const b of bumps) {
      const dx = (x - b.cx) / b._sx, dy = (y - b.cy) / b._sy;
      d += b.w * Math.exp(-0.5 * (dx * dx + dy * dy));
    }
    return d;
  }
  function grad(x, y) {
    const e = 0.012;
    return [
      (density(x + e, y) - density(x - e, y)) / (2 * e),
      (density(x, y + e) - density(x, y - e)) / (2 * e),
    ];
  }

  // ── optimization walkers + incumbent best ──
  const NW = 3;
  let walkers = [];
  function newWalker() { return { x: Math.random() * DX, y: Math.random(), vx: 0, vy: 0, marks: [], acc: 0, life: Math.random() * 5 }; }
  function buildWalkers() { walkers = []; for (let i = 0; i < NW; i++) walkers.push(newWalker()); }
  let bestX = 0.5, bestY = 0.5;

  let fmax = 1;
  function computeFields(t) {
    positions(t);
    fmax = 1e-6; let bi = 0, bj = 0;
    for (let j = 0; j < Ny; j++) {
      const y = j / (Ny - 1);
      for (let i = 0; i < Nx; i++) {
        const v = density((i / (Nx - 1)) * DX, y);
        field[j * Nx + i] = v;
        if (v > fmax) { fmax = v; bi = i; bj = j; }
      }
    }
    bestX = (bi / (Nx - 1)) * DX; bestY = bj / (Ny - 1);
    for (let j = 0; j < Cy; j++) {
      const y = j / (Cy - 1);
      for (let i = 0; i < Cx; i++) cgrid[j * Cx + i] = density((i / (Cx - 1)) * DX, y);
    }
  }

  function drawCloud() {
    const data = img.data;
    for (let p = 0; p < Nx * Ny; p++) {
      const a = Math.pow(field[p] / fmax, 1.35) * 150;
      const o = p * 4;
      data[o] = A.r; data[o + 1] = A.g; data[o + 2] = A.b; data[o + 3] = a;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, W, H);
  }

  function drawContour(level, alpha, width) {
    const sx = W / (Cx - 1), sy = H / (Cy - 1);
    ctx.beginPath();
    for (let j = 0; j < Cy - 1; j++) {
      for (let i = 0; i < Cx - 1; i++) {
        const a = cgrid[j * Cx + i], b = cgrid[j * Cx + i + 1];
        const c = cgrid[(j + 1) * Cx + i + 1], d = cgrid[(j + 1) * Cx + i];
        let idx = 0;
        if (a > level) idx |= 8;
        if (b > level) idx |= 4;
        if (c > level) idx |= 2;
        if (d > level) idx |= 1;
        if (idx === 0 || idx === 15) continue;
        const x0 = i * sx, y0 = j * sy, x1 = (i + 1) * sx, y1 = (j + 1) * sy;
        const T = (p, q) => (level - p) / (q - p);
        const top = () => ({ x: x0 + sx * T(a, b), y: y0 });
        const right = () => ({ x: x1, y: y0 + sy * T(b, c) });
        const bot = () => ({ x: x0 + sx * T(d, c), y: y1 });
        const left = () => ({ x: x0, y: y0 + sy * T(a, d) });
        const seg = (p, q) => { ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); };
        switch (idx) {
          case 1: case 14: seg(left(), bot()); break;
          case 2: case 13: seg(bot(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(top(), right()); break;
          case 5: seg(left(), top()); seg(bot(), right()); break;
          case 6: case 9: seg(top(), bot()); break;
          case 7: case 8: seg(left(), top()); break;
          case 10: seg(left(), bot()); seg(top(), right()); break;
        }
      }
    }
    ctx.strokeStyle = `rgba(${A.r},${A.g},${A.b},${alpha})`;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  const WX = (x) => (x / DX) * W, WY = (y) => y * H;

  function drawWalkers(dt) {
    const STEP = 0.11;                    // world units / second — slow
    const GAP = 0.085;                    // spacing between query-point dots
    const LIFE = 14;
    for (const w of walkers) {
      w.life += dt;
      const px0 = w.x, py0 = w.y;
      const [gx, gy] = grad(w.x, w.y);
      const mag = Math.hypot(gx, gy);
      const local = Math.min(1, density(w.x, w.y) / fmax);
      const settle = Math.max(0, Math.min(1, (local - 0.72) / 0.24));
      const climb = Math.min(1, mag / Math.max(0.45, fmax * 1.4));
      const speed = STEP * (1 - 0.62 * settle) * climb;
      const explore = 0.014 * (1 - settle) * (0.35 + 0.65 * climb);
      const nx = (Math.random() - 0.5) * explore, ny = (Math.random() - 0.5) * explore;
      const tx = mag > 1e-3 ? gx / mag * speed + nx : nx;
      const ty = mag > 1e-3 ? gy / mag * speed + ny : ny;
      const follow = 1 - Math.exp(-dt * 4.2);
      w.vx += (tx - w.vx) * follow;
      w.vy += (ty - w.vy) * follow;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      if (w.x < 0 || w.x > DX) w.vx = 0;
      if (w.y < 0 || w.y > 1) w.vy = 0;
      w.x = Math.max(0, Math.min(DX, w.x)); w.y = Math.max(0, Math.min(1, w.y));

      // drop a discrete "evaluation" dot every GAP of arc length
      w.acc += Math.hypot(w.x - px0, w.y - py0);
      if (w.acc >= GAP) { w.acc = 0; w.marks.push([w.x, w.y]); if (w.marks.length > 14) w.marks.shift(); }
      if (w.life > LIFE) { Object.assign(w, newWalker()); continue; }

      const M = w.marks;
      const dying = Math.min(1, (LIFE - w.life) / 2.2);
      const fade = Math.max(0, dying);

      // Continuous trace through past evaluations and the live candidate.
      const trace = M.concat([[w.x, w.y]]);
      if (trace.length > 1) {
        ctx.strokeStyle = `rgba(${A.r},${A.g},${A.b},${0.2 * fade})`;
        ctx.lineWidth = 1.45;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(WX(trace[0][0]), WY(trace[0][1]));
        for (let i = 1; i < trace.length; i++) ctx.lineTo(WX(trace[i][0]), WY(trace[i][1]));
        ctx.stroke();
      }
      // query dots along the trajectory, fading with age
      for (let i = 0; i < M.length; i++) {
        const a = fade * (0.12 + 0.42 * (i / Math.max(1, M.length - 1)));
        ctx.beginPath(); ctx.arc(WX(M[i][0]), WY(M[i][1]), 1.65, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${A.r},${A.g},${A.b},${a})`; ctx.fill();
      }
      // current candidate
      ctx.beginPath(); ctx.arc(WX(w.x), WY(w.y), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251,250,247,${0.42 * fade})`; ctx.fill();
      ctx.beginPath(); ctx.arc(WX(w.x), WY(w.y), 2.05, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${A.r},${A.g},${A.b},${0.52 * fade})`; ctx.fill();
    }
  }

  function drawBest() {
    // subtle incumbent-best marker (open ring, no crosshair)
    ctx.strokeStyle = `rgba(${A.r},${A.g},${A.b},0.28)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(WX(bestX), WY(bestY), 5.5, 0, Math.PI * 2); ctx.stroke();
  }

  const LEVELS_REL = [0.1, 0.22, 0.4, 0.62, 0.84];
  function render(t, dt) {
    computeFields(t);
    ctx.clearRect(0, 0, W, H);
    drawCloud();
    for (let i = 0; i < LEVELS_REL.length; i++)
      drawContour(LEVELS_REL[i] * fmax, 0.14 + i * 0.1, 1);
    drawWalkers(dt);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    DX = Math.max(0.6, W / H);
    Nx = Math.max(2, Math.round(Ny * DX));
    Cx = Math.max(2, Math.round(Cy * DX));
    field = new Float32Array(Nx * Ny);
    cgrid = new Float32Array(Cx * Cy);
    off.width = Nx; off.height = Ny;
    img = octx.createImageData(Nx, Ny);
    buildBumps(); buildWalkers();
  }

  let raf = null, t0 = null, last = null;
  const SPEED = 0.055;
  function frame(now) {
    if (t0 === null) { t0 = now; last = now; }
    const t = ((now - t0) / 1000) * SPEED;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    render(t, dt);
    raf = requestAnimationFrame(frame);
  }
  function staticFrame() {
    computeFields(1.7);
    ctx.clearRect(0, 0, W, H);
    drawCloud();
    for (let i = 0; i < LEVELS_REL.length; i++) drawContour(LEVELS_REL[i] * fmax, 0.14 + i * 0.1, 1);
  }
  function start() {
    resize();
    if (W === 0) { requestAnimationFrame(start); return; }
    if (reduced) { staticFrame(); return; }
    if (raf) cancelAnimationFrame(raf);
    t0 = null;
    raf = requestAnimationFrame(frame);
  }

  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { resize(); if (reduced) staticFrame(); }, 150); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; t0 = null; }
    else if (!reduced && !raf) raf = requestAnimationFrame(frame);
  });

  start();

  function hexToRgb(h) {
    const m = h.replace("#", "");
    const s = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
    const num = parseInt(s, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
})();
