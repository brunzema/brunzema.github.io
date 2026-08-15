/* Gaussian splatting note — fitting an image with 2-D splats.
   A complete differentiable rasteriser: front-to-back alpha compositing in the
   forward pass, the analytic 3DGS backward pass (no autodiff), Adam, and the
   clone / split / prune density control from Kerbl et al. (2023). */
(function () {
  "use strict";

  const RESOLUTION = 96;
  const PIXELS = RESOLUTION * RESOLUTION;
  const BACKGROUND = 0.5;
  const MAX_ALPHA = 0.99;
  const CUTOFF = 0.002;

  const LEARNING_RATES = {
    position: 0.35,
    logScale: 0.022,
    theta: 0.02,
    color: 0.035,
    opacity: 0.05,
  };

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
  const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
  const sigmoid = (value) => 1 / (1 + Math.exp(-value));
  const logit = (value) => Math.log(value / (1 - value));

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

  /* ── targets ───────────────────────────────────────────────────────── */

  function canvasTarget(paint) {
    const canvas = document.createElement("canvas");
    canvas.width = RESOLUTION;
    canvas.height = RESOLUTION;
    const context = canvas.getContext("2d");
    paint(context, RESOLUTION);
    const image = context.getImageData(0, 0, RESOLUTION, RESOLUTION).data;
    const target = new Float32Array(PIXELS * 3);
    for (let index = 0; index < PIXELS; index += 1) {
      target[index * 3] = image[index * 4] / 255;
      target[index * 3 + 1] = image[index * 4 + 1] / 255;
      target[index * 3 + 2] = image[index * 4 + 2] / 255;
    }
    return target;
  }

  function buildDusk() {
    return canvasTarget((context, size) => {
      const sky = context.createLinearGradient(0, 0, 0, size * 0.72);
      sky.addColorStop(0, "#1d2b4c");
      sky.addColorStop(0.45, "#7b4a6b");
      sky.addColorStop(0.78, "#d97b4a");
      sky.addColorStop(1, "#f2c46b");
      context.fillStyle = sky;
      context.fillRect(0, 0, size, size);

      const glow = context.createRadialGradient(size * 0.66, size * 0.6, 0, size * 0.66, size * 0.6, size * 0.42);
      glow.addColorStop(0, "rgba(255, 233, 173, 0.95)");
      glow.addColorStop(1, "rgba(255, 210, 120, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, size, size);

      context.beginPath();
      context.arc(size * 0.66, size * 0.6, size * 0.085, 0, Math.PI * 2);
      context.fillStyle = "#fff3cd";
      context.fill();

      context.beginPath();
      context.moveTo(0, size * 0.62);
      context.bezierCurveTo(size * 0.22, size * 0.5, size * 0.34, size * 0.66, size * 0.52, size * 0.6);
      context.bezierCurveTo(size * 0.7, size * 0.54, size * 0.84, size * 0.64, size, size * 0.58);
      context.lineTo(size, size * 0.74);
      context.lineTo(0, size * 0.74);
      context.closePath();
      context.fillStyle = "#4a3352";
      context.fill();

      context.fillStyle = "#241b31";
      context.fillRect(0, size * 0.72, size, size * 0.28);
      const water = context.createLinearGradient(0, size * 0.72, 0, size);
      water.addColorStop(0, "rgba(242, 196, 107, 0.55)");
      water.addColorStop(1, "rgba(29, 43, 76, 0.1)");
      context.fillStyle = water;
      context.fillRect(size * 0.58, size * 0.72, size * 0.16, size * 0.28);
    });
  }

  function buildBauhaus() {
    return canvasTarget((context, size) => {
      context.fillStyle = "#f2ece0";
      context.fillRect(0, 0, size, size);

      context.fillStyle = "#1f4e79";
      context.beginPath();
      context.arc(size * 0.36, size * 0.36, size * 0.24, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#e07a3c";
      context.beginPath();
      context.moveTo(size * 0.62, size * 0.14);
      context.lineTo(size * 0.92, size * 0.14);
      context.lineTo(size * 0.92, size * 0.44);
      context.closePath();
      context.fill();

      context.fillStyle = "#c9a227";
      context.beginPath();
      context.moveTo(size * 0.1, size * 0.9);
      context.arc(size * 0.1, size * 0.9, size * 0.34, -Math.PI / 2, 0);
      context.closePath();
      context.fill();

      context.fillStyle = "#1c1a17";
      context.fillRect(size * 0.56, size * 0.56, size * 0.36, size * 0.09);
      context.fillStyle = "#8a3f5c";
      context.fillRect(size * 0.56, size * 0.72, size * 0.36, size * 0.09);
      context.fillStyle = "#3f7d63";
      context.beginPath();
      context.arc(size * 0.74, size * 0.9, size * 0.055, 0, Math.PI * 2);
      context.fill();
    });
  }

  /* A Gaussian-process posterior draw, coloured and contoured. */
  function buildField() {
    const random = randomSource(4242);
    const features = 36;
    const omega = new Float64Array(features * 2);
    const phase = new Float64Array(features);
    for (let k = 0; k < features; k += 1) {
      const [g1, g2] = normalPair(random);
      omega[k * 2] = g1 * 2.1;
      omega[k * 2 + 1] = g2 * 2.1;
      phase[k] = random() * Math.PI * 2;
    }
    const weight = Math.sqrt(2 / features);
    const target = new Float32Array(PIXELS * 3);
    const low = [24, 58, 94];
    const mid = [239, 233, 219];
    const high = [214, 108, 46];
    for (let row = 0; row < RESOLUTION; row += 1) {
      for (let column = 0; column < RESOLUTION; column += 1) {
        const x = column / RESOLUTION - 0.5;
        const y = row / RESOLUTION - 0.5;
        let value = 0;
        for (let k = 0; k < features; k += 1) {
          value += Math.cos(omega[k * 2] * x + omega[k * 2 + 1] * y + phase[k]);
        }
        value *= weight;
        const level = clamp(0.5 + value * 0.55, 0, 1);
        const base =
          level < 0.5
            ? low.map((channel, i) => channel + (mid[i] - channel) * level * 2)
            : mid.map((channel, i) => channel + (high[i] - channel) * (level - 0.5) * 2);
        const band = Math.abs(((value * 3) % 1 + 1) % 1 - 0.5) * 2;
        const contour = band > 0.93 ? 0.72 : 1;
        const index = (row * RESOLUTION + column) * 3;
        target[index] = (base[0] / 255) * contour;
        target[index + 1] = (base[1] / 255) * contour;
        target[index + 2] = (base[2] / 255) * contour;
      }
    }
    return target;
  }

  const TARGETS = {
    dusk: { label: "Dusk", build: buildDusk },
    bauhaus: { label: "Hard edges", build: buildBauhaus },
    field: { label: "GP draw", build: buildField },
  };

  /* ── the fitter ────────────────────────────────────────────────────── */

  function initFit(root) {
    const canvas = root.querySelector("[data-fit-canvas]");
    if (!canvas) return;

    const targets = {};
    let targetName = "dusk";
    let target = null;
    let splats = [];
    let iteration = 0;
    let budget = 600;
    let densifying = true;
    let running = false;
    let view = "render";
    let visible = true;
    let history = [];
    let random = randomSource(7);
    let residualGain = 4;

    const colorBuffer = new Float32Array(PIXELS * 3);
    const transmittance = new Float64Array(PIXELS);
    const finalTransmittance = new Float64Array(PIXELS);
    const suffix = new Float32Array(PIXELS * 3);
    const outputGradient = new Float32Array(PIXELS * 3);
    const renderCanvas = document.createElement("canvas");
    renderCanvas.width = RESOLUTION;
    renderCanvas.height = RESOLUTION;
    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = RESOLUTION;
    targetCanvas.height = RESOLUTION;

    function sampleTarget(x, y) {
      const column = clamp(Math.round(x - 0.5), 0, RESOLUTION - 1);
      const row = clamp(Math.round(y - 0.5), 0, RESOLUTION - 1);
      const index = (row * RESOLUTION + column) * 3;
      return [target[index], target[index + 1], target[index + 2]];
    }

    function makeSplat(x, y, scale, colour, opacity) {
      const safe = (value) => clamp(value, 0.01, 0.99);
      return {
        x,
        y,
        logSx: Math.log(scale),
        logSy: Math.log(scale),
        theta: random() * Math.PI,
        cr: logit(safe(colour[0])),
        cg: logit(safe(colour[1])),
        cb: logit(safe(colour[2])),
        ao: logit(safe(opacity)),
        moment: new Float64Array(9),
        velocity: new Float64Array(9),
        steps: 0,
        gradientSum: 0,
        gradientCount: 0,
      };
    }

    function reset() {
      random = randomSource(7);
      splats = [];
      iteration = 0;
      history = [];
      const initial = 120;
      for (let i = 0; i < initial; i += 1) {
        const x = random() * RESOLUTION;
        const y = random() * RESOLUTION;
        splats.push(makeSplat(x, y, 3.4 + random() * 2.6, sampleTarget(x, y), 0.55));
      }
      paintTarget();
      const loss = forward();
      draw();
      updateMetrics(loss);
    }

    function paintTarget() {
      const context = targetCanvas.getContext("2d");
      const image = context.createImageData(RESOLUTION, RESOLUTION);
      for (let index = 0; index < PIXELS; index += 1) {
        image.data[index * 4] = clamp(target[index * 3], 0, 1) * 255;
        image.data[index * 4 + 1] = clamp(target[index * 3 + 1], 0, 1) * 255;
        image.data[index * 4 + 2] = clamp(target[index * 3 + 2], 0, 1) * 255;
        image.data[index * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    }

    /* Forward: front-to-back compositing, C = Σ cᵢ aᵢ Tᵢ + T_bg · background. */
    function forward() {
      colorBuffer.fill(0);
      transmittance.fill(1);
      for (let s = 0; s < splats.length; s += 1) {
        const splat = splats[s];
        const geometry = geometryOf(splat);
        const { conicA, conicB, conicC, radius } = geometry;
        const opacity = MAX_ALPHA * sigmoid(splat.ao);
        const red = sigmoid(splat.cr);
        const green = sigmoid(splat.cg);
        const blue = sigmoid(splat.cb);
        const minX = Math.max(0, Math.floor(splat.x - radius));
        const maxX = Math.min(RESOLUTION - 1, Math.ceil(splat.x + radius));
        const minY = Math.max(0, Math.floor(splat.y - radius));
        const maxY = Math.min(RESOLUTION - 1, Math.ceil(splat.y + radius));
        for (let py = minY; py <= maxY; py += 1) {
          const dy = py + 0.5 - splat.y;
          for (let px = minX; px <= maxX; px += 1) {
            const dx = px + 0.5 - splat.x;
            const power = conicA * dx * dx + 2 * conicB * dx * dy + conicC * dy * dy;
            if (power > 18) continue;
            const alpha = opacity * Math.exp(-0.5 * power);
            if (alpha < CUTOFF) continue;
            const offset = py * RESOLUTION + px;
            const t = transmittance[offset];
            const weight = alpha * t;
            colorBuffer[offset * 3] += weight * red;
            colorBuffer[offset * 3 + 1] += weight * green;
            colorBuffer[offset * 3 + 2] += weight * blue;
            transmittance[offset] = t * (1 - alpha);
          }
        }
      }
      let loss = 0;
      for (let offset = 0; offset < PIXELS; offset += 1) {
        const t = transmittance[offset];
        finalTransmittance[offset] = t;
        for (let channel = 0; channel < 3; channel += 1) {
          const index = offset * 3 + channel;
          const value = colorBuffer[index] + t * BACKGROUND;
          const error = value - target[index];
          loss += error * error;
          outputGradient[index] = (2 * error) / (PIXELS * 3);
        }
      }
      return loss / (PIXELS * 3);
    }

    function geometryOf(splat) {
      const sx = Math.exp(splat.logSx);
      const sy = Math.exp(splat.logSy);
      const cos = Math.cos(splat.theta);
      const sin = Math.sin(splat.theta);
      const xx = cos * cos * sx * sx + sin * sin * sy * sy;
      const xy = cos * sin * (sx * sx - sy * sy);
      const yy = sin * sin * sx * sx + cos * cos * sy * sy;
      const determinant = Math.max(xx * yy - xy * xy, 1e-8);
      return {
        sx,
        sy,
        cos,
        sin,
        conicA: yy / determinant,
        conicB: -xy / determinant,
        conicC: xx / determinant,
        radius: Math.min(3 * Math.max(sx, sy), 60),
      };
    }

    /* Backward: walk the splats in reverse, rebuilding Tᵢ from T_final. */
    function backward() {
      suffix.fill(0);
      for (let offset = 0; offset < PIXELS; offset += 1) {
        const t = finalTransmittance[offset];
        suffix[offset * 3] = t * BACKGROUND;
        suffix[offset * 3 + 1] = t * BACKGROUND;
        suffix[offset * 3 + 2] = t * BACKGROUND;
        transmittance[offset] = t;
      }

      for (let s = splats.length - 1; s >= 0; s -= 1) {
        const splat = splats[s];
        const geometry = geometryOf(splat);
        const { conicA, conicB, conicC, radius, sx, sy, cos, sin } = geometry;
        const sigmoidOpacity = sigmoid(splat.ao);
        const opacity = MAX_ALPHA * sigmoidOpacity;
        const red = sigmoid(splat.cr);
        const green = sigmoid(splat.cg);
        const blue = sigmoid(splat.cb);
        const minX = Math.max(0, Math.floor(splat.x - radius));
        const maxX = Math.min(RESOLUTION - 1, Math.ceil(splat.x + radius));
        const minY = Math.max(0, Math.floor(splat.y - radius));
        const maxY = Math.min(RESOLUTION - 1, Math.ceil(splat.y + radius));

        let gradRed = 0;
        let gradGreen = 0;
        let gradBlue = 0;
        let gradOpacity = 0;
        let gradX = 0;
        let gradY = 0;
        let gradConicA = 0;
        let gradConicB = 0;
        let gradConicC = 0;

        for (let py = minY; py <= maxY; py += 1) {
          const dy = py + 0.5 - splat.y;
          for (let px = minX; px <= maxX; px += 1) {
            const dx = px + 0.5 - splat.x;
            const power = conicA * dx * dx + 2 * conicB * dx * dy + conicC * dy * dy;
            if (power > 18) continue;
            const gaussian = Math.exp(-0.5 * power);
            const alpha = opacity * gaussian;
            if (alpha < CUTOFF) continue;
            const offset = py * RESOLUTION + px;
            // Tᵢ = T_{i+1} / (1 − aᵢ): the trick that makes the reverse pass O(1) in memory.
            const after = transmittance[offset];
            const t = after / (1 - alpha);
            transmittance[offset] = t;

            const dCr = outputGradient[offset * 3];
            const dCg = outputGradient[offset * 3 + 1];
            const dCb = outputGradient[offset * 3 + 2];
            const weight = alpha * t;
            gradRed += dCr * weight;
            gradGreen += dCg * weight;
            gradBlue += dCb * weight;

            const inverse = 1 / (1 - alpha);
            const dAlpha =
              dCr * (t * red - suffix[offset * 3] * inverse) +
              dCg * (t * green - suffix[offset * 3 + 1] * inverse) +
              dCb * (t * blue - suffix[offset * 3 + 2] * inverse);

            suffix[offset * 3] += weight * red;
            suffix[offset * 3 + 1] += weight * green;
            suffix[offset * 3 + 2] += weight * blue;

            gradOpacity += dAlpha * gaussian;
            const dGaussian = dAlpha * opacity;
            // G = exp(−½ power) ⇒ dL/dpower = −½ G dL/dG.
            const dPower = -0.5 * gaussian * dGaussian;
            gradConicA += dPower * dx * dx;
            gradConicB += dPower * 2 * dx * dy;
            gradConicC += dPower * dy * dy;
            gradX += dPower * -2 * (conicA * dx + conicB * dy);
            gradY += dPower * -2 * (conicB * dx + conicC * dy);
          }
        }

        // dL/dΣ = −Σ⁻¹ (dL/dΣ⁻¹) Σ⁻¹, then Σ = W Wᵀ with W = R S.
        const dA = gradConicA;
        const dB = gradConicB / 2;
        const dC = gradConicC;
        const m00 = conicA;
        const m01 = conicB;
        const m11 = conicC;
        const p00 = m00 * dA + m01 * dB;
        const p01 = m00 * dB + m01 * dC;
        const p10 = m01 * dA + m11 * dB;
        const p11 = m01 * dB + m11 * dC;
        const gSigma00 = -(p00 * m00 + p01 * m01);
        const gSigma01 = -(p00 * m01 + p01 * m11);
        const gSigma11 = -(p10 * m01 + p11 * m11);

        const w00 = sx * cos;
        const w01 = -sy * sin;
        const w10 = sx * sin;
        const w11 = sy * cos;
        // dL/dW = 2 · G_Σ · W (G_Σ symmetric).
        const dW00 = 2 * (gSigma00 * w00 + gSigma01 * w10);
        const dW01 = 2 * (gSigma00 * w01 + gSigma01 * w11);
        const dW10 = 2 * (gSigma01 * w00 + gSigma11 * w10);
        const dW11 = 2 * (gSigma01 * w01 + gSigma11 * w11);

        const gradSx = dW00 * cos + dW10 * sin;
        const gradSy = -dW01 * sin + dW11 * cos;
        const gradTheta =
          dW00 * -sx * sin + dW01 * -sy * cos + dW10 * sx * cos + dW11 * -sy * sin;

        const gradients = [
          gradX,
          gradY,
          gradSx * sx,
          gradSy * sy,
          gradTheta,
          gradRed * red * (1 - red),
          gradGreen * green * (1 - green),
          gradBlue * blue * (1 - blue),
          gradOpacity * MAX_ALPHA * sigmoidOpacity * (1 - sigmoidOpacity),
        ];
        applyAdam(splat, gradients);
        splat.gradientSum += Math.hypot(gradX, gradY);
        splat.gradientCount += 1;
      }
    }

    const RATES = [
      LEARNING_RATES.position,
      LEARNING_RATES.position,
      LEARNING_RATES.logScale,
      LEARNING_RATES.logScale,
      LEARNING_RATES.theta,
      LEARNING_RATES.color,
      LEARNING_RATES.color,
      LEARNING_RATES.color,
      LEARNING_RATES.opacity,
    ];
    const KEYS = ["x", "y", "logSx", "logSy", "theta", "cr", "cg", "cb", "ao"];

    function applyAdam(splat, gradients) {
      splat.steps += 1;
      const step = splat.steps;
      const beta1 = 0.9;
      const beta2 = 0.999;
      const correction1 = 1 - Math.pow(beta1, step);
      const correction2 = 1 - Math.pow(beta2, step);
      for (let p = 0; p < 9; p += 1) {
        const gradient = gradients[p];
        if (!Number.isFinite(gradient)) continue;
        splat.moment[p] = beta1 * splat.moment[p] + (1 - beta1) * gradient;
        splat.velocity[p] = beta2 * splat.velocity[p] + (1 - beta2) * gradient * gradient;
        const first = splat.moment[p] / correction1;
        const second = splat.velocity[p] / correction2;
        splat[KEYS[p]] -= (RATES[p] * first) / (Math.sqrt(second) + 1e-8);
      }
      splat.x = clamp(splat.x, -8, RESOLUTION + 8);
      splat.y = clamp(splat.y, -8, RESOLUTION + 8);
      splat.logSx = clamp(splat.logSx, Math.log(0.32), Math.log(46));
      splat.logSy = clamp(splat.logSy, Math.log(0.32), Math.log(46));
    }

    function cloneOf(splat) {
      return {
        ...splat,
        moment: new Float64Array(9),
        velocity: new Float64Array(9),
        steps: 0,
        gradientSum: 0,
        gradientCount: 0,
      };
    }

    /* Density control: clone the small, split the large, prune the faint. */
    function densify() {
      const scores = splats.map((splat) =>
        splat.gradientCount > 0 ? splat.gradientSum / splat.gradientCount : 0
      );
      const ranked = scores.slice().sort((a, b) => a - b);
      const threshold = ranked[Math.floor(ranked.length * 0.78)] || Infinity;
      const room = budget - splats.length;
      const next = [];
      let added = 0;
      for (let s = 0; s < splats.length; s += 1) {
        const splat = splats[s];
        next.push(splat);
        if (added >= room || scores[s] < threshold || scores[s] <= 0) continue;
        const sx = Math.exp(splat.logSx);
        const sy = Math.exp(splat.logSy);
        const child = cloneOf(splat);
        if (Math.max(sx, sy) > RESOLUTION * 0.045) {
          // Split: two smaller children, offset by a draw from the parent.
          const [g1, g2] = normalPair(random);
          const cos = Math.cos(splat.theta);
          const sin = Math.sin(splat.theta);
          const localX = g1 * sx * 0.7;
          const localY = g2 * sy * 0.7;
          const offsetX = cos * localX - sin * localY;
          const offsetY = sin * localX + cos * localY;
          splat.logSx -= Math.log(1.6);
          splat.logSy -= Math.log(1.6);
          child.logSx = splat.logSx;
          child.logSy = splat.logSy;
          child.x = splat.x + offsetX;
          child.y = splat.y + offsetY;
          splat.x -= offsetX * 0.5;
          splat.y -= offsetY * 0.5;
        } else {
          // Clone: a second splat nudged along the direction it wants to move.
          child.x = splat.x + (random() - 0.5) * 1.6;
          child.y = splat.y + (random() - 0.5) * 1.6;
        }
        next.push(child);
        added += 1;
      }

      splats = next.filter((splat) => {
        const opacity = MAX_ALPHA * sigmoid(splat.ao);
        const largest = Math.max(Math.exp(splat.logSx), Math.exp(splat.logSy));
        return opacity > 0.015 && largest < RESOLUTION * 0.75;
      });
      if (splats.length > budget) splats.length = budget;
      splats.forEach((splat) => {
        splat.gradientSum = 0;
        splat.gradientCount = 0;
      });
    }

    function step() {
      const loss = forward();
      backward();
      iteration += 1;
      if (densifying && iteration >= 80 && iteration <= 2400 && iteration % 60 === 0) densify();
      return loss;
    }

    /* ── drawing ─────────────────────────────────────────────────────── */

    function writeRender() {
      const context = renderCanvas.getContext("2d");
      const image = context.createImageData(RESOLUTION, RESOLUTION);
      if (view === "residual") {
        // The error shrinks by orders of magnitude, so the gain follows it.
        let largest = 0;
        for (let index = 0; index < PIXELS * 3; index += 1) {
          const value = colorBuffer[index] + finalTransmittance[(index / 3) | 0] * BACKGROUND;
          const error = Math.abs(value - target[index]);
          if (error > largest) largest = error;
        }
        residualGain = clamp(Math.round(0.9 / Math.max(largest, 1e-4)), 2, 200);
      }
      for (let offset = 0; offset < PIXELS; offset += 1) {
        const t = finalTransmittance[offset];
        for (let channel = 0; channel < 3; channel += 1) {
          const index = offset * 3 + channel;
          const value = colorBuffer[index] + t * BACKGROUND;
          const shown =
            view === "residual"
              ? clamp(Math.abs(value - target[index]) * residualGain, 0, 1)
              : clamp(value, 0, 1);
          image.data[offset * 4 + channel] = shown * 255;
        }
        image.data[offset * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    }

    function renderPreview() {
      forward();
      draw();
    }

    function draw() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(rect.width * ratio);
      const pixelHeight = Math.round(rect.height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = rect.width;
      const height = rect.height;
      const colors = palette();

      context.clearRect(0, 0, width, height);
      context.fillStyle = rgb(colors.bg);
      context.fillRect(0, 0, width, height);

      const curveHeight = 78;
      const gap = 18;
      const available = height - curveHeight - 34;
      const paneSize = Math.min((width - gap) / 2, available);
      const offsetX = (width - (paneSize * 2 + gap)) / 2;
      const offsetY = 18;

      writeRender();

      const panes = [
        { canvas: targetCanvas, x: offsetX, title: "TARGET · 96 × 96" },
        {
          canvas: renderCanvas,
          x: offsetX + paneSize + gap,
          title:
            view === "residual"
              ? `RESIDUAL · |render − target| × ${residualGain}`
              : view === "ellipses"
              ? `RENDER · ${splats.length} splats, 1σ outlines`
              : `RENDER · ${splats.length} splats`,
        },
      ];

      panes.forEach(({ canvas: source, x, title }) => {
        context.save();
        context.beginPath();
        context.rect(x, offsetY, paneSize, paneSize);
        context.clip();
        context.imageSmoothingEnabled = true;
        context.drawImage(source, x, offsetY, paneSize, paneSize);
        context.restore();
        context.strokeStyle = rgba(colors.line, 1);
        context.lineWidth = 1;
        context.strokeRect(x + 0.5, offsetY + 0.5, paneSize - 1, paneSize - 1);
        context.save();
        context.font = `600 9.5px ${colors.fontBody}`;
        context.fillStyle = rgb(colors.subtle);
        context.textBaseline = "bottom";
        context.fillText(title, x, offsetY - 6);
        context.restore();
      });

      if (view === "ellipses") {
        const paneX = offsetX + paneSize + gap;
        const scale = paneSize / RESOLUTION;
        context.save();
        context.beginPath();
        context.rect(paneX, offsetY, paneSize, paneSize);
        context.clip();
        // Wash the render back so several hundred overlapping outlines stay legible.
        context.fillStyle = rgba(colors.bg, 0.62);
        context.fillRect(paneX, offsetY, paneSize, paneSize);
        context.lineWidth = 0.6;
        context.strokeStyle = rgba(colors.ink, 0.32);
        splats.forEach((splat) => {
          const sx = Math.exp(splat.logSx) * scale;
          const sy = Math.exp(splat.logSy) * scale;
          if (sx > paneSize || sy > paneSize) return;
          context.beginPath();
          context.ellipse(
            paneX + splat.x * scale,
            offsetY + splat.y * scale,
            Math.max(sx, 0.6),
            Math.max(sy, 0.6),
            splat.theta,
            0,
            Math.PI * 2
          );
          context.stroke();
        });
        context.restore();
      }

      // PSNR history.
      const curveTop = offsetY + paneSize + 26;
      const curveX = offsetX;
      const curveWidth = paneSize * 2 + gap;
      context.strokeStyle = rgba(colors.line, 1);
      context.lineWidth = 1;
      context.strokeRect(curveX + 0.5, curveTop + 0.5, curveWidth - 1, curveHeight - 1);
      context.save();
      context.font = `600 9.5px ${colors.fontBody}`;
      context.fillStyle = rgb(colors.subtle);
      context.textBaseline = "bottom";
      context.fillText("RECONSTRUCTION QUALITY · PSNR (dB)", curveX, curveTop - 6);
      context.restore();

      if (history.length <= 1) {
        context.save();
        context.font = `500 10px ${colors.fontBody}`;
        context.fillStyle = rgb(colors.subtle);
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          "press “Fit splats” to start the optimizer",
          curveX + curveWidth / 2,
          curveTop + curveHeight / 2
        );
        context.restore();
      }

      if (history.length > 1) {
        const maxIteration = Math.max(400, history[history.length - 1].iteration);
        const values = history.map((point) => point.psnr);
        const low = Math.min(...values, 8);
        const high = Math.max(...values, 20) + 1;
        const toX = (value) => curveX + 6 + (value / maxIteration) * (curveWidth - 12);
        const toY = (value) =>
          curveTop + curveHeight - 8 - ((value - low) / (high - low)) * (curveHeight - 18);

        context.beginPath();
        history.forEach((point, index) => {
          const px = toX(point.iteration);
          const py = toY(point.psnr);
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        });
        context.strokeStyle = rgb(colors.accent);
        context.lineWidth = 1.6;
        context.stroke();

        context.beginPath();
        history.forEach((point, index) => {
          const px = toX(point.iteration);
          const py = curveTop + curveHeight - 8 - (point.count / Math.max(budget, 1)) * (curveHeight - 18);
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        });
        context.strokeStyle = rgba(colors.orange, 0.75);
        context.setLineDash([3, 3]);
        context.lineWidth = 1.2;
        context.stroke();
        context.setLineDash([]);

        const last = history[history.length - 1];
        context.save();
        context.font = `600 9px ${colors.fontBody}`;
        context.textAlign = "right";
        context.fillStyle = rgb(colors.accent);
        context.fillText(`${last.psnr.toFixed(1)} dB`, curveX + curveWidth - 8, curveTop + 14);
        context.fillStyle = rgba(colors.orange, 0.95);
        context.fillText(`${last.count} splats`, curveX + curveWidth - 8, curveTop + 26);
        context.restore();
      }
    }

    function updateMetrics(loss) {
      const psnr = loss > 0 ? 10 * Math.log10(1 / loss) : 99;
      const set = (selector, text) => {
        const node = root.querySelector(selector);
        if (node) node.textContent = text;
      };
      set("[data-fit-iteration]", `iteration ${iteration.toLocaleString("en-US")}`);
      set("[data-fit-psnr]", `${psnr.toFixed(2)} dB`);
      set("[data-fit-loss]", loss.toExponential(2));
      set("[data-fit-count]", splats.length.toLocaleString("en-US"));
      const parameters = splats.length * 9;
      set("[data-fit-parameters]", parameters.toLocaleString("en-US"));
      set("[data-fit-compression]", `${(((PIXELS * 3) / Math.max(parameters, 1))).toFixed(2)} ×`);
      if (iteration === 0 || iteration % 5 === 0) {
        history.push({ iteration, psnr, count: splats.length });
        if (history.length > 900) history = history.filter((_, index) => index % 2 === 0);
      }
      return psnr;
    }

    /* ── controls ────────────────────────────────────────────────────── */

    const playButton = root.querySelector("[data-fit-play]");
    const playLabel = root.querySelector("[data-fit-play-label]");
    function syncPlay() {
      root.classList.toggle("is-running", running);
      if (playLabel) playLabel.textContent = running ? "Pause" : "Fit splats";
    }
    if (playButton) {
      playButton.addEventListener("click", () => {
        running = !running;
        syncPlay();
      });
    }
    syncPlay();

    const restartButton = root.querySelector("[data-fit-restart]");
    if (restartButton) restartButton.addEventListener("click", () => reset());

    root.querySelectorAll("[data-fit-target]").forEach((button) => {
      button.addEventListener("click", () => {
        targetName = button.dataset.fitTarget;
        if (!targets[targetName]) targets[targetName] = TARGETS[targetName].build();
        target = targets[targetName];
        root.querySelectorAll("[data-fit-target]").forEach((other) => {
          const active = other === button;
          other.classList.toggle("is-active", active);
          other.setAttribute("aria-pressed", active ? "true" : "false");
        });
        reset();
      });
    });

    root.querySelectorAll("[data-fit-view]").forEach((button) => {
      button.addEventListener("click", () => {
        view = button.dataset.fitView;
        root.querySelectorAll("[data-fit-view]").forEach((other) => {
          const active = other === button;
          other.classList.toggle("is-active", active);
          other.setAttribute("aria-pressed", active ? "true" : "false");
        });
        draw();
      });
    });

    const budgetInput = root.querySelector("[data-fit-budget]");
    const budgetOutput = root.querySelector("[data-fit-budget-output]");
    if (budgetInput) {
      const syncBudget = () => {
        budget = Number.parseInt(budgetInput.value, 10);
        if (budgetOutput) budgetOutput.textContent = `${budget} splats`;
      };
      budgetInput.addEventListener("input", syncBudget);
      syncBudget();
    }

    const densifyButton = root.querySelector("[data-fit-densify]");
    if (densifyButton) {
      const syncDensify = () => {
        densifyButton.classList.toggle("is-active", densifying);
        densifyButton.setAttribute("aria-pressed", densifying ? "true" : "false");
      };
      densifyButton.addEventListener("click", () => {
        densifying = !densifying;
        syncDensify();
      });
      syncDensify();
    }

    whenVisible(root, (isVisible) => {
      visible = isVisible;
    });

    themeHooks.push(() => draw());
    new ResizeObserver(() => draw()).observe(canvas);

    function loop() {
      requestAnimationFrame(loop);
      if (!running || !visible) return;
      const start = performance.now();
      let loss = 0;
      let iterations = 0;
      do {
        loss = step();
        iterations += 1;
      } while (performance.now() - start < 12 && iterations < 6);
      updateMetrics(loss);
      draw();
    }

    targets[targetName] = TARGETS[targetName].build();
    target = targets[targetName];
    reset();
    requestAnimationFrame(loop);
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

  document.querySelectorAll("[data-splat-fit]").forEach(initFit);
}());
