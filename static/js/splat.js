/* Gaussian splatting note — anatomy of one splat, ordered alpha compositing,
   and a real-time EWA renderer for 3-D Gaussians. Everything below is closed
   form: covariances are projected with the affine Jacobian, splats are sorted
   by view depth and composited front-to-back. No libraries, no shaders. */
(function () {
  "use strict";

  /* ── theme ─────────────────────────────────────────────────────────── */

  let paletteCache = null;
  const themeHooks = [];

  function palette() {
    if (paletteCache) return paletteCache;
    const styles = getComputedStyle(document.documentElement);
    const read = (name) => parseColor(styles.getPropertyValue(name));
    paletteCache = {
      bg: read("--bg"),
      bgWarm: read("--bg-warm"),
      bgCard: read("--bg-card"),
      ink: read("--ink"),
      muted: read("--muted"),
      subtle: read("--subtle"),
      line: read("--line"),
      lineStrong: read("--line-strong"),
      accent: read("--accent"),
      orange: read("--viz-orange"),
      fontBody: styles.getPropertyValue("--font-body").trim(),
    };
    return paletteCache;
  }

  window.addEventListener("themechange", () => {
    paletteCache = null;
    themeHooks.forEach((hook) => hook());
  });

  function parseColor(value) {
    const text = value.trim();
    if (text.startsWith("#")) {
      const hex = text.slice(1);
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
    const parts = text.match(/[\d.]+/g);
    if (!parts) throw new Error(`Unable to parse theme color: ${value}`);
    return parts.slice(0, 3).map(Number);
  }

  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

  /* ── small utilities ───────────────────────────────────────────────── */

  function fitCanvas(canvas, maxRatio) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, maxRatio || 2);
    const pixelWidth = Math.round(rect.width * ratio);
    const pixelHeight = Math.round(rect.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rect.width, height: rect.height, ratio };
  }

  function randomSource(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalPair(random) {
    const u = Math.max(random(), 1e-9);
    const v = random();
    const radius = Math.sqrt(-2 * Math.log(u));
    return [radius * Math.cos(2 * Math.PI * v), radius * Math.sin(2 * Math.PI * v)];
  }

  const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

  /* exp(−½ p) for p ∈ [0, 18], tabulated: the rasteriser evaluates this a few
     million times per frame and the interpolation error is well below 1/255. */
  const EXP_MAX = 18;
  const EXP_STEPS = 2048;
  const EXP_SCALE = EXP_STEPS / EXP_MAX;
  const EXP_TABLE = new Float32Array(EXP_STEPS + 2);
  for (let i = 0; i < EXP_TABLE.length; i += 1) {
    EXP_TABLE[i] = Math.exp((-0.5 * i) / EXP_SCALE);
  }

  /* Σ = R diag(s₁², s₂²) Rᵀ for a 2-D splat. */
  function covariance2(sx, sy, theta) {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const a = sx * sx;
    const b = sy * sy;
    return {
      xx: cos * cos * a + sin * sin * b,
      xy: cos * sin * (a - b),
      yy: sin * sin * a + cos * cos * b,
    };
  }

  function inverse2(cov) {
    const det = cov.xx * cov.yy - cov.xy * cov.xy;
    const safe = Math.abs(det) < 1e-12 ? (det < 0 ? -1e-12 : 1e-12) : det;
    return { a: cov.yy / safe, b: -cov.xy / safe, c: cov.xx / safe, det: safe };
  }

  function viewFor(width, height, halfSpan) {
    const scale = Math.min(width, height) / (2 * halfSpan);
    return {
      scale,
      toX: (x) => width / 2 + x * scale,
      toY: (y) => height / 2 - y * scale,
      fromX: (px) => (px - width / 2) / scale,
      fromY: (py) => (height / 2 - py) / scale,
    };
  }

  function drawGrid(context, view, width, height, step) {
    const colors = palette();
    context.save();
    context.strokeStyle = rgba(colors.line, 0.85);
    context.lineWidth = 1;
    const left = view.fromX(0);
    const right = view.fromX(width);
    const bottom = view.fromY(height);
    const top = view.fromY(0);
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      context.beginPath();
      context.moveTo(view.toX(x), 0);
      context.lineTo(view.toX(x), height);
      context.stroke();
    }
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      context.beginPath();
      context.moveTo(0, view.toY(y));
      context.lineTo(width, view.toY(y));
      context.stroke();
    }
    context.restore();
  }

  function label(context, text, x, y, color, size, align) {
    const colors = palette();
    context.save();
    context.font = `600 ${size || 10}px ${colors.fontBody}`;
    context.fillStyle = rgb(color);
    context.textAlign = align || "left";
    context.textBaseline = "top";
    context.fillText(text, x, y);
    context.restore();
  }

  function whenVisible(element, callback) {
    if (typeof IntersectionObserver !== "function") {
      callback(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => callback(entry.isIntersecting)),
      { rootMargin: "160px" }
    );
    observer.observe(element);
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── 01 · anatomy of one splat ─────────────────────────────────────── */

  function initAnatomy(root) {
    const canvas = root.querySelector("[data-anatomy-canvas]");
    if (!canvas) return;

    const defaults = { x: -0.15, y: 0.1, sx: 1.15, sy: 0.42, theta: -0.55, alpha: 0.85 };
    const state = { ...defaults };
    let mode = "field";
    let drag = null;
    let hover = null;
    const buffer = document.createElement("canvas");

    const inputs = {
      sx: root.querySelector("[data-anatomy-sx]"),
      sy: root.querySelector("[data-anatomy-sy]"),
      theta: root.querySelector("[data-anatomy-theta]"),
      alpha: root.querySelector("[data-anatomy-alpha]"),
    };
    const outputs = {
      sx: root.querySelector("[data-anatomy-sx-output]"),
      sy: root.querySelector("[data-anatomy-sy-output]"),
      theta: root.querySelector("[data-anatomy-theta-output]"),
      alpha: root.querySelector("[data-anatomy-alpha-output]"),
    };

    Object.entries(inputs).forEach(([key, input]) => {
      if (!input) return;
      input.addEventListener("input", () => {
        state[key] = Number.parseFloat(input.value);
        render();
      });
    });

    root.querySelectorAll("[data-anatomy-view]").forEach((button) => {
      button.addEventListener("click", () => {
        mode = button.dataset.anatomyView;
        root.querySelectorAll("[data-anatomy-view]").forEach((other) => {
          const active = other === button;
          other.classList.toggle("is-active", active);
          other.setAttribute("aria-pressed", active ? "true" : "false");
        });
        render();
      });
    });

    const resetButton = root.querySelector("[data-anatomy-reset]");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        Object.assign(state, defaults);
        syncInputs();
        render();
      });
    }

    function syncInputs() {
      Object.entries(inputs).forEach(([key, input]) => {
        if (input) input.value = String(state[key]);
      });
    }

    function handlePoints(view) {
      const cos = Math.cos(state.theta);
      const sin = Math.sin(state.theta);
      return {
        centre: [view.toX(state.x), view.toY(state.y)],
        major: [view.toX(state.x + cos * state.sx), view.toY(state.y + sin * state.sx)],
        minor: [view.toX(state.x - sin * state.sy), view.toY(state.y + cos * state.sy)],
      };
    }

    function pointerPosition(event) {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    canvas.addEventListener("pointerdown", (event) => {
      const surface = { width: canvas.clientWidth, height: canvas.clientHeight };
      const view = viewFor(surface.width, surface.height, 2.5);
      const [px, py] = pointerPosition(event);
      const points = handlePoints(view);
      let best = null;
      let bestDistance = 18;
      Object.entries(points).forEach(([key, [hx, hy]]) => {
        const distance = Math.hypot(hx - px, hy - py);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = key;
        }
      });
      if (!best) return;
      drag = best;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    canvas.addEventListener("pointermove", (event) => {
      const surface = { width: canvas.clientWidth, height: canvas.clientHeight };
      const view = viewFor(surface.width, surface.height, 2.5);
      const [px, py] = pointerPosition(event);
      if (!drag) {
        const points = handlePoints(view);
        let next = null;
        Object.entries(points).forEach(([key, [hx, hy]]) => {
          if (Math.hypot(hx - px, hy - py) < 18) next = key;
        });
        if (next !== hover) {
          hover = next;
          canvas.style.cursor = hover ? "grab" : "default";
          render();
        }
        return;
      }
      const wx = view.fromX(px);
      const wy = view.fromY(py);
      if (drag === "centre") {
        state.x = clamp(wx, -1.9, 1.9);
        state.y = clamp(wy, -1.5, 1.5);
      } else {
        const dx = wx - state.x;
        const dy = wy - state.y;
        const length = Math.hypot(dx, dy);
        if (drag === "major") {
          state.theta = Math.atan2(dy, dx);
          state.sx = clamp(length, 0.12, 2);
        } else {
          state.theta = Math.atan2(dy, dx) - Math.PI / 2;
          state.sy = clamp(length, 0.08, 2);
        }
      }
      syncInputs();
      render();
    });

    const endDrag = () => {
      drag = null;
      canvas.style.cursor = hover ? "grab" : "default";
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", () => {
      if (!drag && hover) {
        hover = null;
        canvas.style.cursor = "default";
        render();
      }
    });

    function renderReadouts(cov) {
      const set = (selector, text) => {
        const node = root.querySelector(selector);
        if (node) node.textContent = text;
      };
      set("[data-sigma-xx]", cov.xx.toFixed(3));
      set("[data-sigma-xy]", cov.xy.toFixed(3));
      set("[data-sigma-yx]", cov.xy.toFixed(3));
      set("[data-sigma-yy]", cov.yy.toFixed(3));
      const major = Math.max(state.sx, state.sy);
      const minor = Math.min(state.sx, state.sy);
      set("[data-anatomy-ratio]", `${(major / minor).toFixed(2)} : 1`);
      set("[data-anatomy-footprint]", `${(Math.PI * state.sx * state.sy).toFixed(2)} units²`);
      set("[data-anatomy-angle]", `${((state.theta * 180) / Math.PI).toFixed(0)}°`);
      set("[data-anatomy-peak]", state.alpha.toFixed(2));
      if (outputs.sx) outputs.sx.textContent = `s₁ = ${state.sx.toFixed(2)}`;
      if (outputs.sy) outputs.sy.textContent = `s₂ = ${state.sy.toFixed(2)}`;
      if (outputs.theta) outputs.theta.textContent = `θ = ${((state.theta * 180) / Math.PI).toFixed(0)}°`;
      if (outputs.alpha) outputs.alpha.textContent = `α = ${state.alpha.toFixed(2)}`;
    }

    function render() {
      const surface = fitCanvas(canvas);
      if (!surface) return;
      const { context, width, height } = surface;
      const colors = palette();
      const view = viewFor(width, height, 2.5);
      const cov = covariance2(state.sx, state.sy, state.theta);
      const inv = inverse2(cov);

      context.clearRect(0, 0, width, height);
      context.fillStyle = rgb(colors.bgWarm);
      context.fillRect(0, 0, width, height);
      drawGrid(context, view, width, height, 0.5);

      if (mode === "field") {
        const bufferWidth = Math.max(2, Math.round(width));
        const bufferHeight = Math.max(2, Math.round(height));
        if (buffer.width !== bufferWidth || buffer.height !== bufferHeight) {
          buffer.width = bufferWidth;
          buffer.height = bufferHeight;
        }
        const bufferContext = buffer.getContext("2d");
        const image = bufferContext.createImageData(bufferWidth, bufferHeight);
        const data = image.data;
        const splat = colors.accent;
        let index = 0;
        for (let py = 0; py < bufferHeight; py += 1) {
          const wy = view.fromY(py + 0.5) - state.y;
          for (let px = 0; px < bufferWidth; px += 1) {
            const wx = view.fromX(px + 0.5) - state.x;
            const power = inv.a * wx * wx + 2 * inv.b * wx * wy + inv.c * wy * wy;
            const weight = state.alpha * Math.exp(-0.5 * power);
            data[index] = splat[0];
            data[index + 1] = splat[1];
            data[index + 2] = splat[2];
            data[index + 3] = Math.round(clamp(weight, 0, 1) * 255);
            index += 4;
          }
        }
        bufferContext.putImageData(image, 0, 0);
        context.drawImage(buffer, 0, 0, width, height);
      }

      // σ contours: the level sets of the quadratic form.
      const cos = Math.cos(state.theta);
      const sin = Math.sin(state.theta);
      const contours = [1, 2, 3];
      contours.forEach((level, position) => {
        context.beginPath();
        for (let step = 0; step <= 96; step += 1) {
          const t = (step / 96) * Math.PI * 2;
          const localX = Math.cos(t) * state.sx * level;
          const localY = Math.sin(t) * state.sy * level;
          const wx = state.x + cos * localX - sin * localY;
          const wy = state.y + sin * localX + cos * localY;
          if (step === 0) context.moveTo(view.toX(wx), view.toY(wy));
          else context.lineTo(view.toX(wx), view.toY(wy));
        }
        context.closePath();
        context.strokeStyle = rgba(colors.ink, position === 0 ? 0.75 : 0.3 - position * 0.07);
        context.setLineDash(position === 0 ? [] : [4, 4]);
        context.lineWidth = position === 0 ? 1.6 : 1;
        context.stroke();
        context.setLineDash([]);
        if (mode !== "field" || position > 0) {
          const tipX = state.x + cos * state.sx * level;
          const tipY = state.y + sin * state.sx * level;
          label(context, `${level}σ`, view.toX(tipX) + 6, view.toY(tipY) - 12, colors.subtle, 9);
        }
      });

      // Principal axes: the columns of R scaled by s₁ and s₂.
      const points = handlePoints(view);
      const axes = [
        { key: "major", color: colors.orange, text: "s₁" },
        { key: "minor", color: colors.accent, text: "s₂" },
      ];
      axes.forEach(({ key, color, text }) => {
        const [hx, hy] = points[key];
        context.beginPath();
        context.moveTo(points.centre[0], points.centre[1]);
        context.lineTo(hx, hy);
        context.strokeStyle = rgb(color);
        context.lineWidth = 1.6;
        context.stroke();
        context.beginPath();
        context.arc(hx, hy, hover === key || drag === key ? 7 : 5.2, 0, Math.PI * 2);
        context.fillStyle = rgb(colors.bgCard);
        context.fill();
        context.strokeStyle = rgb(color);
        context.lineWidth = 1.8;
        context.stroke();
        label(context, text, hx + 9, hy - 6, color, 10);
      });

      context.beginPath();
      context.arc(points.centre[0], points.centre[1], 4.4, 0, Math.PI * 2);
      context.fillStyle = rgb(colors.ink);
      context.fill();
      label(context, "μ", points.centre[0] + 8, points.centre[1] + 4, colors.ink, 11);

      label(context, "x₁", width - 22, height - 20, colors.subtle, 10);
      label(context, "x₂", 12, 14, colors.subtle, 10);
      label(
        context,
        mode === "field" ? "α · exp(−½ Δᵀ Σ⁻¹ Δ)" : "level sets of Δᵀ Σ⁻¹ Δ",
        14,
        height - 24,
        colors.muted,
        10
      );

      renderReadouts(cov);
    }

    syncInputs();
    themeHooks.push(render);
    new ResizeObserver(render).observe(canvas);
    requestAnimationFrame(render);
  }

  /* ── 02 · ordered alpha compositing ────────────────────────────────── */

  const COMPOSITE_COLORS = [
    [224, 122, 60],
    [47, 127, 181],
    [86, 157, 110],
    [201, 162, 39],
    [186, 90, 121],
    [122, 94, 168],
  ];

  function buildCompositeSplats() {
    const random = randomSource(20260814);
    return COMPOSITE_COLORS.map((color, index) => {
      const angle = (index / COMPOSITE_COLORS.length) * Math.PI * 2 + 0.4;
      const radius = 0.62 + random() * 0.34;
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.72,
        sx: 0.52 + random() * 0.5,
        sy: 0.3 + random() * 0.26,
        theta: random() * Math.PI,
        alpha: 0.55 + random() * 0.35,
        depth: 0.6 + index * 0.55 + random() * 0.3,
        color,
        index,
      };
    });
  }

  function initComposite(root) {
    const canvas = root.querySelector("[data-composite-canvas]");
    if (!canvas) return;

    let splats = buildCompositeSplats();
    let sorted = true;
    let opacityScale = 1;
    let probe = { x: 0.05, y: 0.05 };
    let drag = null;
    const buffer = document.createElement("canvas");

    const authoredOrder = [3, 0, 5, 1, 4, 2];

    root.querySelectorAll("[data-composite-order]").forEach((button) => {
      button.addEventListener("click", () => {
        sorted = button.dataset.compositeOrder === "sorted";
        root.querySelectorAll("[data-composite-order]").forEach((other) => {
          const active = other === button;
          other.classList.toggle("is-active", active);
          other.setAttribute("aria-pressed", active ? "true" : "false");
        });
        render();
      });
    });

    const opacityInput = root.querySelector("[data-composite-opacity]");
    const opacityOutput = root.querySelector("[data-composite-opacity-output]");
    if (opacityInput) {
      opacityInput.addEventListener("input", () => {
        opacityScale = Number.parseFloat(opacityInput.value);
        render();
      });
    }

    const resetButton = root.querySelector("[data-composite-reset]");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        splats = buildCompositeSplats();
        probe = { x: 0.05, y: 0.05 };
        render();
      });
    }

    function order() {
      const indices = splats.map((splat) => splat.index);
      if (sorted) indices.sort((a, b) => splats[a].depth - splats[b].depth);
      else indices.sort((a, b) => authoredOrder.indexOf(a) - authoredOrder.indexOf(b));
      return indices;
    }

    function pointerWorld(event, view) {
      const rect = canvas.getBoundingClientRect();
      return [view.fromX(event.clientX - rect.left), view.fromY(event.clientY - rect.top)];
    }

    canvas.addEventListener("pointerdown", (event) => {
      const view = viewFor(canvas.clientWidth, canvas.clientHeight, 2.1);
      const [wx, wy] = pointerWorld(event, view);
      let best = null;
      let bestDistance = 0.34;
      splats.forEach((splat) => {
        const distance = Math.hypot(splat.x - wx, splat.y - wy);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = splat;
        }
      });
      if (best) {
        drag = best;
        canvas.setPointerCapture(event.pointerId);
      } else {
        probe = { x: wx, y: wy };
      }
      render();
      event.preventDefault();
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const view = viewFor(canvas.clientWidth, canvas.clientHeight, 2.1);
      const [wx, wy] = pointerWorld(event, view);
      drag.x = clamp(wx, -1.8, 1.8);
      drag.y = clamp(wy, -1.4, 1.4);
      render();
    });

    const endDrag = () => {
      drag = null;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    function evaluate(indices, wx, wy) {
      let transmittance = 1;
      const contributions = [];
      for (const index of indices) {
        const splat = splats[index];
        const cov = covariance2(splat.sx, splat.sy, splat.theta);
        const inv = inverse2(cov);
        const dx = wx - splat.x;
        const dy = wy - splat.y;
        const power = inv.a * dx * dx + 2 * inv.b * dx * dy + inv.c * dy * dy;
        const gaussian = Math.exp(-0.5 * power);
        const alpha = Math.min(0.99, splat.alpha * opacityScale * gaussian);
        contributions.push({ splat, gaussian, alpha, transmittance, weight: alpha * transmittance });
        transmittance *= 1 - alpha;
      }
      return { contributions, transmittance };
    }

    function renderProbe(indices) {
      const list = root.querySelector("[data-composite-probe]");
      if (!list) return;
      const { contributions, transmittance } = evaluate(indices, probe.x, probe.y);
      const colors = palette();
      const background = colors.bgWarm;
      const accumulated = [0, 0, 0];
      contributions.forEach(({ splat, weight }) => {
        for (let channel = 0; channel < 3; channel += 1) {
          accumulated[channel] += weight * splat.color[channel];
        }
      });
      for (let channel = 0; channel < 3; channel += 1) {
        accumulated[channel] += transmittance * background[channel];
      }

      list.innerHTML = "";
      contributions.forEach(({ splat, gaussian, alpha, transmittance: t, weight }, position) => {
        const row = document.createElement("li");
        row.innerHTML = `
          <i style="background: rgb(${splat.color.join(",")})"></i>
          <span>${position + 1}</span>
          <span>${gaussian.toFixed(3)}</span>
          <span>${alpha.toFixed(3)}</span>
          <span>${t.toFixed(3)}</span>
          <b style="--bar: ${(weight * 100).toFixed(1)}%">${weight.toFixed(3)}</b>`;
        list.appendChild(row);
      });

      const set = (selector, text) => {
        const node = root.querySelector(selector);
        if (node) node.textContent = text;
      };
      set("[data-composite-transmittance]", transmittance.toFixed(3));
      set("[data-composite-covered]", `${((1 - transmittance) * 100).toFixed(1)}%`);
      const swatch = root.querySelector("[data-composite-final]");
      if (swatch) {
        swatch.style.background = `rgb(${accumulated.map((value) => Math.round(clamp(value, 0, 255))).join(",")})`;
      }
    }

    function render() {
      const surface = fitCanvas(canvas);
      if (!surface) return;
      const { context, width, height } = surface;
      const colors = palette();
      const view = viewFor(width, height, 2.1);
      const indices = order();

      const bufferWidth = Math.max(2, Math.round(width));
      const bufferHeight = Math.max(2, Math.round(height));
      if (buffer.width !== bufferWidth || buffer.height !== bufferHeight) {
        buffer.width = bufferWidth;
        buffer.height = bufferHeight;
      }
      const bufferContext = buffer.getContext("2d");
      const image = bufferContext.createImageData(bufferWidth, bufferHeight);
      const data = image.data;
      const pixels = bufferWidth * bufferHeight;
      const accumulated = new Float32Array(pixels * 3);
      const transmittance = new Float32Array(pixels).fill(1);
      const pixelScale = bufferWidth / width;

      // Front-to-back compositing: one pass over splats, per-pixel transmittance.
      for (const index of indices) {
        const splat = splats[index];
        const cov = covariance2(splat.sx, splat.sy, splat.theta);
        const inv = inverse2(cov);
        const scale = view.scale * pixelScale;
        // Pixel-space conic; the y flip negates the off-diagonal entry.
        const conicA = inv.a / (scale * scale);
        const conicB = -inv.b / (scale * scale);
        const conicC = inv.c / (scale * scale);
        const centreX = view.toX(splat.x) * pixelScale;
        const centreY = view.toY(splat.y) * pixelScale;
        const radius = 3 * Math.max(splat.sx, splat.sy) * scale;
        const minX = Math.max(0, Math.floor(centreX - radius));
        const maxX = Math.min(bufferWidth - 1, Math.ceil(centreX + radius));
        const minY = Math.max(0, Math.floor(centreY - radius));
        const maxY = Math.min(bufferHeight - 1, Math.ceil(centreY + radius));
        const opacity = splat.alpha * opacityScale;
        for (let py = minY; py <= maxY; py += 1) {
          const dy = py + 0.5 - centreY;
          for (let px = minX; px <= maxX; px += 1) {
            const dx = px + 0.5 - centreX;
            const power = conicA * dx * dx + 2 * conicB * dx * dy + conicC * dy * dy;
            if (power > 18) continue;
            const alpha = Math.min(0.99, opacity * Math.exp(-0.5 * power));
            if (alpha < 0.004) continue;
            const offset = py * bufferWidth + px;
            const t = transmittance[offset];
            if (t < 0.004) continue;
            const weight = alpha * t;
            accumulated[offset * 3] += weight * splat.color[0];
            accumulated[offset * 3 + 1] += weight * splat.color[1];
            accumulated[offset * 3 + 2] += weight * splat.color[2];
            transmittance[offset] = t * (1 - alpha);
          }
        }
      }

      const background = colors.bgWarm;
      for (let offset = 0; offset < pixels; offset += 1) {
        const t = transmittance[offset];
        data[offset * 4] = clamp(accumulated[offset * 3] + t * background[0], 0, 255);
        data[offset * 4 + 1] = clamp(accumulated[offset * 3 + 1] + t * background[1], 0, 255);
        data[offset * 4 + 2] = clamp(accumulated[offset * 3 + 2] + t * background[2], 0, 255);
        data[offset * 4 + 3] = 255;
      }
      bufferContext.putImageData(image, 0, 0);
      context.clearRect(0, 0, width, height);
      context.drawImage(buffer, 0, 0, width, height);

      // Outlines and order badges.
      indices.forEach((index, position) => {
        const splat = splats[index];
        const cos = Math.cos(splat.theta);
        const sin = Math.sin(splat.theta);
        context.beginPath();
        for (let step = 0; step <= 72; step += 1) {
          const t = (step / 72) * Math.PI * 2;
          const localX = Math.cos(t) * splat.sx;
          const localY = Math.sin(t) * splat.sy;
          const wx = splat.x + cos * localX - sin * localY;
          const wy = splat.y + sin * localX + cos * localY;
          if (step === 0) context.moveTo(view.toX(wx), view.toY(wy));
          else context.lineTo(view.toX(wx), view.toY(wy));
        }
        context.closePath();
        context.strokeStyle = rgba(colors.ink, 0.28);
        context.lineWidth = 1;
        context.stroke();

        const cx = view.toX(splat.x);
        const cy = view.toY(splat.y);
        context.beginPath();
        context.arc(cx, cy, 9, 0, Math.PI * 2);
        context.fillStyle = rgba(colors.bgCard, 0.92);
        context.fill();
        context.strokeStyle = rgb(splat.color);
        context.lineWidth = 1.4;
        context.stroke();
        context.save();
        context.font = `600 10px ${colors.fontBody}`;
        context.fillStyle = rgb(colors.ink);
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(position + 1), cx, cy + 0.5);
        context.restore();
      });

      // Probe marker.
      const probeX = view.toX(probe.x);
      const probeY = view.toY(probe.y);
      context.beginPath();
      context.moveTo(probeX - 9, probeY);
      context.lineTo(probeX + 9, probeY);
      context.moveTo(probeX, probeY - 9);
      context.lineTo(probeX, probeY + 9);
      context.strokeStyle = rgb(colors.ink);
      context.lineWidth = 1.4;
      context.stroke();
      context.beginPath();
      context.arc(probeX, probeY, 5, 0, Math.PI * 2);
      context.strokeStyle = rgb(colors.ink);
      context.lineWidth = 1.4;
      context.stroke();

      label(context, "drag a splat · click anywhere to probe a pixel", 14, height - 24, colors.subtle, 10);
      renderProbe(indices);
    }

    if (opacityOutput && opacityInput) {
      const sync = () => {
        opacityOutput.textContent = `×${Number.parseFloat(opacityInput.value).toFixed(2)}`;
      };
      opacityInput.addEventListener("input", sync);
      sync();
    }

    themeHooks.push(render);
    new ResizeObserver(render).observe(canvas);
    requestAnimationFrame(render);
  }

  /* ── 04 · a 3-D scene, projected with the EWA Jacobian ─────────────── */

  function normalize3(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }

  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  /* Σ = Σ_k a_k² v_k v_kᵀ from an orthonormal frame and three scales. */
  function covarianceFromFrame(t1, t2, n, a1, a2, a3, out, offset) {
    const w1 = a1 * a1;
    const w2 = a2 * a2;
    const w3 = a3 * a3;
    out[offset] = w1 * t1[0] * t1[0] + w2 * t2[0] * t2[0] + w3 * n[0] * n[0];
    out[offset + 1] = w1 * t1[0] * t1[1] + w2 * t2[0] * t2[1] + w3 * n[0] * n[1];
    out[offset + 2] = w1 * t1[0] * t1[2] + w2 * t2[0] * t2[2] + w3 * n[0] * n[2];
    out[offset + 3] = w1 * t1[1] * t1[1] + w2 * t2[1] * t2[1] + w3 * n[1] * n[1];
    out[offset + 4] = w1 * t1[1] * t1[2] + w2 * t2[1] * t2[2] + w3 * n[1] * n[2];
    out[offset + 5] = w1 * t1[2] * t1[2] + w2 * t2[2] * t2[2] + w3 * n[2] * n[2];
  }

  function frameFromNormal(n) {
    const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t1 = normalize3(cross3(helper, n));
    const t2 = cross3(n, t1);
    return [t1, t2];
  }

  function allocateScene(count) {
    return {
      count,
      position: new Float32Array(count * 3),
      covariance: new Float32Array(count * 6),
      color: new Float32Array(count * 3),
      lobe: new Float32Array(count * 3),
      opacity: new Float32Array(count),
    };
  }

  function mixColor(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /* A Gaussian-process surface: random Fourier features of an RBF kernel,
     with one flat splat sitting in the tangent plane of every grid vertex. */
  function buildSurfaceScene() {
    const random = randomSource(913371);
    const features = 42;
    const lengthScale = 1.15;
    const amplitude = 0.62;
    const omega = new Float64Array(features * 2);
    const phase = new Float64Array(features);
    for (let k = 0; k < features; k += 1) {
      const [g1, g2] = normalPair(random);
      omega[k * 2] = g1 / lengthScale;
      omega[k * 2 + 1] = g2 / lengthScale;
      phase[k] = random() * Math.PI * 2;
    }
    const weight = amplitude * Math.sqrt(2 / features);

    const field = (x, z) => {
      let value = 0;
      let dx = 0;
      let dz = 0;
      for (let k = 0; k < features; k += 1) {
        const wx = omega[k * 2];
        const wz = omega[k * 2 + 1];
        const argument = wx * x + wz * z + phase[k];
        value += Math.cos(argument);
        const sine = -Math.sin(argument);
        dx += sine * wx;
        dz += sine * wz;
      }
      return [value * weight, dx * weight, dz * weight];
    };

    const resolution = 74;
    const span = 2.8;
    const spacing = (2 * span) / (resolution - 1);
    const scene = allocateScene(resolution * resolution);
    const low = [24, 58, 98];
    const mid = [219, 202, 170];
    const high = [230, 124, 46];
    let index = 0;
    for (let row = 0; row < resolution; row += 1) {
      for (let column = 0; column < resolution; column += 1) {
        const x = -span + column * spacing;
        const z = -span + row * spacing;
        const [height, dx, dz] = field(x, z);
        const n = normalize3([-dx, 1, -dz]);
        const [t1, t2] = frameFromNormal(n);
        scene.position[index * 3] = x;
        scene.position[index * 3 + 1] = height;
        scene.position[index * 3 + 2] = z;
        covarianceFromFrame(t1, t2, n, spacing * 0.72, spacing * 0.72, spacing * 0.1, scene.covariance, index * 6);
        const level = clamp((height + 0.95) / 1.9, 0, 1);
        const base = level < 0.5 ? mixColor(low, mid, level * 2) : mixColor(mid, high, (level - 0.5) * 2);
        // A faint contour banding, the way a posterior mean is usually drawn.
        const shade = 0.93 + 0.07 * Math.cos(height * 14);
        scene.color[index * 3] = (base[0] / 255) * shade;
        scene.color[index * 3 + 1] = (base[1] / 255) * shade;
        scene.color[index * 3 + 2] = (base[2] / 255) * shade;
        scene.lobe[index * 3] = n[0] * 0.16;
        scene.lobe[index * 3 + 1] = n[1] * 0.16;
        scene.lobe[index * 3 + 2] = n[2] * 0.16;
        scene.opacity[index] = 0.99;
        index += 1;
      }
    }
    scene.distance = 7.4;
    scene.elevation = 0.44;
    scene.target = [0, 0.05, 0];
    return scene;
  }

  /* A (2,3) torus knot tube — surface splats hugging a curved shell. */
  function buildKnotScene() {
    const along = 420;
    const around = 24;
    const scene = allocateScene(along * around);
    const tube = 0.34;
    const warm = [232, 132, 58];
    const cool = [47, 127, 181];
    let index = 0;
    const curve = (t) => {
      const p = 2;
      const q = 3;
      const r = 1.6 + 0.72 * Math.cos(q * t);
      return [r * Math.cos(p * t), 0.72 * Math.sin(q * t), r * Math.sin(p * t)];
    };
    for (let i = 0; i < along; i += 1) {
      const t = (i / along) * Math.PI * 2;
      const centre = curve(t);
      const ahead = curve(t + 0.004);
      const behind = curve(t - 0.004);
      const tangent = normalize3([
        ahead[0] - behind[0],
        ahead[1] - behind[1],
        ahead[2] - behind[2],
      ]);
      const [u, v] = frameFromNormal(tangent);
      const arcSpacing = (Math.hypot(ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]) / 0.008) * ((Math.PI * 2) / along);
      for (let j = 0; j < around; j += 1) {
        const angle = (j / around) * Math.PI * 2;
        const normal = [
          u[0] * Math.cos(angle) + v[0] * Math.sin(angle),
          u[1] * Math.cos(angle) + v[1] * Math.sin(angle),
          u[2] * Math.cos(angle) + v[2] * Math.sin(angle),
        ];
        const position = [
          centre[0] + normal[0] * tube,
          centre[1] + normal[1] * tube,
          centre[2] + normal[2] * tube,
        ];
        const ring = cross3(normal, tangent);
        scene.position[index * 3] = position[0];
        scene.position[index * 3 + 1] = position[1];
        scene.position[index * 3 + 2] = position[2];
        covarianceFromFrame(
          tangent,
          ring,
          normal,
          arcSpacing * 0.62,
          ((Math.PI * 2 * tube) / around) * 0.75,
          0.022,
          scene.covariance,
          index * 6
        );
        const shade = mixColor(cool, warm, 0.5 + 0.5 * Math.sin(3 * t + angle));
        scene.color[index * 3] = shade[0] / 255;
        scene.color[index * 3 + 1] = shade[1] / 255;
        scene.color[index * 3 + 2] = shade[2] / 255;
        scene.lobe[index * 3] = normal[0] * 0.34;
        scene.lobe[index * 3 + 1] = normal[1] * 0.34;
        scene.lobe[index * 3 + 2] = normal[2] * 0.34;
        scene.opacity[index] = 0.99;
        index += 1;
      }
    }
    scene.distance = 6.4;
    scene.elevation = 0.35;
    scene.target = [0, 0, 0];
    return scene;
  }

  /* A volumetric cloud: no surface, low opacity, ordering decides everything. */
  function buildCloudScene() {
    const random = randomSource(50021);
    const count = 3400;
    const scene = allocateScene(count);
    const core = [250, 212, 128];
    const rim = [48, 100, 156];
    for (let i = 0; i < count; i += 1) {
      const arm = i % 2;
      const t = Math.pow(random(), 0.5);
      const radius = 0.12 + t * 2.2;
      const angle = t * 4.1 + arm * Math.PI + (normalPair(random)[0] * 0.1) / (0.3 + t);
      const [j1, j2] = normalPair(random);
      const spread = 0.035 + 0.075 * t;
      const x = Math.cos(angle) * radius + j1 * spread;
      const z = Math.sin(angle) * radius + j2 * spread;
      const y = normalPair(random)[0] * (0.16 - 0.05 * t) * (0.3 + 0.7 * Math.exp(-radius * 1.6));
      const n = normalize3([normalPair(random)[0], normalPair(random)[1], normalPair(random)[0]]);
      const [t1, t2] = frameFromNormal(n);
      const size = 0.028 + 0.05 * random() + 0.022 * t;
      scene.position[i * 3] = x;
      scene.position[i * 3 + 1] = y;
      scene.position[i * 3 + 2] = z;
      covarianceFromFrame(
        t1,
        t2,
        n,
        size,
        size * (0.55 + random() * 0.6),
        size * (0.45 + random() * 0.5),
        scene.covariance,
        i * 6
      );
      const heat = clamp(1 - t * 1.1 + random() * 0.2, 0, 1);
      const shade = mixColor(rim, core, heat * heat);
      scene.color[i * 3] = shade[0] / 255;
      scene.color[i * 3 + 1] = shade[1] / 255;
      scene.color[i * 3 + 2] = shade[2] / 255;
      scene.lobe[i * 3] = 0;
      scene.lobe[i * 3 + 1] = 0;
      scene.lobe[i * 3 + 2] = 0;
      scene.opacity[i] = 0.3 + 0.45 * heat;
    }
    scene.distance = 5.2;
    scene.elevation = 0.38;
    scene.target = [0, 0, 0];
    return scene;
  }

  const SCENES = {
    surface: { label: "GP surface", build: buildSurfaceScene },
    knot: { label: "Torus knot", build: buildKnotScene },
    cloud: { label: "Volumetric cloud", build: buildCloudScene },
  };

  function initScene(root) {
    const canvas = root.querySelector("[data-scene-canvas]");
    if (!canvas) return;

    const cache = {};
    let sceneName = "surface";
    let scene = null;
    const camera = { azimuth: 0.9, elevation: 0.42, distance: 7.2, target: [0, 0.1, 0] };
    const options = { sort: true, sh: true, dilate: true, outline: false };
    let splatScale = 1;
    let opacityScale = 1;
    let running = !reducedMotion;
    let visible = true;
    let dragging = null;
    let resolutionScale = 1;
    let frameCost = 16;
    let lastFrame = 0;
    let inspected = null;

    const buffer = document.createElement("canvas");
    let accumulated = new Float32Array(0);
    let transmittance = new Float32Array(0);
    let imageData = null;

    // Per-splat projection scratch.
    let depth = new Float32Array(0);
    let screenX = new Float32Array(0);
    let screenY = new Float32Array(0);
    let conic = new Float32Array(0);
    let extent = new Float32Array(0);
    let shade = new Float32Array(0);
    let visibleIndices = new Int32Array(0);
    let sortedIndices = new Int32Array(0);
    let bucketCount = new Int32Array(2048);

    function useScene(name) {
      sceneName = name;
      if (!cache[name]) {
        cache[name] = SCENES[name].build();
        // The order splats happen to sit in memory — what "unsorted" really means.
        const shuffle = randomSource(19);
        const order = new Int32Array(cache[name].count);
        for (let i = 0; i < order.length; i += 1) order[i] = i;
        for (let i = order.length - 1; i > 0; i -= 1) {
          const j = Math.floor(shuffle() * (i + 1));
          const swap = order[i];
          order[i] = order[j];
          order[j] = swap;
        }
        cache[name].order = order;
      }
      scene = cache[name];
      camera.distance = scene.distance;
      camera.elevation = scene.elevation;
      camera.azimuth = 0.9;
      camera.target = scene.target.slice();
      resolutionScale = 1;
      frameCost = 16;
      const distanceInput = root.querySelector("[data-scene-distance]");
      if (distanceInput) distanceInput.value = String(camera.distance);
      const count = scene.count;
      if (depth.length < count) {
        depth = new Float32Array(count);
        screenX = new Float32Array(count);
        screenY = new Float32Array(count);
        conic = new Float32Array(count * 3);
        extent = new Float32Array(count);
        shade = new Float32Array(count * 3);
        visibleIndices = new Int32Array(count);
        sortedIndices = new Int32Array(count);
      }
      const countNode = root.querySelector("[data-scene-count]");
      if (countNode) countNode.textContent = count.toLocaleString("en-US");
      updateSliderOutputs();
    }

    root.querySelectorAll("[data-scene-name]").forEach((button) => {
      button.addEventListener("click", () => {
        useScene(button.dataset.sceneName);
        root.querySelectorAll("[data-scene-name]").forEach((other) => {
          const active = other === button;
          other.classList.toggle("is-active", active);
          other.setAttribute("aria-pressed", active ? "true" : "false");
        });
        draw();
      });
    });

    root.querySelectorAll("[data-scene-toggle]").forEach((button) => {
      const key = button.dataset.sceneToggle;
      const sync = () => {
        button.classList.toggle("is-active", options[key]);
        button.setAttribute("aria-pressed", options[key] ? "true" : "false");
      };
      button.addEventListener("click", () => {
        options[key] = !options[key];
        sync();
        draw();
      });
      sync();
    });

    const playButton = root.querySelector("[data-scene-play]");
    const playLabel = root.querySelector("[data-scene-play-label]");
    function syncPlay() {
      root.classList.toggle("is-running", running);
      if (playLabel) playLabel.textContent = running ? "Pause orbit" : "Orbit";
    }
    if (playButton) {
      playButton.addEventListener("click", () => {
        running = !running;
        syncPlay();
      });
    }
    syncPlay();

    const sliders = [
      { attribute: "data-scene-distance", apply: (value) => { camera.distance = value; } },
      { attribute: "data-scene-scale", apply: (value) => { splatScale = value; } },
      { attribute: "data-scene-opacity", apply: (value) => { opacityScale = value; } },
    ];
    sliders.forEach(({ attribute, apply }) => {
      const input = root.querySelector(`[${attribute}]`);
      if (!input) return;
      input.addEventListener("input", () => {
        apply(Number.parseFloat(input.value));
        updateSliderOutputs();
        draw();
      });
    });

    function updateSliderOutputs() {
      const set = (selector, text) => {
        const node = root.querySelector(selector);
        if (node) node.textContent = text;
      };
      set("[data-scene-distance-output]", `d = ${camera.distance.toFixed(1)}`);
      set("[data-scene-scale-output]", `×${splatScale.toFixed(2)}`);
      set("[data-scene-opacity-output]", `×${opacityScale.toFixed(2)}`);
    }

    canvas.addEventListener("pointerdown", (event) => {
      dragging = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      camera.azimuth -= (event.clientX - dragging.x) * 0.006;
      camera.elevation = clamp(camera.elevation + (event.clientY - dragging.y) * 0.005, -0.35, 1.35);
      dragging = { x: event.clientX, y: event.clientY };
      draw();
    });
    const stopDrag = () => {
      dragging = null;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);
    canvas.style.cursor = "grab";

    function cameraBasis() {
      const cosElevation = Math.cos(camera.elevation);
      const eye = [
        camera.target[0] + camera.distance * cosElevation * Math.sin(camera.azimuth),
        camera.target[1] + camera.distance * Math.sin(camera.elevation),
        camera.target[2] + camera.distance * cosElevation * Math.cos(camera.azimuth),
      ];
      const forward = normalize3([
        camera.target[0] - eye[0],
        camera.target[1] - eye[1],
        camera.target[2] - eye[2],
      ]);
      const right = normalize3(cross3(forward, [0, 1, 0]));
      const up = cross3(right, forward);
      return { eye, right, up, forward };
    }

    function project(width, height) {
      const { eye, right, up, forward } = cameraBasis();
      const focal = (0.5 * height) / Math.tan(0.42);
      const centreX = width / 2;
      const centreY = height / 2;
      const dilation = options.dilate ? 0.3 : 0;
      const scaleSquared = splatScale * splatScale;
      let count = 0;

      for (let k = 0; k < scene.count; k += 1) {
        const i = scene.order[k];
        const dx = scene.position[i * 3] - eye[0];
        const dy = scene.position[i * 3 + 1] - eye[1];
        const dz = scene.position[i * 3 + 2] - eye[2];
        const tz = forward[0] * dx + forward[1] * dy + forward[2] * dz;
        if (tz < 0.25) continue;
        const tx = right[0] * dx + right[1] * dy + right[2] * dz;
        const ty = up[0] * dx + up[1] * dy + up[2] * dz;

        const px = centreX + (focal * tx) / tz;
        const py = centreY - (focal * ty) / tz;
        if (px < -160 || py < -160 || px > width + 160 || py > height + 160) continue;

        // Camera-space covariance: Σ_cam = W Σ Wᵀ with W = [right; up; forward].
        const c0 = scene.covariance[i * 6] * scaleSquared;
        const c1 = scene.covariance[i * 6 + 1] * scaleSquared;
        const c2 = scene.covariance[i * 6 + 2] * scaleSquared;
        const c3 = scene.covariance[i * 6 + 3] * scaleSquared;
        const c4 = scene.covariance[i * 6 + 4] * scaleSquared;
        const c5 = scene.covariance[i * 6 + 5] * scaleSquared;

        // Rows of W applied to Σ (Σ is symmetric, stored as xx xy xz yy yz zz).
        const rw0 = c0 * right[0] + c1 * right[1] + c2 * right[2];
        const rw1 = c1 * right[0] + c3 * right[1] + c4 * right[2];
        const rw2 = c2 * right[0] + c4 * right[1] + c5 * right[2];
        const uw0 = c0 * up[0] + c1 * up[1] + c2 * up[2];
        const uw1 = c1 * up[0] + c3 * up[1] + c4 * up[2];
        const uw2 = c2 * up[0] + c4 * up[1] + c5 * up[2];
        const fw0 = c0 * forward[0] + c1 * forward[1] + c2 * forward[2];
        const fw1 = c1 * forward[0] + c3 * forward[1] + c4 * forward[2];
        const fw2 = c2 * forward[0] + c4 * forward[1] + c5 * forward[2];

        const mxx = rw0 * right[0] + rw1 * right[1] + rw2 * right[2];
        const mxy = rw0 * up[0] + rw1 * up[1] + rw2 * up[2];
        const mxz = rw0 * forward[0] + rw1 * forward[1] + rw2 * forward[2];
        const myy = uw0 * up[0] + uw1 * up[1] + uw2 * up[2];
        const myz = uw0 * forward[0] + uw1 * forward[1] + uw2 * forward[2];
        const mzz = fw0 * forward[0] + fw1 * forward[1] + fw2 * forward[2];

        // Affine Jacobian of the projection, with the screen-space y flip.
        const j00 = focal / tz;
        const j02 = (-focal * tx) / (tz * tz);
        const j11 = -focal / tz;
        const j12 = (focal * ty) / (tz * tz);

        // Σ' = J Σ_cam Jᵀ, plus the one-pixel low-pass filter.
        const a0 = j00 * mxx + j02 * mxz;
        const a1 = j00 * mxy + j02 * myz;
        const a2 = j00 * mxz + j02 * mzz;
        const b0 = j11 * mxy + j12 * mxz;
        const b1 = j11 * myy + j12 * myz;
        const b2 = j11 * myz + j12 * mzz;

        let sxx = a0 * j00 + a2 * j02 + dilation;
        let sxy = a1 * j11 + a2 * j12;
        let syy = b1 * j11 + b2 * j12 + dilation;
        if (sxx < 1e-4) sxx = 1e-4;
        if (syy < 1e-4) syy = 1e-4;

        const determinant = sxx * syy - sxy * sxy;
        if (determinant <= 1e-7) continue;

        const half = 0.5 * (sxx + syy);
        const spread = Math.sqrt(Math.max(0, half * half - determinant));
        const major = half + spread;
        const radius = Math.min(3 * Math.sqrt(major), 220);
        if (radius < 0.6) continue;

        conic[count * 3] = syy / determinant;
        conic[count * 3 + 1] = -sxy / determinant;
        conic[count * 3 + 2] = sxx / determinant;
        screenX[count] = px;
        screenY[count] = py;
        extent[count] = radius;
        depth[count] = tz;

        let r = scene.color[i * 3];
        let g = scene.color[i * 3 + 1];
        let b = scene.color[i * 3 + 2];
        if (options.sh) {
          // Degree-1 spherical harmonic: a linear function of the view direction.
          const inverseLength = 1 / Math.hypot(dx, dy, dz);
          const viewX = -dx * inverseLength;
          const viewY = -dy * inverseLength;
          const viewZ = -dz * inverseLength;
          const lobe =
            scene.lobe[i * 3] * viewX + scene.lobe[i * 3 + 1] * viewY + scene.lobe[i * 3 + 2] * viewZ;
          r = clamp(r + lobe * 0.95, 0, 1);
          g = clamp(g + lobe * 0.9, 0, 1);
          b = clamp(b + lobe * 0.78, 0, 1);
        }
        shade[count * 3] = r * 255;
        shade[count * 3 + 1] = g * 255;
        shade[count * 3 + 2] = b * 255;
        visibleIndices[count] = i;
        count += 1;
      }
      return count;
    }

    /* Counting sort on quantised depth: front-to-back, allocation free. */
    function sortByDepth(count) {
      if (count === 0) return;
      let minimum = Infinity;
      let maximum = -Infinity;
      for (let i = 0; i < count; i += 1) {
        const value = depth[i];
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
      }
      const buckets = bucketCount.length;
      const span = Math.max(maximum - minimum, 1e-4);
      bucketCount.fill(0);
      const keys = new Int32Array(count);
      for (let i = 0; i < count; i += 1) {
        const bucket = Math.min(buckets - 1, Math.floor(((depth[i] - minimum) / span) * (buckets - 1)));
        keys[i] = bucket;
        bucketCount[bucket] += 1;
      }
      let running = 0;
      for (let bucket = 0; bucket < buckets; bucket += 1) {
        const size = bucketCount[bucket];
        bucketCount[bucket] = running;
        running += size;
      }
      for (let i = 0; i < count; i += 1) {
        sortedIndices[bucketCount[keys[i]]] = i;
        bucketCount[keys[i]] += 1;
      }
    }

    function draw() {
      const surface = fitCanvas(canvas, 1);
      if (!surface || !scene) return;
      const { context, width, height } = surface;
      const colors = palette();
      const start = performance.now();

      const bufferWidth = Math.max(8, Math.round(width * resolutionScale));
      const bufferHeight = Math.max(8, Math.round(height * resolutionScale));
      if (buffer.width !== bufferWidth || buffer.height !== bufferHeight) {
        buffer.width = bufferWidth;
        buffer.height = bufferHeight;
        imageData = null;
      }
      const bufferContext = buffer.getContext("2d");
      const pixels = bufferWidth * bufferHeight;
      if (accumulated.length !== pixels * 3) {
        accumulated = new Float32Array(pixels * 3);
        transmittance = new Float32Array(pixels);
      }
      if (!imageData) imageData = bufferContext.createImageData(bufferWidth, bufferHeight);
      accumulated.fill(0);
      transmittance.fill(1);

      const count = project(bufferWidth, bufferHeight);
      if (options.sort) sortByDepth(count);

      let rasterized = 0;
      for (let position = 0; position < count; position += 1) {
        const index = options.sort ? sortedIndices[position] : position;
        const cx = screenX[index];
        const cy = screenY[index];
        const radius = extent[index];
        const minX = Math.max(0, Math.floor(cx - radius));
        const maxX = Math.min(bufferWidth - 1, Math.ceil(cx + radius));
        const minY = Math.max(0, Math.floor(cy - radius));
        const maxY = Math.min(bufferHeight - 1, Math.ceil(cy + radius));
        if (minX > maxX || minY > maxY) continue;
        const conicA = conic[index * 3];
        const conicB = conic[index * 3 + 1];
        const conicC = conic[index * 3 + 2];
        const opacity = Math.min(0.995, scene.opacity[visibleIndices[index]] * opacityScale);
        const red = shade[index * 3];
        const green = shade[index * 3 + 1];
        const blue = shade[index * 3 + 2];
        let touched = false;
        for (let py = minY; py <= maxY; py += 1) {
          const dy = py + 0.5 - cy;
          const rowOffset = py * bufferWidth;
          // The quadratic form is stepped along the row instead of re-evaluated.
          let dx = minX + 0.5 - cx;
          let power = conicA * dx * dx + 2 * conicB * dx * dy + conicC * dy * dy;
          let slope = conicA * (2 * dx + 1) + 2 * conicB * dy;
          for (let px = minX; px <= maxX; px += 1) {
            const current = power;
            power += slope;
            slope += 2 * conicA;
            if (current > EXP_MAX || current < 0) continue;
            const offset = rowOffset + px;
            const t = transmittance[offset];
            if (t < 0.004) continue;
            const position = current * EXP_SCALE;
            const bucket = position | 0;
            const fraction = position - bucket;
            const alpha =
              opacity * (EXP_TABLE[bucket] + (EXP_TABLE[bucket + 1] - EXP_TABLE[bucket]) * fraction);
            if (alpha < 0.004) continue;
            const weight = alpha * t;
            accumulated[offset * 3] += weight * red;
            accumulated[offset * 3 + 1] += weight * green;
            accumulated[offset * 3 + 2] += weight * blue;
            transmittance[offset] = t * (1 - alpha);
            touched = true;
          }
        }
        if (touched) rasterized += 1;
      }

      const data = imageData.data;
      const background = colors.bg;
      for (let offset = 0; offset < pixels; offset += 1) {
        const t = transmittance[offset];
        data[offset * 4] = accumulated[offset * 3] + t * background[0];
        data[offset * 4 + 1] = accumulated[offset * 3 + 1] + t * background[1];
        data[offset * 4 + 2] = accumulated[offset * 3 + 2] + t * background[2];
        data[offset * 4 + 3] = 255;
      }
      bufferContext.putImageData(imageData, 0, 0);
      context.imageSmoothingEnabled = true;
      context.clearRect(0, 0, width, height);
      context.drawImage(buffer, 0, 0, width, height);

      if (options.outline) {
        const step = Math.max(1, Math.round(count / 1100));
        const upscale = width / bufferWidth;
        context.save();
        // Wash the render back so the projected ellipses read on any scene.
        context.fillStyle = rgba(colors.bg, 0.72);
        context.fillRect(0, 0, width, height);
        context.lineWidth = 0.8;
        context.strokeStyle = rgba(colors.ink, 0.5);
        for (let position = 0; position < count; position += step) {
          const index = options.sort ? sortedIndices[position] : position;
          const conicA = conic[index * 3];
          const conicB = conic[index * 3 + 1];
          const conicC = conic[index * 3 + 2];
          const determinant = conicA * conicC - conicB * conicB;
          if (determinant <= 0) continue;
          const sxx = conicC / determinant;
          const sxy = -conicB / determinant;
          const syy = conicA / determinant;
          const half = 0.5 * (sxx + syy);
          const spread = Math.sqrt(Math.max(0, half * half - (sxx * syy - sxy * sxy)));
          const major = Math.sqrt(Math.max(half + spread, 1e-6));
          const minor = Math.sqrt(Math.max(half - spread, 1e-6));
          const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
          if (major * upscale > 200) continue;
          context.beginPath();
          context.ellipse(
            screenX[index] * upscale,
            screenY[index] * upscale,
            major * upscale,
            minor * upscale,
            angle,
            0,
            Math.PI * 2
          );
          context.stroke();
        }
        context.restore();
      }

      const elapsed = performance.now() - start;
      frameCost = frameCost * 0.85 + elapsed * 0.15;
      if (frameCost > 30 && resolutionScale > 0.45) resolutionScale = Math.max(0.45, resolutionScale - 0.08);
      else if (frameCost < 20 && resolutionScale < 1) resolutionScale = Math.min(1, resolutionScale + 0.05);

      const set = (selector, text) => {
        const node = root.querySelector(selector);
        if (node) node.textContent = text;
      };
      set("[data-scene-visible]", count.toLocaleString("en-US"));
      set("[data-scene-rasterized]", rasterized.toLocaleString("en-US"));
      set("[data-scene-frame]", `${frameCost.toFixed(1)} ms`);
      set("[data-scene-resolution]", `${bufferWidth}×${bufferHeight}`);
      inspected = count;
    }

    function tick(time) {
      requestAnimationFrame(tick);
      if (!visible) return;
      if (running && !dragging) {
        const delta = lastFrame ? Math.min(64, time - lastFrame) : 16;
        camera.azimuth += delta * 0.00016;
        draw();
      }
      lastFrame = time;
    }

    whenVisible(root, (isVisible) => {
      visible = isVisible;
      if (isVisible) draw();
    });
    themeHooks.push(draw);
    new ResizeObserver(() => draw()).observe(canvas);

    useScene(sceneName);
    requestAnimationFrame(() => {
      draw();
      requestAnimationFrame(tick);
    });
    void inspected;
  }

  /* ── boot ──────────────────────────────────────────────────────────── */

  document.querySelectorAll("[data-splat-anatomy]").forEach(initAnatomy);
  document.querySelectorAll("[data-splat-composite]").forEach(initComposite);
  document.querySelectorAll("[data-splat-scene]").forEach(initScene);
}());
