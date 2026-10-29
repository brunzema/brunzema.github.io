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

   The cloud is painted at field resolution into its own small canvas
   that CSS stretches to full size: the compositor's bilinear upscale is
   nearly free, whereas drawImage-upscaling it into the full-resolution
   canvas every frame capped the animation at ~48 fps. One ~6 px grid
   feeds both the cloud and the contours.
   ─────────────────────────────────────────────────────────── */
(function () {
  const canvas = document.getElementById("gp");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let A = hexToRgb("#356fa3");
  let paper = { r: 251, g: 250, b: 247 };
  function syncThemeColors() {
    const css = getComputedStyle(document.documentElement);
    A = hexToRgb((css.getPropertyValue("--accent") || "#356fa3").trim());
    paper = rgbVarToRgb(css.getPropertyValue("--bg-rgb") || "251,250,247");
  }
  syncThemeColors();

  // ── geometry / world domain ──
  const CELL = 6;                         // grid spacing in CSS px
  let W = 0, H = 0, dpr = 1, DX = 1;
  let Nx = 1, Ny = 70;
  let field, img;
  const cloud = document.createElement("canvas");
  cloud.className = canvas.className;
  cloud.setAttribute("aria-hidden", "true");
  canvas.before(cloud);
  const octx = cloud.getContext("2d");

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
  const NW = 5;
  let walkers = [];
  function newWalker() { return { x: Math.random() * DX, y: Math.random(), vx: 0, vy: 0, marks: [], acc: 0, life: Math.random() * 10}; }
  function buildWalkers() { walkers = []; for (let i = 0; i < NW; i++) walkers.push(newWalker()); }
  let bestX = 0.5, bestY = 0.5;

  // Each bump is axis-aligned, so exp(−½(dx² + dy²)) = exp(−½dx²)·exp(−½dy²):
  // one row and one column of exponentials per bump, then the grid is
  // filled with multiplies alone.
  let fmax = 1;
  let ex = new Float32Array(0), ey = new Float32Array(0);
  function computeFields(t) {
    positions(t);
    const K = bumps.length;
    if (ex.length !== K * Nx) ex = new Float32Array(K * Nx);
    if (ey.length !== K * Ny) ey = new Float32Array(K * Ny);
    for (let k = 0; k < K; k++) {
      const b = bumps[k];
      for (let i = 0; i < Nx; i++) {
        const dx = ((i / (Nx - 1)) * DX - b.cx) / b._sx;
        ex[k * Nx + i] = b.w * Math.exp(-0.5 * dx * dx);
      }
      for (let j = 0; j < Ny; j++) {
        const dy = (j / (Ny - 1) - b.cy) / b._sy;
        ey[k * Ny + j] = Math.exp(-0.5 * dy * dy);
      }
    }
    field.fill(0);
    for (let k = 0; k < K; k++) {
      const xo = k * Nx, yo = k * Ny;
      for (let j = 0; j < Ny; j++) {
        const fy = ey[yo + j];
        if (fy < 1e-5) continue;          // this row is outside the bump
        const row = j * Nx;
        for (let i = 0; i < Nx; i++) field[row + i] += ex[xo + i] * fy;
      }
    }
    fmax = 1e-6; let best = 0;
    for (let p = 0; p < field.length; p++) if (field[p] > fmax) { fmax = field[p]; best = p; }
    bestX = ((best % Nx) / (Nx - 1)) * DX; bestY = Math.floor(best / Nx) / (Ny - 1);
  }

  function drawCloud() {
    const data = img.data;
    for (let p = 0; p < Nx * Ny; p++) {
      const a = Math.pow(field[p] / fmax, 1.35) * 150;
      const o = p * 4;
      data[o] = A.r; data[o + 1] = A.g; data[o + 2] = A.b; data[o + 3] = a;
    }
    octx.putImageData(img, 0, 0);
  }

  function drawContour(level, alpha, width) {
    const cgrid = field, Cx = Nx, Cy = Ny;
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

  // Smooth Catmull-Rom curve through world-space points. The curve interpolates
  // every control point, so the equi-time query dots sit exactly on the line.
  function strokeSmooth(pts) {
    if (pts.length < 2) return;
    const P = pts.map(([x, y]) => [WX(x), WY(y)]);
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    if (P.length === 2) { ctx.lineTo(P[1][0], P[1][1]); ctx.stroke(); return; }
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i > 0 ? i - 1 : 0];
      const p1 = P[i];
      const p2 = P[i + 1];
      const p3 = P[i + 2 < P.length ? i + 2 : P.length - 1];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
    }
    ctx.stroke();
  }

  function drawWalkers(dt) {
    const STEP = 0.11;                    // world units / second — slow
    const TGAP = 0.6;                     // seconds between evaluations (one BO iteration)
    const LIFE = 14;
    for (const w of walkers) {
      w.life += dt;
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

      // drop a discrete "evaluation" dot at fixed time steps (one BO iteration each)
      w.acc += dt;
      if (w.acc >= TGAP) { w.acc -= TGAP; w.marks.push([w.x, w.y]); if (w.marks.length > 14) w.marks.shift(); }
      if (w.life > LIFE) { Object.assign(w, newWalker()); continue; }

      const M = w.marks;
      const dying = Math.min(1, (LIFE - w.life) / 2.2);
      const fade = Math.max(0, dying);

      // Smooth, continuous trace through past evaluations and the live candidate.
      const trace = M.concat([[w.x, w.y]]);
      if (trace.length > 1) {
        ctx.strokeStyle = `rgba(${A.r},${A.g},${A.b},${0.2 * fade})`;
        ctx.lineWidth = 1.45;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        strokeSmooth(trace);
      }
      // query dots along the trajectory, fading with age
      for (let i = 0; i < M.length; i++) {
        const a = fade * (0.12 + 0.42 * (i / Math.max(1, M.length - 1)));
        ctx.beginPath(); ctx.arc(WX(M[i][0]), WY(M[i][1]), 1.65, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${A.r},${A.g},${A.b},${a})`; ctx.fill();
      }
      // current candidate
      ctx.beginPath(); ctx.arc(WX(w.x), WY(w.y), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${paper.r},${paper.g},${paper.b},${0.42 * fade})`; ctx.fill();
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
    Ny = Math.max(40, Math.min(200, Math.round(H / CELL)));
    Nx = Math.max(2, Math.round(Ny * DX));
    field = new Float32Array(Nx * Ny);
    cloud.width = Nx; cloud.height = Ny;
    img = octx.createImageData(Nx, Ny);
    buildBumps(); buildWalkers();
  }

  let raf = null, t0 = null, last = null, pausedAt = null;
  const SPEED = 0.055;
  function frame(now) {
    if (t0 === null) t0 = now;
    if (last === null) last = now;
    const t = ((now - t0) / 1000) * SPEED;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    render(t, dt);
    raf = requestAnimationFrame(frame);
  }
  function staticFrame() {
    syncThemeColors();
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
    t0 = null; last = null;
    raf = requestAnimationFrame(frame);
  }

  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      // Mobile browsers fire `resize` when the URL bar shows/hides while
      // scrolling, even though the canvas size is unchanged. resize() re-seeds
      // every bump/walker, so reacting here makes the field visibly jump.
      // Bail out unless the backing-store dimensions actually changed.
      const r = canvas.getBoundingClientRect();
      const d = Math.min(window.devicePixelRatio || 1, 2);
      if (Math.round(r.width * d) === canvas.width && Math.round(r.height * d) === canvas.height) return;
      resize();
      if (reduced) staticFrame();
    }, 150);
  });
  window.addEventListener("themechange", () => { syncThemeColors(); if (reduced) staticFrame(); });

  // Only animate while the tab is visible and the field is on screen.
  let onscreen = true;
  function pause() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = null;
    pausedAt = performance.now();
  }
  function resume() {
    if (reduced || raf || document.hidden || !onscreen || W === 0) return;
    // Resume the clock where it paused instead of snapping the field back to t=0.
    if (pausedAt !== null && t0 !== null) t0 += performance.now() - pausedAt;
    pausedAt = null;
    last = null;            // avoid a dt spike on the first resumed frame
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : resume()));
  new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    onscreen ? resume() : pause();
  }).observe(canvas);

  start();

  function hexToRgb(h) {
    const m = h.replace("#", "");
    const s = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
    const num = parseInt(s, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function rgbVarToRgb(value) {
    const [r, g, b] = value.split(",").map((n) => Number.parseInt(n.trim(), 10));
    return { r: r || 0, g: g || 0, b: b || 0 };
  }
})();
