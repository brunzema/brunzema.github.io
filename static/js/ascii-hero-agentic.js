/* ───────────────────────────────────────────────────────────
   ASCII hero, agentic variant — after "Agentic Bayesian
   Optimization through Surrogate-Augmented Autoresearch".

   One campaign of Sara (the agent) driving lenz (the BO backend)
   on a 1-D objective, in lenz's own command vocabulary. Between
   evaluations Sara deliberates with computational actions that
   cost no budget — reconfigure (set-bounds), propose (suggest,
   --q / --around) and probe (score, predict) — then commits one
   evaluation, adopting or overriding lenz's proposal.

   The campaign follows the paper's agent prompt: open with
   informative points from the context prior, restrict the active
   region to it, reopen the full space at half budget to check for
   a better basin (the notes are sometimes wrong), absorb a
   mid-run instruction as a persistent reconfiguration that keeps
   every trial, and spend the rest refining around the incumbent.
   Sara's choices are scripted rules, not an LLM; every number lenz
   prints is computed from the exact GP posterior on screen
   (logei = log expected improvement).

   Registers window.asciiHeroes.agentic; ascii.js supplies `kit`.
   ─────────────────────────────────────────────────────────── */
(function () {
  window.asciiHeroes = window.asciiHeroes || {};
  window.asciiHeroes.agentic = function (pre, facts, kit) {
    const {
      Grid, BLOCKS, gauss, clamp, Phi, phi, rbf, rff, centres, edges, argmax, fmt,
      gpPosterior, rowIn, drawPosterior, drawObs, drawQuery, rule, rightText, heroSize,
    } = kit;
    const ELL = 0.08, NOISE = 1e-6, kern = rbf(ELL);
    const Y_MAX = 3, Y_MIN = -3, XI = 0.01;
    const BUDGET = 10, ACQ_ROWS = 3, CPS = 0.06;   // typewriter: 60 chars/s
    const T = { drop: 650, update: 900, reset: 700 };

    let cols = 0, H = 0, LOGN = 0, xs = [], G;
    let f, fx, fe, fOpt, obs, prev, next, updT = -1e9, clock = 0;
    let bounds, cands, chosen, pending, dropT, acqShown, n, limit;
    let log, queue, typing, wait, resetT, dissolve;

    // ── maths ──
    function expectedImprovement(mu, s, best) {
      if (s < 1e-9) return 0;
      const d = mu - best - XI, z = d / s;
      return Math.max(d * Phi(z) + s * phi(z), 0);
    }
    // once the instructor sets a limit, only feasible trials count as incumbents
    const feasible = () => { const ok = obs.filter((o) => !limit || inside(o.x, limit)); return ok.length ? ok : obs; };
    const best = () => Math.max(...feasible().map((o) => o.y));
    const incumbent = () => { const ok = feasible(); return ok[argmax(ok.map((o) => o.y))]; };
    const eiGrid = () => next.mu.map((m, j) => expectedImprovement(m, next.sd[j], best()));
    const logei = (v) => Math.log(Math.max(v, 1e-300));
    const lg = (v) => { const l = logei(v); return l < -99 ? "−inf" : fmt(l).replace("+", ""); };
    const col = (x) => Math.min(cols - 1, Math.floor(x * cols));
    const x2 = (x) => x.toFixed(2);
    const inside = (x, b) => x >= b[0] - 1e-9 && x <= b[1] + 1e-9;
    const posteriorAt = (x) => { const p = gpPosterior(obs, [x], kern, NOISE); return { mu: p.mu[0], sd: p.sd[0] }; };
    const eiAt = (x) => { const p = posteriorAt(x); return expectedImprovement(p.mu, p.sd, best()); };

    // lenz suggest: acquisition maxima over the grid inside a region.
    // --q 2 returns the two best distinct local maxima (a stand-in for joint q-batch optimisation).
    function suggest(region, q) {
      const ei = eiGrid(), js = [];
      for (let j = 0; j < cols; j++) if (inside(xs[j], region)) js.push(j);
      const peaks = js.filter((j) => (j === 0 || ei[j] >= ei[j - 1]) && (j === cols - 1 || ei[j] >= ei[j + 1]));
      const pool = (peaks.length ? peaks : js).sort((a, b) => ei[b] - ei[a]);
      const out = [];
      for (const j of pool) {
        if (out.every((k) => Math.abs(k - j) > cols * 0.04)) out.push(j);
        if (out.length === q) break;
      }
      return out.map((j) => ({ x: xs[j], ei: ei[j], src: "lenz" }));
    }

    function layout() {
      const size = heroSize(pre.parentElement.clientWidth - 16);
      if (size.cols === cols) return false;
      cols = size.cols;
      LOGN = cols < 70 ? 5 : 6;
      H = size.rows - (1 + ACQ_ROWS + 1 + LOGN);   // the plot takes what the log and bars leave
      G = new Grid(cols, size.rows);
      pre.style.setProperty("--cols", cols);
      xs = centres(cols);
      if (f) {
        fx = xs.map((x) => f(x)); fe = edges(cols, f);
        prev = next = gpPosterior(obs, xs, kern, NOISE);
      }
      return true;
    }

    // ── the campaign: lines are typed, fns run when reached ──
    const say = (who, txt) => queue.push({ who, txt });
    const run = (fn) => queue.push({ fn });
    const pause = (ms) => queue.push({ pause: ms });

    // optimum of the current problem (inside the instructor's limit, if any)
    function optimum() {
      const g = edges(2000, f).map((y, i) => ({ x: i / 2000, y }));
      return Math.max(...g.filter((p) => !limit || inside(p.x, limit)).map((p) => p.y));
    }

    // submit → run the experiment → observe
    function evaluate(x, then) {
      say("sara", "lenz submit x=" + x2(x));
      run(() => { pending = x; dropT = clock; });
      pause(T.drop + 200);
      run(() => {
        const y = f(x), was = obs.length ? best() : -Infinity;
        obs.push({ x, y });
        prev = curPost(); next = gpPosterior(obs, xs, kern, NOISE); updT = clock;
        pending = null; cands = []; chosen = null; acqShown = false; n++;
        say("exp", "y(" + x2(x) + ") = " + fmt(y) + (y > was && obs.length > 1 ? "  new best" : ""));
        run(showFacts);
        pause(T.update);
        run(then);
      });
    }

    function setBounds(b, note) {
      say("sara", "lenz set-bounds [" + x2(b[0]) + ", " + x2(b[1]) + "]");
      run(() => { bounds = b; showFacts(); });
      say("lenz", "ok · " + (note || "bounds [" + x2(b[0]) + ", " + x2(b[1]) + "]"));
    }

    function newRun() {
      f = rff(ELL, 400).f;
      fx = xs.map((x) => f(x)); fe = edges(cols, f);
      obs = []; prev = next = gpPosterior(obs, xs, kern, NOISE); updT = -1e9;
      bounds = [0, 1]; cands = []; chosen = null; pending = null; acqShown = false; n = 0; limit = null;
      log = []; queue = []; typing = null; wait = 0; resetT = null;
      fOpt = optimum();

      // the notes usually point at the global optimum, sometimes at a decoy basin
      const peaks = [];
      for (let j = 1; j < cols - 1; j++) if (fx[j] >= fx[j - 1] && fx[j] >= fx[j + 1]) peaks.push(j);
      const jb = argmax(fx);
      const decoys = peaks.filter((j) => Math.abs(xs[j] - xs[jb]) > 0.25).sort((a, b) => fx[b] - fx[a]);
      const m = clamp((decoys.length && Math.random() < 0.35 ? xs[decoys[0]] : xs[jb]) + 0.03 * gauss(), 0.1, 0.9);
      const trust = [clamp(m - 0.12, 0, 1), clamp(m + 0.12, 0, 1)];

      // setup (t = 0): formalise the problem from the context
      say("user", "maximize y on [0, 1], " + BUDGET + " evals");
      say("user", "notes: x ≈ " + x2(m) + " worked well before");
      say("sara", "lenz create · maximize y");
      say("lenz", "ok · acqf logei · 0 trials");
      pause(300);
      // opening: informative points inside the region the notes trust
      const open = [m - 0.05, m + 0.05].map((x) => clamp(x, 0.01, 0.99));
      say("sara", "opening near the notes: " + open.map(x2).join(", "));
      evaluate(open[0], () => evaluate(open[1], () => {
        setBounds(trust);
        pause(300);
        run(() => step({ m }));
      }));
      showFacts();
    }

    // one campaign step: deliberate (no budget), then commit one evaluation
    const full = () => limit || [0, 1];
    const isFull = () => bounds[0] === full()[0] && bounds[1] === full()[1];
    // a proposal with logei below this has nothing left to learn: switch modes, don't duplicate
    const exhausted = (c) => !c || logei(c.ei) < -8;
    const lenzSays = (s) => say("lenz", s.map((c, i) => x2(c.x) + (i ? " (" : " (logei ") + lg(c.ei) + ")").join(" · "));

    function step(ctx) {
      if (n >= BUDGET) {
        const o = incumbent();
        say("sara", "budget spent · best " + x2(o.x) + " → " + fmt(o.y));
        pause(2600);
        run(() => { dissolve = new Float32Array(G.cols * G.rows).map(Math.random); resetT = clock; });
        return;
      }
      const again = () => step(ctx);

      // half budget: reopen the full space to check for a better basin
      if (n === 5 && !isFull()) {
        say("sara", "half budget: check other basins");
        setBounds(full());
      }
      // a new instruction arrives mid-run → persistent reconfiguration, every trial kept.
      // The limit cuts away the side of the domain away from the incumbent.
      if (n === 7) {
        const xi = incumbent().x, upper = xi < 0.5, d = 0.15 + 0.15 * Math.random();
        const L = upper ? Math.min(xi + d, 0.92) : Math.max(xi - d, 0.08);
        say("user", "new limit: x " + (upper ? "≤ " : "≥ ") + x2(L));
        run(() => { limit = upper ? [0, L] : [L, 1]; fOpt = optimum(); });
        setBounds(upper ? [0, L] : [L, 1], obs.length + " trials kept");
      }

      run(() => {
        // late in the budget: fine-tune around the incumbent, unless that is used up
        if (n >= 8) {
          const o = incumbent(), r = [Math.max(o.x - 0.06, bounds[0]), Math.min(o.x + 0.06, bounds[1])];
          const s = suggest(r, 1);
          say("sara", "lenz suggest --around best r=0.06");
          lenzSays(s);
          if (!exhausted(s[0])) { adopt(s[0], s); return; }
          say("sara", "nothing left near best → global");
        }
        const s = suggest(bounds, 2);
        say("sara", "lenz suggest --q 2");
        run(() => { cands = s; acqShown = true; });
        lenzSays(s);
        if (exhausted(s[0]) && !isFull()) {
          say("sara", "region exhausted → reopen");
          setBounds(full());
          run(again);
          return;
        }
        // while the notes are in play, Sara scores her own idea against lenz's best
        const own = clamp(ctx.m + 0.04 * gauss(), bounds[0], bounds[1]);
        if (n < 5 && Math.abs(own - s[0].x) > 0.03) {
          const e = eiAt(own), mine = { x: own, ei: e, src: "sara" };
          say("sara", "lenz score " + x2(s[0].x) + " " + x2(own));
          run(() => { cands = s.concat([mine]); });
          say("lenz", "logei " + lg(s[0].ei) + " · " + lg(e));
          if (logei(e) > logei(s[0].ei) - 0.5) {
            say("sara", "override → " + x2(own) + ": notes, close call");
            run(() => { chosen = mine; });
            evaluate(own, again);
            return;
          }
        } else {
          const p = posteriorAt(s[0].x);
          say("sara", "lenz predict " + x2(s[0].x));
          say("lenz", "mean " + fmt(p.mu) + " · sd " + p.sd.toFixed(2));
        }
        adopt(s[0], s);
      });

      function adopt(c, all) {
        say("sara", "adopt " + x2(c.x));
        run(() => { cands = all; acqShown = true; chosen = c; });
        evaluate(c.x, again);
      }
    }

    function showFacts() {
      const regret = obs.length ? Math.max(fOpt - best(), 0).toFixed(3) : "—";
      facts.innerHTML =
        "<span>sara + lenz</span>" +
        "<span>eval " + String(n).padStart(2, "0") + " / " + BUDGET + "</span>" +
        "<span>bounds [" + x2(bounds[0]) + ", " + x2(bounds[1]) + "]</span>" +
        "<span>simple regret " + regret + "</span>";
    }

    function advance(dt) {
      let budget = dt;
      while (budget > 0 && resetT === null) {
        if (wait > 0) { const d = Math.min(wait, budget); wait -= d; budget -= d; continue; }
        if (typing) {
          const need = (typing.txt.length - typing.n) / CPS, d = Math.min(need, budget);
          typing.n += d * CPS; budget -= d;
          if (typing.n >= typing.txt.length - 1e-9) { log.push(typing); typing = null; wait = 80; }
          continue;
        }
        const item = queue.shift();
        if (!item) return;
        if (item.fn) item.fn();
        else if (item.pause) wait = item.pause;
        else typing = { who: item.who, txt: item.txt, n: 0 };
      }
    }

    // ── drawing ──
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    function curPost() {
      const t = easeInOut(clamp((clock - updT) / T.update, 0, 1));
      if (t >= 1) return next;
      return { mu: prev.mu.map((m, j) => m + (next.mu[j] - m) * t), sd: prev.sd.map((s, j) => s + (next.sd[j] - s) * t) };
    }

    function render() {
      const box = { r: 0, c: 0, w: cols, h: H };
      const post = curPost();
      G.clear();
      drawPosterior(G, box, Y_MIN, Y_MAX, post.mu, post.sd, fe);
      if (pending !== null) {
        const target = Math.max(rowIn(box, Y_MIN, Y_MAX, f(pending)), 0);
        drawQuery(G, box, col(pending), Math.round(clamp((clock - dropT) / T.drop, 0, 1) * target) + 1);
      }
      drawObs(G, box, Y_MIN, Y_MAX, obs);
      // an illustration of the loop, not the paper's setting (scripted agent, 1-D)
      rightText(G, 0, "[concept sketch]", "m");

      // axis: the active search region as a bracket; candidates on it
      rule(G, H);
      const b0 = col(bounds[0]), b1 = col(bounds[1] - 1e-9);
      for (let j = b0; j <= b1; j++) G.set(H, j, "━", "m");
      G.set(H, b0, "[", "i"); G.set(H, b1, "]", "i");
      for (const c of cands) G.set(H, col(c.x), c.src === "sara" ? "○" : "◇", chosen === c ? "i" : "");

      // acquisition (EI) inside the active region: faint at rest, muted once lenz is asked
      if (obs.length && clock - updT >= T.update) {
        const v = eiGrid().map((e, j) => (inside(xs[j], bounds) ? e : 0)), vmax = Math.max(...v);
        const hl = chosen ? col(chosen.x) : -1;
        if (vmax > 1e-12) for (let j = 0; j < cols; j++) {
          const h = (v[j] / vmax) * ACQ_ROWS;
          for (let r = 0; r < ACQ_ROWS; r++) {
            const ch = BLOCKS[Math.round(clamp(h - (ACQ_ROWS - 1 - r), 0, 1) * 8)];
            if (ch !== " ") G.set(H + 1 + r, j, ch, j === hl ? "i" : acqShown ? "m" : "f");
          }
        }
      }

      const R = H + ACQ_ROWS + 1;
      rule(G, R);
      rightText(G, R, cols < 70 ? " [ ] bounds ◇ lenz ○ sara " : " [ ] active bounds  ◇ lenz proposal  ○ sara's own ", "m");
      const lines = typing ? log.concat([{ who: typing.who, txt: typing.txt.slice(0, Math.floor(typing.n)) + "▌" }]) : log;
      lines.slice(-LOGN).forEach((l, i) => {
        const r = R + 1 + i, k = l.who === "sara" || l.who === "user" ? "i" : "m";
        G.text(r, 0, l.who, k);
        G.text(r, 6, l.txt, l.who === "lenz" ? "m" : "");
      });

      const fade = resetT !== null ? Math.min((clock - resetT) / T.reset, 1) : 0;
      pre.innerHTML = G.html(fade ? (i) => dissolve[i] < fade : null);
      if (fade >= 1) newRun();
    }

    layout();
    newRun();
    const ro = new ResizeObserver(() => { if (layout()) render(); });
    ro.observe(pre.parentElement);
    const label0 = pre.getAttribute("aria-label");
    pre.setAttribute("aria-label", "Agentic Bayesian optimization: an agent, Sara, drives a Bayesian-optimization backend, lenz, through commands — setting search bounds, requesting and scoring proposals, adopting or overriding them, and reconfiguring when a new instruction arrives");
    return {
      tick(dt) { clock += dt; advance(dt); render(); },
      // the still before play: mid-campaign, a query landing, ideally inside narrowed bounds
      still() {
        for (let i = 0; i < 4000; i++) {
          clock += 100; advance(100);
          const landing = pending !== null && clock - dropT >= T.drop * 0.7;
          if (landing && n >= 3 && (bounds[1] - bounds[0] < 0.9 || n >= 5)) break;
        }
        render();
      },
      destroy() { ro.disconnect(); pre.setAttribute("aria-label", label0); },
    };
  };
})();
