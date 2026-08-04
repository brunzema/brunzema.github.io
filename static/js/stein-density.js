/* Old Faithful kernel-density application for the Stein variational inference note. */
(function () {
  "use strict";

  const lab = document.querySelector("[data-stein-density]");
  if (!lab) return;

  const canvas = lab.querySelector("[data-density-canvas]");
  const playButton = lab.querySelector("[data-density-play]");
  const bandwidthButtons = Array.from(lab.querySelectorAll("[data-density-bandwidth]"));
  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const particleCount = 96;
  const maxSteps = 160;
  const bandwidths = {
    fine: [0.16, 0.22],
    balanced: [0.24, 0.34],
    smooth: [0.36, 0.5],
  };
  let palette = readPalette();
  let observations = [];
  let modelObservations = [];
  let bandwidthName = "balanced";
  let particles = [];
  let trails = [];
  let step = 0;
  let queryDuration = 3;
  let conditional = { median: 0, low: 0, high: 0, values: [] };
  let densityGrid = null;
  let running = false;
  let visible = true;
  let draggingQuery = false;
  let frameId = 0;
  let previousTime = 0;
  let accumulator = 0;

  const observer = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible && running) schedule();
  }, { rootMargin: "100px" });
  observer.observe(lab);
  new ResizeObserver(draw).observe(canvas);

  window.addEventListener("themechange", () => {
    palette = readPalette();
    draw();
  });

  bandwidthButtons.forEach((button) => button.addEventListener("click", () => {
    bandwidthName = button.dataset.densityBandwidth;
    bandwidthButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    densityGrid = buildDensityGrid();
    conditional = conditionalSummary();
    resetParticles();
    update();
  }));

  playButton.addEventListener("click", () => {
    if (!observations.length) return;
    if (step >= maxSteps) resetParticles();
    running = !running;
    syncRunningState();
    if (running) schedule();
  });

  lab.querySelector("[data-density-reset]").addEventListener("click", () => {
    resetParticles();
    running = false;
    syncRunningState();
    update();
  });

  canvas.addEventListener("pointerdown", (event) => {
    const layout = canvasLayout(canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
    if (!inside(event.offsetX, event.offsetY, layout.main)) return;
    draggingQuery = true;
    canvas.setPointerCapture(event.pointerId);
    moveQuery(event.offsetX, layout.main);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!draggingQuery) return;
    const layout = canvasLayout(canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
    moveQuery(event.offsetX, layout.main);
  });
  canvas.addEventListener("pointerup", () => { draggingQuery = false; });
  canvas.addEventListener("pointercancel", () => { draggingQuery = false; });
  canvas.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    queryDuration = event.key === "Home" ? 3 : clamp(queryDuration + (event.key === "ArrowLeft" ? -0.05 : 0.05), 1.5, 5.2);
    conditional = conditionalSummary();
    update();
  });

  loadData();

  async function loadData() {
    try {
      const response = await fetch(lab.dataset.faithfulUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
      observations = rows.map((row) => {
        const columns = row.split(",");
        return [Number(columns[1]), Number(columns[2])];
      }).filter((point) => point.every(Number.isFinite));
      modelObservations = observations.map(toModel);
      densityGrid = buildDensityGrid();
      conditional = conditionalSummary();
      resetParticles();
      update();
    } catch (error) {
      lab.querySelector("[data-density-status]").textContent = "unable to load the geyser records";
      canvas.setAttribute("aria-label", "The Old Faithful dataset could not be loaded.");
    }
  }

  function resetParticles() {
    const random = randomSource(1989 + bandwidthName.length * 271);
    particles = Array.from({ length: particleCount }, (_, index) => {
      const column = index % 12;
      const row = Math.floor(index / 12);
      return [-2.25 + column * 0.41 + (random() - 0.5) * 0.2, -2.25 + row * 0.63 + (random() - 0.5) * 0.22];
    });
    trails = particles.map((point) => [point.slice()]);
    step = 0;
  }

  function moveQuery(screenX, main) {
    queryDuration = clamp(1.4 + (screenX - main.x) / main.width * 3.9, 1.5, 5.2);
    conditional = conditionalSummary();
    update();
  }

  function schedule() {
    if (!frameId && running && visible) frameId = requestAnimationFrame(tick);
  }

  function tick(time) {
    frameId = 0;
    if (!previousTime) previousTime = time;
    accumulator += Math.min(80, time - previousTime);
    previousTime = time;
    const interval = reducedMotion.matches ? 130 : 36;
    while (accumulator >= interval && running) {
      advance();
      accumulator -= interval;
    }
    update();
    if (step >= maxSteps) {
      running = false;
      syncRunningState();
    }
    schedule();
  }

  function advance() {
    if (step >= maxSteps) return;
    const scores = particles.map((point) => kdeValue(point).score);
    const distances = [];
    particles.forEach((first, firstIndex) => particles.slice(firstIndex + 1).forEach((second) => distances.push(squaredDistance(first, second))));
    distances.sort((a, b) => a - b);
    const kernelBandwidth = Math.max(0.035, distances[Math.floor(distances.length / 2)] / Math.log(particleCount + 1));
    const updates = particles.map((receiver) => {
      let update = [0, 0];
      particles.forEach((sender, senderIndex) => {
        const weight = Math.exp(-squaredDistance(sender, receiver) / kernelBandwidth);
        update = add(update, scale(scores[senderIndex], weight / particleCount));
        update = add(update, scale(sub(receiver, sender), 2 * weight / kernelBandwidth / particleCount));
      });
      return clip(update, 3);
    });
    const rate = 0.16 * (0.72 + 0.28 * (1 - step / maxSteps));
    particles = particles.map((point, index) => [
      clamp(point[0] + rate * updates[index][0], -2.6, 2.6),
      clamp(point[1] + rate * updates[index][1], -2.7, 2.7),
    ]);
    step += 1;
    if (step % 4 === 0) particles.forEach((point, index) => {
      trails[index].push(point.slice());
      if (trails[index].length > 10) trails[index].shift();
    });
  }

  function kdeValue(point) {
    if (!modelObservations.length) return { logDensity: -8, score: [0, 0] };
    const [hx, hy] = bandwidths[bandwidthName];
    const logs = modelObservations.map((observation) => -0.5 * (((point[0] - observation[0]) / hx) ** 2 + ((point[1] - observation[1]) / hy) ** 2));
    const maximum = Math.max(...logs);
    const weights = logs.map((value) => Math.exp(value - maximum));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let score = [0, 0];
    modelObservations.forEach((observation, index) => {
      score[0] += weights[index] / total * (observation[0] - point[0]) / (hx * hx);
      score[1] += weights[index] / total * (observation[1] - point[1]) / (hy * hy);
    });
    return { logDensity: maximum + Math.log(total / modelObservations.length) - Math.log(hx * hy), score };
  }

  function buildDensityGrid() {
    if (!modelObservations.length) return null;
    const columns = 52;
    const rows = 44;
    const values = [];
    let maximum = -Infinity;
    for (let row = 0; row <= rows; row += 1) for (let column = 0; column <= columns; column += 1) {
      const actual = [1.4 + column / columns * 3.9, 100 - row / rows * 60];
      const value = kdeValue(toModel(actual)).logDensity;
      values.push(value);
      maximum = Math.max(maximum, value);
    }
    return { columns, rows, values, maximum };
  }

  function conditionalSummary() {
    if (!modelObservations.length) return { median: 0, low: 0, high: 0, values: [] };
    const values = Array.from({ length: 181 }, (_, index) => {
      const wait = 40 + index / 180 * 60;
      return { wait, density: Math.exp(kdeValue(toModel([queryDuration, wait])).logDensity) };
    });
    const total = values.reduce((sum, item) => sum + item.density, 0);
    let cumulative = 0;
    const quantile = (threshold) => {
      for (const item of values) {
        cumulative += item.density / total;
        if (cumulative >= threshold) return item.wait;
      }
      return values.at(-1).wait;
    };
    cumulative = 0; const low = quantile(0.1);
    cumulative = 0; const median = quantile(0.5);
    cumulative = 0; const high = quantile(0.9);
    return { median, low, high, values };
  }

  function update() {
    if (!observations.length) return;
    const meanLogDensity = particles.reduce((sum, point) => sum + kdeValue(point).logDensity, 0) / particles.length;
    lab.querySelector("[data-density-step]").textContent = `step ${step} / ${maxSteps}`;
    lab.querySelector("[data-density-status]").textContent = step === 0 ? "particles begin dispersed" : `mean log density ${meanLogDensity.toFixed(2)}`;
    lab.querySelector("[data-density-observations]").textContent = String(observations.length);
    lab.querySelector("[data-density-duration]").textContent = `${queryDuration.toFixed(1)} min`;
    lab.querySelector("[data-density-wait]").textContent = `${Math.round(conditional.median)} min · ${Math.round(conditional.low)}–${Math.round(conditional.high)}`;
    canvas.setAttribute("aria-label", `Old Faithful density estimate from ${observations.length} records with ${particleCount} Stein particles at step ${step}. For an eruption lasting ${queryDuration.toFixed(1)} minutes, the estimated median wait is ${Math.round(conditional.median)} minutes and the central eighty-percent interval is ${Math.round(conditional.low)} to ${Math.round(conditional.high)} minutes. Drag the query line or use arrow keys to change the duration.`);
    draw();
  }

  function syncRunningState() {
    lab.classList.toggle("is-running", running);
    lab.querySelector("[data-density-play-label]").textContent = running ? "Pause" : step >= maxSteps ? "Replay" : "Fit particles";
  }

  function draw() {
    const surface = fitCanvas(canvas);
    if (!surface) return;
    const { context, width, height } = surface;
    const layout = canvasLayout(width, height);
    context.clearRect(0, 0, width, height);
    context.fillStyle = color(palette.bgWarm);
    context.fillRect(0, 0, width, height);
    if (!densityGrid) return;
    drawDensityField(context, layout.main);
    drawGrid(context, layout.main, 5, 5);
    context.save();
    context.beginPath(); context.rect(layout.main.x, layout.main.y, layout.main.width, layout.main.height); context.clip();
    trails.forEach((trail) => {
      context.beginPath();
      trail.forEach((point, index) => {
        const screen = projectActual(fromModel(point), layout.main);
        if (index === 0) context.moveTo(...screen); else context.lineTo(...screen);
      });
      context.strokeStyle = rgba(palette.accent, 0.1); context.lineWidth = 0.8; context.stroke();
    });
    observations.forEach((point) => {
      const screen = projectActual(point, layout.main);
      context.beginPath(); context.arc(screen[0], screen[1], 1.45, 0, Math.PI * 2);
      context.fillStyle = rgba(palette.ink, 0.25); context.fill();
    });
    const queryModelX = toModel([queryDuration, 70])[0];
    particles.forEach((point, index) => {
      const screen = projectActual(fromModel(point), layout.main);
      const selected = Math.abs(point[0] - queryModelX) < bandwidths[bandwidthName][0] * 0.7;
      context.beginPath(); context.arc(screen[0], screen[1], index % 6 === 0 ? 3.1 : 2.25, 0, Math.PI * 2);
      context.fillStyle = color(palette.bg); context.fill();
      context.strokeStyle = color(selected ? palette.orange : palette.accent);
      context.lineWidth = selected ? 1.5 : 1; context.stroke();
    });
    const queryX = projectActual([queryDuration, 70], layout.main)[0];
    context.setLineDash([5, 5]);
    context.beginPath(); context.moveTo(queryX, layout.main.y); context.lineTo(queryX, layout.main.y + layout.main.height);
    context.strokeStyle = color(palette.orange); context.lineWidth = 1.5; context.stroke(); context.setLineDash([]);
    context.restore();
    drawConditional(context, layout.conditional);
    drawLabels(context, layout);
  }

  function drawDensityField(context, plot) {
    const { columns, rows, values, maximum } = densityGrid;
    const cellWidth = plot.width / columns;
    const cellHeight = plot.height / rows;
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const value = values[row * (columns + 1) + column];
      const strength = Math.exp(Math.max(-7, value - maximum));
      context.fillStyle = color(blend(palette.bgWarm, palette.orange, 0.012 + 0.16 * strength));
      context.fillRect(plot.x + column * cellWidth, plot.y + row * cellHeight, cellWidth + 0.6, cellHeight + 0.6);
    }
    [0.16, 0.32, 0.55, 0.78].forEach((level) => drawContour(context, plot, maximum + Math.log(level)));
  }

  function drawContour(context, plot, level) {
    const { columns, rows, values } = densityGrid;
    const valueAt = (row, column) => values[row * (columns + 1) + column];
    context.beginPath();
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const corners = [valueAt(row, column), valueAt(row, column + 1), valueAt(row + 1, column + 1), valueAt(row + 1, column)].map((value) => value >= level);
      const edges = [];
      if (corners[0] !== corners[1]) edges.push([column + 0.5, row]);
      if (corners[1] !== corners[2]) edges.push([column + 1, row + 0.5]);
      if (corners[2] !== corners[3]) edges.push([column + 0.5, row + 1]);
      if (corners[3] !== corners[0]) edges.push([column, row + 0.5]);
      for (let index = 0; index + 1 < edges.length; index += 2) {
        context.moveTo(plot.x + edges[index][0] / columns * plot.width, plot.y + edges[index][1] / rows * plot.height);
        context.lineTo(plot.x + edges[index + 1][0] / columns * plot.width, plot.y + edges[index + 1][1] / rows * plot.height);
      }
    }
    context.strokeStyle = rgba(palette.orange, 0.5); context.lineWidth = 0.9; context.stroke();
  }

  function drawConditional(context, box) {
    context.fillStyle = color(blend(palette.bgWarm, palette.orange, 0.025));
    context.fillRect(box.x, box.y, box.width, box.height);
    drawGrid(context, box, 2, 5);
    const maximum = Math.max(...conditional.values.map((item) => item.density));
    const baseline = box.x + 12;
    const yForWait = (wait) => box.y + (1 - (wait - 40) / 60) * box.height;
    context.beginPath(); context.moveTo(baseline, yForWait(40));
    conditional.values.forEach((item) => context.lineTo(baseline + item.density / maximum * (box.width - 28), yForWait(item.wait)));
    context.lineTo(baseline, yForWait(100)); context.closePath();
    context.fillStyle = rgba(palette.orange, 0.18); context.fill();
    context.beginPath();
    conditional.values.forEach((item, index) => {
      const point = [baseline + item.density / maximum * (box.width - 28), yForWait(item.wait)];
      if (index === 0) context.moveTo(...point); else context.lineTo(...point);
    });
    context.strokeStyle = color(palette.orange); context.lineWidth = 1.7; context.stroke();
    const lowY = yForWait(conditional.low);
    const highY = yForWait(conditional.high);
    context.fillStyle = rgba(palette.accent, 0.12); context.fillRect(box.x, highY, box.width, lowY - highY);
    const medianY = yForWait(conditional.median);
    context.beginPath(); context.moveTo(box.x, medianY); context.lineTo(box.x + box.width, medianY);
    context.strokeStyle = color(palette.accent); context.lineWidth = 1.2; context.stroke();
  }

  function drawLabels(context, layout) {
    context.fillStyle = color(palette.subtle);
    context.font = `600 9px ${palette.fontBody}`;
    context.fillText("WAIT TO NEXT ERUPTION (MIN)", layout.main.x, layout.main.y - 18);
    context.textAlign = "right"; context.fillText("ERUPTION DURATION (MIN)", layout.main.x + layout.main.width, layout.main.y + layout.main.height + 24); context.textAlign = "left";
    context.fillText("CONDITIONAL WAIT", layout.conditional.x, layout.conditional.y - 18);
    [40, 60, 80, 100].forEach((wait) => {
      const y = layout.conditional.y + (1 - (wait - 40) / 60) * layout.conditional.height;
      context.fillText(String(wait), layout.conditional.x + 4, y - 4);
    });
    const queryX = projectActual([queryDuration, 70], layout.main)[0];
    context.fillStyle = color(palette.orange); context.textAlign = "center";
    context.fillText(`${queryDuration.toFixed(1)} MIN`, queryX, layout.main.y + 16); context.textAlign = "left";
  }

  function canvasLayout(width, height) {
    if (width >= 720) {
      const conditionalWidth = Math.min(190, width * 0.2);
      return {
        main: { x: 42, y: 58, width: width - conditionalWidth - 100, height: height - 102 },
        conditional: { x: width - conditionalWidth - 24, y: 58, width: conditionalWidth, height: height - 102 },
      };
    }
    return {
      main: { x: 34, y: 58, width: width - 52, height: height * 0.59 },
      conditional: { x: 34, y: height * 0.72, width: width - 52, height: height * 0.2 },
    };
  }

  function toModel([eruption, waiting]) { return [(eruption - 3.5) / 0.85, (waiting - 70) / 12]; }
  function fromModel([first, second]) { return [3.5 + first * 0.85, 70 + second * 12]; }
  function projectActual([eruption, waiting], plot) { return [plot.x + (eruption - 1.4) / 3.9 * plot.width, plot.y + (1 - (waiting - 40) / 60) * plot.height]; }
  function inside(x, y, box) { return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height; }

  function drawGrid(context, plot, columns, rows) {
    context.strokeStyle = rgba(palette.line, 0.78); context.lineWidth = 1;
    for (let index = 0; index <= columns; index += 1) { const x = plot.x + index / columns * plot.width; context.beginPath(); context.moveTo(x, plot.y); context.lineTo(x, plot.y + plot.height); context.stroke(); }
    for (let index = 0; index <= rows; index += 1) { const y = plot.y + index / rows * plot.height; context.beginPath(); context.moveTo(plot.x, y); context.lineTo(plot.x + plot.width, y); context.stroke(); }
  }

  function fitCanvas(target) {
    const rect = target.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 60) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * ratio);
    const pixelHeight = Math.round(rect.height * ratio);
    if (target.width !== pixelWidth || target.height !== pixelHeight) { target.width = pixelWidth; target.height = pixelHeight; }
    const context = target.getContext("2d"); context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rect.width, height: rect.height };
  }

  function readPalette() {
    const styles = getComputedStyle(root);
    return {
      bg: parseColor(styles.getPropertyValue("--bg")), bgWarm: parseColor(styles.getPropertyValue("--bg-warm")),
      ink: parseColor(styles.getPropertyValue("--ink")), subtle: parseColor(styles.getPropertyValue("--subtle")),
      line: parseColor(styles.getPropertyValue("--line")), accent: parseColor(styles.getPropertyValue("--accent")),
      orange: parseColor(styles.getPropertyValue("--viz-orange")), fontBody: styles.getPropertyValue("--font-body").trim(),
    };
  }

  function parseColor(value) { const input = value.trim(); if (input.startsWith("#")) { const hex = input.slice(1); return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)]; } const match = input.match(/[\d.]+/g); return match.slice(0,3).map(Number); }
  function color(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }
  function rgba(rgb, alpha) { return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`; }
  function blend(first, second, amount) { return first.map((value, index) => Math.round(value + (second[index] - value) * amount)); }
  function add(first, second) { return [first[0] + second[0], first[1] + second[1]]; }
  function sub(first, second) { return [first[0] - second[0], first[1] - second[1]]; }
  function scale(vector, scalar) { return [vector[0] * scalar, vector[1] * scalar]; }
  function squaredDistance(first, second) { return (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2; }
  function clip(vector, maximum) { const length = Math.hypot(...vector); return length > maximum ? scale(vector, maximum / length) : vector; }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function randomSource(seed) { let state = seed >>> 0; return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }

  window.__steinDensity = {
    getState: () => ({
      step, running, bandwidthName, queryDuration, observations: observations.length,
      particleCount: particles.length, finite: particles.every((point) => point.every(Number.isFinite)),
      meanLogDensity: particles.length ? particles.reduce((sum, point) => sum + kdeValue(point).logDensity, 0) / particles.length : null,
      conditional: { median: conditional.median, low: conditional.low, high: conditional.high },
    }),
  };
}());
