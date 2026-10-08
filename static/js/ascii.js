/* ───────────────────────────────────────────────────────────
   ASCII edition of the homepage.

   Everything visual is a character grid (Grid) rendered into a
   <pre>, driven by one shared animation loop that only ticks
   scenes that are on screen.

   1. Hero (#bo) — a live Bayesian-optimization run. The objective
      is a draw from the same GP prior the model uses (random
      Fourier features), so the model is exactly specified. The
      exact GP posterior is drawn as the mean (● where the band is
      thinner than a row, • elsewhere), ±1σ dense dots and ±2σ a
      checkered fringe, the true objective faint underneath, and
      expected improvement as eighth-block bars below.
   2. Hero variants from other files (window.asciiHeroes), switched
      by the tabs above the hero.
   3. Theme toggle, BibTeX toggle/copy, nav scroll-spy.

   No dependencies.
   ─────────────────────────────────────────────────────────── */
(function () {
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let motion = !reduced;

  // ── theme ──
  const themeBtn = document.getElementById("theme");
  function showTheme() {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    themeBtn.firstChild.textContent = "[" + next + "]";
    themeBtn.setAttribute("aria-label", "Switch to " + next + " theme");
  }
  themeBtn.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
    showTheme();
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: root.dataset.theme } }));
  });
  showTheme();

  // ════════════════════════════════════════════════════════════
  // Maths
  // ════════════════════════════════════════════════════════════
  function erf(x) {
    // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const rbf = (ell) => (a, b) => Math.exp(-((a - b) * (a - b)) / (2 * ell * ell));
  const centres = (n) => Array.from({ length: n }, (_, j) => (j + 0.5) / n);
  const edges = (n, f) => Array.from({ length: n + 1 }, (_, j) => f(j / n));
  const argmax = (v) => { let i = 0; for (let j = 1; j < v.length; j++) if (v[j] > v[i]) i = j; return i; };
  const fmt = (v) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(2);

  // A draw from GP(0, rbf(ell)) on the real line: random Fourier features.
  function rff(ell, M = 300) {
    const w = [], om = [], b = [];
    for (let i = 0; i < M; i++) { w.push(gauss()); om.push(gauss() / ell); b.push(Math.random() * 2 * Math.PI); }
    const c = Math.sqrt(2 / M);
    // f takes exactly one argument, so it is safe to pass straight to Array.map
    return {
      w, om, b,
      f(x) {
        let s = 0;
        for (let i = 0; i < M; i++) s += w[i] * Math.cos(om[i] * x + b[i]);
        return c * s;
      },
    };
  }

  // Cholesky of a symmetric positive-definite n×n matrix (array of rows).
  function cholesky(A, n) {
    const L = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
      }
    }
    return L;
  }
  function forward(L, b, n) {
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
    return z;
  }
  function backward(L, z, n) {
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }

  // Exact GP posterior (unit prior variance) at points xs.
  function gpPosterior(obs, xs, kern, noise) {
    const n = obs.length, m = xs.length;
    const mu = new Float64Array(m), sd = new Float64Array(m);
    if (n === 0) { sd.fill(1); return { mu, sd }; }
    const K = obs.map((a, i) => obs.map((b, j) => kern(a.x, b.x) + (i === j ? noise : 0)));
    const L = cholesky(K, n);
    const alpha = backward(L, forward(L, obs.map((o) => o.y), n), n);
    for (let j = 0; j < m; j++) {
      const kv = obs.map((o) => kern(xs[j], o.x));
      let mean = 0;
      for (let i = 0; i < n; i++) mean += kv[i] * alpha[i];
      const v = forward(L, kv, n);
      let vv = 0;
      for (let i = 0; i < n; i++) vv += v[i] * v[i];
      mu[j] = mean;
      sd[j] = Math.sqrt(Math.max(1 - vv, 0));
    }
    return { mu, sd };
  }

  // ════════════════════════════════════════════════════════════
  // Character grid + plotting primitives
  // ════════════════════════════════════════════════════════════
  // Classes: "" text · "i" ink (bold) · "m" muted · "f" faint.
  class Grid {
    constructor(cols, rows) {
      this.cols = cols; this.rows = rows;
      this.g = new Array(cols * rows); this.k = new Array(cols * rows);
      this.clear();
    }
    clear() { this.g.fill(" "); this.k.fill(""); }
    set(r, c, ch, cls = "") {
      if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return;
      const i = r * this.cols + c;
      this.g[i] = ch; this.k[i] = cls;
    }
    get(r, c) { return this.g[r * this.cols + c]; }
    cls(r, c) { return this.k[r * this.cols + c]; }
    text(r, c, s, cls = "") { for (let i = 0; i < s.length; i++) this.set(r, c + i, s[i], cls); }
    html(blank) {
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      let out = "";
      for (let r = 0; r < this.rows; r++) {
        let run = "", cls = null;
        const flush = () => { if (run) out += cls ? '<span class="' + cls + '">' + esc(run) + "</span>" : esc(run); run = ""; };
        for (let c = 0; c < this.cols; c++) {
          const i = r * this.cols + c;
          let ch = this.g[i], cl = this.k[i];
          if (blank && blank(i)) { ch = " "; cl = ""; }
          if (cl !== cls) { flush(); cls = cl; }
          run += ch;
        }
        flush();
        if (r < this.rows - 1) out += "\n";
      }
      return out;
    }
  }

  const BLOCKS = " ▁▂▃▄▅▆▇█";

  // A box is {r, c, w, h} in cells; y ∈ [lo, hi] maps top → bottom.
  const rowIn = (box, lo, hi, y) => Math.floor((hi - y) / ((hi - lo) / box.h));

  // Trace through v[i] (left edge of column j0+i) and v[i+1]: one glyph
  // per column at the segment's midpoint, so steep runs read as dashes
  // rather than staircases. With `under`, text/ink glyphs are kept.
  function drawLine(G, box, lo, hi, v, j0, cls, under, glyph = "─") {
    for (let i = 0; i + 1 < v.length; i++) {
      const j = j0 + i, r = rowIn(box, lo, hi, (v[i] + v[i + 1]) / 2);
      if (j < 0 || j >= box.w || r < 0 || r >= box.h) continue;
      const R = box.r + r, C = box.c + j, k = G.cls(R, C);
      if (under && G.get(R, C) !== " " && k !== "m" && k !== "f") continue;
      G.set(R, C, glyph, cls);
    }
  }

  // GP-style posterior: ±1σ dots, ±2σ checkered fringe, faint truth, mean.
  function drawPosterior(G, box, lo, hi, mu, sd, truth) {
    const dy = (hi - lo) / box.h;
    for (let j = 0; j < box.w; j++) {
      const c = box.c + j;
      for (let r = 0; r < box.h; r++) {
        const z = Math.abs(hi - (r + 0.5) * dy - mu[j]) / Math.max(sd[j], 1e-9);
        if (z <= 1) G.set(box.r + r, c, "·");
        else if (z <= 2 && (r + c) % 2 === 0) G.set(box.r + r, c, "·", "m");
      }
    }
    if (truth) drawLine(G, box, lo, hi, truth, 0, "f", true);
    for (let j = 0; j < box.w; j++) {
      const rm = rowIn(box, lo, hi, mu[j]);
      // certainty shows as weight: ● where the band is thinner than a row
      if (rm >= 0 && rm < box.h) G.set(box.r + rm, box.c + j, sd[j] < dy ? "●" : "•", "i");
    }
  }

  function drawObs(G, box, lo, hi, obs, glyph = "×", cls = "i") {
    for (const o of obs) {
      const j = Math.min(box.w - 1, Math.floor(o.x * box.w)), r = rowIn(box, lo, hi, o.y);
      if (r >= 0 && r < box.h) G.set(box.r + r, box.c + j, glyph, cls);
    }
  }

  // Eighth-block bar chart, normalised to its maximum; column `hl` in ink.
  function drawBars(G, box, vals, hl) {
    const vmax = Math.max(...vals);
    if (!(vmax > 1e-9)) return;
    for (let j = 0; j < box.w; j++) {
      const h = (vals[j] / vmax) * box.h;
      for (let r = 0; r < box.h; r++) {
        const fill = clamp(h - (box.h - 1 - r), 0, 1);
        const ch = BLOCKS[Math.round(fill * 8)];
        if (ch !== " ") G.set(box.r + r, box.c + j, ch, j === hl ? "i" : "m");
      }
    }
  }

  // Query marker: a faint plumb line under a ▼.
  function drawQuery(G, box, j, reach = box.h) {
    for (let r = 0; r < Math.min(reach, box.h); r++) if (G.get(box.r + r, box.c + j) === " ") G.set(box.r + r, box.c + j, "┊", "f");
    G.set(box.r + Math.min(reach, box.h) - 1, box.c + j, "▼", "i");
  }

  const rule = (G, r, cls = "f") => { for (let c = 0; c < G.cols; c++) G.set(r, c, "─", cls); };
  const rightText = (G, r, s, cls = "m") => G.text(r, G.cols - s.length, s, cls);

  // Shared hero size, so every variant has the same columns and total height:
  // ~11.5px cells across the well, total rows ≈ 0.2·cols + 6.
  function heroSize(width) {
    const cols = Math.max(44, Math.min(140, Math.floor(width / (0.6 * 11.5))));
    return { cols, rows: Math.max(16, Math.min(26, Math.round(cols * 0.2))) + 6 };
  }

  // ════════════════════════════════════════════════════════════
  // 1. Hero — Bayesian optimization with expected improvement
  // ════════════════════════════════════════════════════════════
  function heroScene(pre, facts) {
    const ELL = 0.08, NOISE = 1e-6, kern = rbf(ELL);
    const Y_MAX = 3, Y_MIN = -3;
    const N_INIT = 4, N_QUERIES = 10, XI = 0.01, ACQ_ROWS = 5;
    const PH = { think: 1100, drop: 650, update: 900, done: 2600, reset: 700 };

    let cols = 0, rows = 0, xs = [], G;
    let f, fx, fe, fBest, obs, prev, next, ei, query, phase, clock = 0, phaseT = 0, dissolve;

    function expectedImprovement(post, best) {
      return post.mu.map((mu, j) => {
        const s = post.sd[j];
        if (s < 1e-9) return 0;
        const d = mu - best - XI, z = d / s;
        return Math.max(d * Phi(z) + s * phi(z), 0);
      });
    }

    function layout() {
      const size = heroSize(pre.parentElement.clientWidth - 16);
      if (size.cols === cols) return false;
      cols = size.cols;
      rows = size.rows - 1 - ACQ_ROWS;
      G = new Grid(cols, size.rows);
      pre.style.setProperty("--cols", cols);
      xs = centres(cols);
      if (f) {
        fx = xs.map(f);
        fe = edges(cols, f);
        fBest = Math.max(...fx);
        prev = next = gpPosterior(obs, xs, kern, NOISE);
        plan();
      }
      return true;
    }

    function newRun() {
      f = rff(ELL, 400).f;
      fx = xs.map(f);
      fe = edges(cols, f);
      fBest = Math.max(...fx);
      obs = [];
      for (let i = 0; i < N_INIT; i++) {
        const x = (i + 0.15 + 0.7 * Math.random()) / N_INIT;   // one per stratum
        obs.push({ x, y: f(x) });
      }
      prev = next = gpPosterior(obs, xs, kern, NOISE);
      plan();
      setPhase("think");
    }

    function plan() {
      const best = Math.max(...obs.map((o) => o.y));
      ei = expectedImprovement(next, best);
      query = argmax(ei);
      const nq = obs.length - N_INIT;
      facts.innerHTML =
        "<span>gaussian process posterior</span><span>expected improvement</span>" +
        "<span>query " + String(nq).padStart(2, "0") + " / " + N_QUERIES + "</span>" +
        "<span>simple regret " + (fBest - best).toFixed(3) + "</span>";
    }

    function setPhase(p) { phase = p; phaseT = clock; }

    function step() {
      if (clock - phaseT < PH[phase]) return;
      if (phase === "think") setPhase("drop");
      else if (phase === "drop") {
        obs.push({ x: xs[query], y: fx[query] });
        prev = next;
        next = gpPosterior(obs, xs, kern, NOISE);
        setPhase("update");
      } else if (phase === "update") {
        prev = next;
        plan();
        setPhase(obs.length - N_INIT >= N_QUERIES ? "done" : "think");
      } else if (phase === "done") {
        dissolve = new Float32Array(G.cols * G.rows).map(Math.random);
        setPhase("reset");
      } else if (phase === "reset") newRun();
    }

    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    function render() {
      const dt = clock - phaseT;
      const tUpd = phase === "update" ? easeInOut(Math.min(dt / PH.update, 1)) : 1;
      const box = { r: 0, c: 0, w: cols, h: rows };
      const mu = prev.mu.map((m, j) => m + (next.mu[j] - m) * tUpd);
      const sd = prev.sd.map((s, j) => s + (next.sd[j] - s) * tUpd);

      G.clear();
      drawPosterior(G, box, Y_MIN, Y_MAX, mu, sd, fe);
      if (phase === "drop") {
        const target = Math.max(rowIn(box, Y_MIN, Y_MAX, fx[query]), 0);
        drawQuery(G, box, query, Math.round(Math.min(dt / PH.drop, 1) * target) + 1);
      }
      drawObs(G, box, Y_MIN, Y_MAX, obs);

      const showEi = phase !== "update" || tUpd > 0.999;
      rule(G, rows);
      if (showEi) {
        G.set(rows, query, "┬", "");
        drawBars(G, { r: rows + 1, c: 0, w: cols, h: ACQ_ROWS }, ei, query);
      }
      const fade = phase === "reset" ? Math.min(dt / PH.reset, 1) : 0;
      pre.innerHTML = G.html(fade ? (i) => dissolve[i] < fade : null);
    }

    layout();
    newRun();
    const ro = new ResizeObserver(() => { if (layout()) render(); });
    ro.observe(pre.parentElement);
    return {
      tick(dt) { clock += dt; step(); render(); },
      // the still before play: a few queries in, the next ▼ landing over band and EI bars
      still() {
        for (let i = 0; i < 3000; i++) {
          clock += 100; step();
          if (obs.length - N_INIT >= 4 && phase === "drop" && clock - phaseT >= PH.drop * 0.7) break;
        }
        render();
      },
      destroy() { ro.disconnect(); },
    };
  }

  // ════════════════════════════════════════════════════════════
  // Scene loop — only on-screen scenes tick
  // ════════════════════════════════════════════════════════════
  const scenes = [];
  let raf = 0;
  const vis = new IntersectionObserver((es) => {
    for (const e of es) { const s = scenes.find((x) => x.el === e.target); if (s) s.visible = e.isIntersecting; }
    kick();
  }, { rootMargin: "80px" });

  function addScene(el, sc, fps) {
    Object.assign(sc, { el, visible: false, last: 0, every: 1000 / fps });
    scenes.push(sc);
    vis.observe(el);
  }
  function loop(now) {
    raf = 0;
    if (!motion || document.hidden) return;
    let any = false;
    for (const s of scenes) {
      if (!s.visible || s.paused) continue;
      any = true;
      if (s.last && now - s.last < s.every) continue;
      s.tick(s.last ? Math.min(now - s.last, 120) : 0);
      s.last = now;
    }
    if (any) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && motion) raf = requestAnimationFrame(loop); }
  document.addEventListener("visibilitychange", kick);

  // Shared toolkit for hero variants defined in other files. A variant
  // registers window.asciiHeroes[name] = (pre, facts, kit) => ({ tick(dt), still?(), destroy?() })
  // and must be loaded before this file. still() renders the frame shown before play.
  const kit = {
    Grid, BLOCKS, gauss, clamp, erf, Phi, phi, rbf, rff, centres, edges, argmax, fmt,
    gpPosterior, cholesky, forward, backward, rowIn, drawLine, drawPosterior, drawObs,
    drawBars, drawQuery, rule, rightText, heroSize, reduced,
  };
  const HEROES = Object.assign({ ei: heroScene }, window.asciiHeroes || {});

  // The hero opens on a still and waits for [▶ play], so the tagline and the
  // still can be read first; clicking play also opts in under reduced motion.
  const hero = document.getElementById("bo");
  if (hero) {
    const facts = document.getElementById("bo-facts");
    const playBtn = document.querySelector("[data-play]"), toggle = document.querySelector("[data-playpause]");
    const showStill = (v) => { if (v.still) v.still(); else for (let i = 0; i < 150; i++) v.tick(100); };
    let current = HEROES.ei(hero, facts, kit);
    const wrapper = { tick: (dt) => current.tick(dt), paused: true };
    showStill(current);
    addScene(hero, wrapper, 30);

    const setPaused = (p) => {
      wrapper.paused = p;
      wrapper.last = 0;
      hero.parentElement.classList.toggle("is-paused", p);
      toggle.firstChild.textContent = p ? "[play]" : "[pause]";
      if (!p) { motion = true; kick(); }
    };
    const play = () => { playBtn.hidden = true; toggle.hidden = false; setPaused(false); };
    playBtn.addEventListener("click", play);
    hero.addEventListener("click", () => { if (!playBtn.hidden) play(); });
    toggle.addEventListener("click", () => setPaused(!wrapper.paused));
    hero.parentElement.classList.add("is-paused");
    const tabs = [...document.querySelectorAll("[data-hero]")];
    for (const tab of tabs) {
      if (!HEROES[tab.dataset.hero]) { tab.hidden = true; continue; }
      tab.addEventListener("click", () => {
        if (tab.getAttribute("aria-selected") === "true") return;
        for (const t of tabs) t.setAttribute("aria-selected", String(t === tab));
        if (current.destroy) current.destroy();
        current = HEROES[tab.dataset.hero](hero, facts, kit);
        wrapper.last = 0;
        if (wrapper.paused) showStill(current);
        else current.tick(0);
      });
    }
    if (tabs.filter((t) => !t.hidden).length < 2) tabs.forEach((t) => { t.parentElement.hidden = true; });
  }

  kick();

  // ════════════════════════════════════════════════════════════
  // Tagline typewriter — after ascii.rest's typewriter piece: keys
  // land at an uneven human pace, one slip onto a neighbouring key
  // gets backspaced, then the cursor blinks. Types once, no delete.
  // ════════════════════════════════════════════════════════════
  const tw = document.querySelector("[data-typewriter]");
  if (tw && motion) {
    const ghost = tw.querySelector(".ghost"), typed = tw.querySelector(".typed");
    const phrase = ghost.textContent.replace("▌", "").trim();
    const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
    let seed = 31;
    const rand = () => {   // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const slip = (ch) => {
      for (const row of ROWS) {
        const i = row.indexOf(ch);
        if (i >= 0) return row[i === 0 ? 1 : i === row.length - 1 ? i - 1 : i + (rand() < 0.5 ? -1 : 1)];
      }
      return null;
    };
    // the whole performance as [time s, text], laid out once
    const events = [];
    let at = 0.4, text = "";
    const key = (next, wait) => { at += wait; text = next; events.push([at, text]); };
    const delay = (ch) => 0.025 + rand() * 0.045 + (ch === " " ? 0.02 + rand() * 0.04 : 0) + (rand() < 0.03 ? 0.25 : 0);
    let typo = -1;
    for (let k = 0; k < 20 && typo < 0; k++) { const i = 12 + Math.floor(rand() * (phrase.length - 30)); if (slip(phrase[i])) typo = i; }
    for (let i = 0; i < phrase.length; i++) {
      if (i === typo) {
        const more = Math.min(Math.floor(rand() * 3), phrase.length - i - 1);
        key(text + slip(phrase[i]), delay(phrase[i]));
        for (let k = 1; k <= more; k++) key(text + phrase[i + k], delay(phrase[i + k]));
        at += 0.25 + rand() * 0.2;
        for (let k = 0; k <= more; k++) key(text.slice(0, -1), k ? 0.07 : 0.1);
      }
      key(text + phrase[i], delay(phrase[i]) + (i && ".,".includes(phrase[i - 1]) ? 0.15 : 0));
    }

    const body = document.createElement("span"), cursor = document.createElement("span");
    cursor.className = "cursor"; cursor.textContent = "▌";
    typed.append(body, cursor);
    let t0 = null, idx = 0;
    (function frame(now) {
      if (t0 === null) t0 = now;
      const t = (now - t0) / 1000;
      while (idx < events.length && events[idx][0] <= t) body.textContent = events[idx++][1];
      if (idx < events.length) requestAnimationFrame(frame);
      else cursor.classList.add("blink");   // solid while keys land, blinking once it sits still
    })(performance.now());
  }

  // ════════════════════════════════════════════════════════════
  // 3. BibTeX + scroll-spy
  // ════════════════════════════════════════════════════════════
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-bibtex-toggle]");
    if (toggle) {
      const box = document.getElementById(toggle.getAttribute("aria-controls"));
      const open = box.hidden;
      box.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      return;
    }
    const copy = e.target.closest("[data-bibtex-copy]");
    if (copy) {
      const text = copy.parentElement.querySelector("pre").textContent;
      const label = copy.firstChild;
      navigator.clipboard.writeText(text).then(
        () => { label.textContent = "[copied]"; },
        () => { label.textContent = "[copy failed]"; }
      ).finally(() => setTimeout(() => { label.textContent = "[copy]"; }, 1600));
    }
  });

  const spy = [...document.querySelectorAll('.side a[href^="#"]')]
    .map((a) => ({ a, el: document.querySelector(a.getAttribute("href")) }))
    .filter((s) => s.el);
  function onScroll() {
    const line = window.innerHeight * 0.35;
    let cur = spy[0];
    for (const s of spy) if (s.el.id !== "about" && s.el.getBoundingClientRect().top < line) cur = s;
    for (const s of spy) {
      if (s === cur) s.a.setAttribute("aria-current", "true");
      else s.a.removeAttribute("aria-current");
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  new ResizeObserver(onScroll).observe(document.body);   // section offsets move as the page lays out
})();
