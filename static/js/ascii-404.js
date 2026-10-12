/* ───────────────────────────────────────────────────────────
   404 — manual Bayesian optimization.

   The hero of the ASCII edition with the acquisition function
   removed: the visitor chooses where to evaluate. The objective is
   a draw from the GP prior the model uses and stays hidden; each
   click (or Enter at the keyboard cursor) adds one noise-free
   observation and the exact posterior is redrawn. [reveal f] shows
   the objective and the simple regret, [reset] draws a new one.

   Sets window.asciiPage; ascii.js calls it with the shared `kit`.
   Nothing animates, so the scene redraws only on input.
   ─────────────────────────────────────────────────────────── */
(function () {
  window.asciiPage = function (kit) {
    const pre = document.getElementById("bo404");
    if (!pre) return;
    const { Grid, rbf, rff, centres, edges, fmt, gpPosterior, drawLine, drawPosterior, drawObs, rule, heroSize } = kit;
    const facts = document.getElementById("bo404-facts");
    const revealBtn = document.querySelector("[data-reveal]"), resetBtn = document.querySelector("[data-reset]");
    const ELL = 0.1, NOISE = 1e-6, kern = rbf(ELL);
    const Y_MAX = 3, Y_MIN = -3;

    let cols = 0, rows = 0, xs = [], G;
    let f, fe, fBest, obs = [], post, cursor = -1, revealed = false;

    const colOf = (x) => Math.min(cols - 1, Math.floor(x * cols));

    function refresh() {
      fe = edges(cols, f);
      fBest = Math.max(...xs.map(f));
      post = gpPosterior(obs, xs, kern, NOISE);
    }

    function layout() {
      const size = heroSize(pre.parentElement.clientWidth - 16);
      if (size.cols === cols) return false;
      cols = size.cols;
      rows = size.rows - 2;
      G = new Grid(cols, size.rows);
      pre.style.setProperty("--cols", cols);
      xs = centres(cols);
      cursor = -1;
      if (f) refresh();
      return true;
    }

    function newRun() {
      f = rff(ELL, 400).f;
      obs = [];
      revealed = false;
      refresh();
      render();
    }

    function evaluate(j) {
      if (j < 0 || obs.some((o) => colOf(o.x) === j)) return;
      obs.push({ x: xs[j], y: f(xs[j]) });
      post = gpPosterior(obs, xs, kern, NOISE);
      render();
    }

    function render() {
      const box = { r: 0, c: 0, w: cols, h: rows };
      G.clear();
      drawPosterior(G, box, Y_MIN, Y_MAX, post.mu, post.sd, null);
      // drawn over the band rather than faintly under it: here the truth is the reveal
      if (revealed) drawLine(G, box, Y_MIN, Y_MAX, fe, 0, "", false);
      if (cursor >= 0) {
        for (let r = 1; r < rows; r++) if (G.get(r, cursor) === " ") G.set(r, cursor, "┊", "f");
        G.set(0, cursor, "▼", "i");
      }
      drawObs(G, box, Y_MIN, Y_MAX, obs);
      rule(G, rows);
      if (cursor >= 0) {
        G.set(rows, cursor, "┬", "");
        G.text(rows + 1, 0, "x " + xs[cursor].toFixed(2) + "  μ " + fmt(post.mu[cursor]) + "  σ " + post.sd[cursor].toFixed(2), "m");
      } else G.text(rows + 1, 0, obs.length ? "click to evaluate f(x)" : "click anywhere to evaluate f(x)", "m");
      pre.innerHTML = G.html();

      const best = obs.length ? Math.max(...obs.map((o) => o.y)) : null;
      const regret = best === null ? null : fBest - best;
      facts.innerHTML =
        "<span>gaussian process posterior</span>" +
        "<span>evaluations " + String(obs.length).padStart(2, "0") + "</span>" +
        "<span>best " + (best === null ? "—" : fmt(best)) + "</span>" +
        (!revealed ? "<span>acquisition function: you</span>"
          : regret === null ? "<span>nothing evaluated yet</span>"
          : "<span>simple regret " + regret.toFixed(3) + "</span>" +
            (regret < 0.05 ? "<span>optimum found. the page, however still not :(</span>" : ""));
      revealBtn.firstChild.textContent = revealed ? "[hide f]" : "[reveal f]";
      revealBtn.setAttribute("aria-pressed", String(revealed));
    }

    // ── input ──
    const colAt = (e) => {
      const box = pre.getBoundingClientRect();
      return Math.max(0, Math.min(cols - 1, Math.floor(((e.clientX - box.left) / box.width) * cols)));
    };
    const moveTo = (j) => { if (j !== cursor) { cursor = j; render(); } };
    pre.addEventListener("pointermove", (e) => moveTo(colAt(e)));
    pre.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") moveTo(-1); });
    pre.addEventListener("click", (e) => { cursor = colAt(e); evaluate(cursor); render(); });
    pre.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (step) moveTo(cursor < 0 ? Math.floor(cols / 2) : Math.max(0, Math.min(cols - 1, cursor + step * (e.shiftKey ? 5 : 1))));
      else if (e.key === "Enter" || e.key === " ") evaluate(cursor);
      else return;
      e.preventDefault();
    });
    revealBtn.addEventListener("click", () => { revealed = !revealed; render(); });
    resetBtn.addEventListener("click", newRun);

    layout();
    newRun();
    new ResizeObserver(() => { if (layout()) render(); }).observe(pre.parentElement);
  };
})();
