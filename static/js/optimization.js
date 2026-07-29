/* ───────────────────────────────────────────────────────────
   A shared stochastic valley, viewed through five optimizers.

   Every method starts at the same point and receives the same fixed
   mini-batch noise. The visualization separates the raw gradient,
   actual update, diagonal scaling, and matrix
   preconditioning so the algebra has a direct visual counterpart.
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const demo = document.querySelector("[data-optimizer-demo]");
  if (!demo) return;
  const landscape = window.OptimizationLandscape;
  if (!landscape) return;

  const canvas = demo.querySelector("[data-optimizer-canvas]");
  const tabs = Array.from(demo.querySelectorAll("[data-optimizer]"));
  const panels = Array.from(demo.querySelectorAll("[data-optimizer-panel]"));
  const playButton = demo.querySelector("[data-optimizer-play]");
  const playLabel = demo.querySelector("[data-optimizer-play-label]");
  const restartButton = demo.querySelector("[data-optimizer-restart]");
  const compareButton = demo.querySelector("[data-optimizer-compare]");
  const stepLabel = demo.querySelector("[data-optimizer-step]");
  const lossLabel = demo.querySelector("[data-optimizer-loss]");
  const gradientNormLabel = demo.querySelector("[data-gradient-norm]");
  const updateNormLabel = demo.querySelector("[data-update-norm]");
  const gradientMeter = demo.querySelector("[data-gradient-meter]");
  const updateMeter = demo.querySelector("[data-update-meter]");
  if (!canvas || tabs.length === 0) return;

  const METHODS = ["sgd", "momentum", "adam", "shampoo"];
  const METHOD_LABELS = {
    sgd: "SGD",
    momentum: "Momentum",
    adam: "Adam",
    shampoo: "Shampoo",
  };
  const TOTAL_STEPS = 180;
  const STEP_DURATION = 74;
  const X_RANGE = [-2.05, 2.15];
  const Y_RANGE = [-0.95, 2.05];
  const DEFAULT_START = [-1.55, 1.47];
  const OPTIMUM = [1, 1 / 3];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let activeMethod = "sgd";
  let startPoint = DEFAULT_START.slice();
  let runs = buildRuns(startPoint);
  let playing = !reducedMotion;
  let compareAll = false;
  let progress = reducedMotion ? TOTAL_STEPS : 0;
  let previousTime = null;
  let animationFrame = null;
  let palette = readPalette();
  let background = null;
  let backgroundKey = "";
  const contourSegments = landscape.buildContours({
    levels: [0.12, 0.3, 0.65, 1.2, 2.2, 4, 7, 12, 20],
    xRange: X_RANGE,
    yRange: Y_RANGE,
    columns: 76,
    rows: 58,
  });

  bindControls();
  setPlaying(playing);
  updateSelection();
  requestDraw();

  const resizeObserver = new ResizeObserver(() => {
    backgroundKey = "";
    requestDraw();
  });
  resizeObserver.observe(canvas);

  window.addEventListener("themechange", () => {
    palette = readPalette();
    backgroundKey = "";
    requestDraw();
  });

  document.addEventListener("visibilitychange", () => {
    previousTime = null;
    if (document.hidden && animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    } else if (!document.hidden) {
      requestDraw();
    }
  });

  window.__optimizerVisualization = {
    getState: () => ({
      activeMethod,
      playing,
      compareAll,
      progress,
      totalSteps: TOTAL_STEPS,
      startPoint: startPoint.slice(),
      finalLosses: Object.fromEntries(
        METHODS.map((method) => [method, runs[method].at(-1).loss]),
      ),
      methods: METHODS.slice(),
    }),
  };

  function bindControls() {
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectMethod(tab.dataset.optimizer));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        tabs[nextIndex].focus();
        selectMethod(tabs[nextIndex].dataset.optimizer);
      });
    });

    playButton.addEventListener("click", () => {
      if (progress >= TOTAL_STEPS) progress = 0;
      setPlaying(!playing);
      requestDraw();
    });

    restartButton.addEventListener("click", () => {
      progress = 0;
      setPlaying(!reducedMotion || playing);
      requestDraw();
    });

    compareButton.addEventListener("click", () => {
      compareAll = !compareAll;
      compareButton.classList.toggle("is-active", compareAll);
      compareButton.setAttribute("aria-pressed", String(compareAll));
      requestDraw();
    });

    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const layout = plotLayout(rect.width, rect.height);
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      if (
        localX < layout.left || localX > layout.left + layout.width
        || localY < layout.top || localY > layout.top + layout.height
      ) return;
      startPoint = [
        unscale(localX, layout.left, layout.width, X_RANGE),
        unscale(layout.top + layout.height - localY, 0, layout.height, Y_RANGE),
      ];
      runs = buildRuns(startPoint);
      progress = 0;
      setPlaying(!reducedMotion || playing);
      requestDraw();
    });
  }

  function selectMethod(method) {
    if (!METHODS.includes(method) || method === activeMethod) return;
    activeMethod = method;
    progress = 0;
    setPlaying(!reducedMotion || playing);
    updateSelection();
    requestDraw();
  }

  function updateSelection() {
    tabs.forEach((tab) => {
      const selected = tab.dataset.optimizer === activeMethod;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      const selected = panel.dataset.optimizerPanel === activeMethod;
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    });
  }

  function setPlaying(nextPlaying) {
    playing = nextPlaying;
    demo.classList.toggle("is-paused", !playing);
    playLabel.textContent = playing ? "Pause" : (progress >= TOTAL_STEPS ? "Replay" : "Play");
    playButton.setAttribute("aria-label", playing ? "Pause optimization" : "Play optimization");
    playButton.setAttribute("aria-pressed", String(!playing));
    previousTime = null;
  }

  function requestDraw() {
    if (animationFrame === null && !document.hidden) {
      animationFrame = requestAnimationFrame(frame);
    }
  }

  function frame(time) {
    animationFrame = null;
    if (previousTime === null) previousTime = time;
    const delta = Math.min(50, time - previousTime);
    previousTime = time;

    if (playing) {
      progress = Math.min(TOTAL_STEPS, progress + delta / STEP_DURATION);
      if (progress >= TOTAL_STEPS) setPlaying(false);
    }

    draw();
    updateReadout();
    if (playing) requestDraw();
  }

  function buildRuns(start) {
    const noises = buildNoise(TOTAL_STEPS);
    return Object.fromEntries(METHODS.map((method) => [method, simulate(method, start, noises)]));
  }

  function simulate(method, start, noises) {
    const run = [];
    let position = start.slice();
    let moment = [0, 0];
    let secondMoment = [0, 0];
    let covariance = [[0.28, 0], [0, 0.28]];
    let rightStatistic = 0.28;

    for (let step = 0; step <= TOTAL_STEPS; step += 1) {
      const trueGradient = landscape.gradient(position);
      const noisyGradient = step < TOTAL_STEPS
        ? add(trueGradient, noises[step])
        : trueGradient.slice();
      const clippedGradient = clipNorm(noisyGradient, 8.5);
      let update = [0, 0];
      let preconditioner = [[1, 0], [0, 1]];

      if (step < TOTAL_STEPS) {
        if (method === "sgd") {
          update = scale(clippedGradient, -0.047);
        } else if (method === "momentum") {
          moment = add(scale(moment, 0.88), scale(clippedGradient, 0.12));
          update = scale(moment, -0.086);
        } else if (method === "adam") {
          moment = add(scale(moment, 0.9), scale(clippedGradient, 0.1));
          secondMoment = [
            0.985 * secondMoment[0] + 0.015 * clippedGradient[0] ** 2,
            0.985 * secondMoment[1] + 0.015 * clippedGradient[1] ** 2,
          ];
          const biasOne = 1 - 0.9 ** (step + 1);
          const biasTwo = 1 - 0.985 ** (step + 1);
          const correctedMoment = scale(moment, 1 / biasOne);
          const correctedSecond = scale(secondMoment, 1 / biasTwo);
          preconditioner = [
            [1 / (Math.sqrt(correctedSecond[0]) + 0.08), 0],
            [0, 1 / (Math.sqrt(correctedSecond[1]) + 0.08)],
          ];
          update = scale(matrixVector(preconditioner, correctedMoment), -0.072);
        } else if (method === "shampoo") {
          const outerGradient = outer(clippedGradient, clippedGradient);
          covariance = addMatrix(covariance, outerGradient);
          rightStatistic += clippedGradient[0] ** 2 + clippedGradient[1] ** 2;
          const leftPreconditioner = inverseFourthRoot(covariance, 0.12);
          const rightPreconditioner = (rightStatistic + 0.12) ** -0.25;
          preconditioner = scaleMatrix(leftPreconditioner, rightPreconditioner);
          update = scale(matrixVector(preconditioner, clippedGradient), -0.28);
          update = clipNorm(update, 0.16);
        }
      }

      run.push({
        position: position.slice(),
        loss: landscape.loss(position),
        gradient: clippedGradient,
        update,
        preconditioner,
      });
      position = clampPoint(add(position, update));
    }
    return run;
  }

  function buildNoise(count) {
    const random = createRandomSource(20260728);
    let spare = null;
    const normal = () => {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      let first = 0;
      let second = 0;
      while (first === 0) first = random();
      while (second === 0) second = random();
      const radius = Math.sqrt(-2 * Math.log(first));
      spare = radius * Math.sin(2 * Math.PI * second);
      return radius * Math.cos(2 * Math.PI * second);
    };
    return Array.from({ length: count }, (_, step) => [
      0.2 * normal() + 0.08 * Math.sin(step * 0.47),
      0.2 * normal() + 0.08 * Math.cos(step * 0.39),
    ]);
  }

  function createRandomSource(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function draw() {
    const surface = fitCanvas(canvas);
    if (!surface) return;
    const { context, width, height } = surface;
    const layout = plotLayout(width, height);
    ensureBackground(width, height, layout);
    context.clearRect(0, 0, width, height);
    context.drawImage(background, 0, 0, width, height);
    drawGrid(context, layout);
    drawContours(context, layout);
    drawOptimum(context, layout);

    if (compareAll) {
      METHODS.forEach((method) => drawComparisonPath(context, layout, method));
    }
    drawSelectedPath(context, layout);
    drawCurrentGeometry(context, layout);
    drawStartPoint(context, layout);
  }

  function plotLayout(width, height) {
    const compact = width < 560;
    const left = compact ? 42 : 54;
    const right = compact ? 20 : 30;
    const top = compact ? 19 : 24;
    const bottom = compact ? 39 : 46;
    return { left, top, width: width - left - right, height: height - top - bottom, compact };
  }

  function ensureBackground(width, height, layout) {
    const key = `${Math.round(width)}:${Math.round(height)}:${palette.bg.join(",")}`;
    if (background && key === backgroundKey) return;
    backgroundKey = key;
    background = document.createElement("canvas");
    background.width = Math.max(1, Math.round(width));
    background.height = Math.max(1, Math.round(height));
    const context = background.getContext("2d");
    context.fillStyle = color(palette.bg);
    context.fillRect(0, 0, width, height);

    const columns = Math.max(80, Math.round(layout.width / 5));
    const rows = Math.max(60, Math.round(layout.height / 5));
    const cellWidth = layout.width / columns;
    const cellHeight = layout.height / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const point = [
          unscale(column + 0.5, 0, columns, X_RANGE),
          unscale(rows - row - 0.5, 0, rows, Y_RANGE),
        ];
        const strength = Math.min(1, Math.log1p(landscape.loss(point)) / Math.log(24));
        const fill = blendRgb(palette.bg, palette.cloud, 0.018 + 0.14 * strength);
        context.fillStyle = color(fill);
        context.fillRect(
          layout.left + column * cellWidth,
          layout.top + row * cellHeight,
          cellWidth + 1,
          cellHeight + 1,
        );
      }
    }
  }

  function drawGrid(context, layout) {
    context.save();
    context.font = `500 ${layout.compact ? 9 : 10}px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    context.lineWidth = 1;
    for (let x = -2; x <= 2; x += 1) {
      const pixelX = scaleX(x, layout);
      context.beginPath();
      context.moveTo(Math.round(pixelX) + 0.5, layout.top);
      context.lineTo(Math.round(pixelX) + 0.5, layout.top + layout.height);
      context.strokeStyle = rgba(x === 0 ? palette.ink : palette.line, x === 0 ? 0.2 : 0.62);
      context.stroke();
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(String(x), pixelX, layout.top + layout.height + 9);
    }
    for (let y = -0.5; y <= 2; y += 0.5) {
      const pixelY = scaleY(y, layout);
      context.beginPath();
      context.moveTo(layout.left, Math.round(pixelY) + 0.5);
      context.lineTo(layout.left + layout.width, Math.round(pixelY) + 0.5);
      context.strokeStyle = rgba(Math.abs(y) < 1e-6 ? palette.ink : palette.line, Math.abs(y) < 1e-6 ? 0.2 : 0.62);
      context.stroke();
      if (Number.isInteger(y)) {
        context.textAlign = "right";
        context.textBaseline = "middle";
        context.fillText(String(y), layout.left - 9, pixelY);
      }
    }
    context.restore();
  }

  function drawContours(context, layout) {
    context.save();
    context.beginPath();
    context.rect(layout.left, layout.top, layout.width, layout.height);
    context.clip();
    contourSegments.forEach(({ level, columns, rows, segments }) => {
      context.beginPath();
      segments.forEach(([first, second]) => {
        context.moveTo(
          layout.left + (first[0] / columns) * layout.width,
          layout.top + layout.height - (first[1] / rows) * layout.height,
        );
        context.lineTo(
          layout.left + (second[0] / columns) * layout.width,
          layout.top + layout.height - (second[1] / rows) * layout.height,
        );
      });
      context.strokeStyle = rgba(palette.cloud, level < 1 ? 0.4 : 0.24);
      context.lineWidth = level < 1 ? 1.15 : 0.8;
      context.stroke();
    });
    context.restore();
  }

  function drawSelectedPath(context, layout) {
    const run = runs[activeMethod];
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    if (end < 1) return;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let index = 1; index <= end; index += 1) {
      const opacity = 0.14 + 0.84 * (index / Math.max(1, end));
      context.beginPath();
      context.moveTo(scaleX(run[index - 1].position[0], layout), scaleY(run[index - 1].position[1], layout));
      context.lineTo(scaleX(run[index].position[0], layout), scaleY(run[index].position[1], layout));
      context.strokeStyle = rgba(palette.accent, opacity);
      context.lineWidth = layout.compact ? 1.8 : 2.25;
      context.stroke();
    }
    context.restore();
  }

  function drawComparisonPath(context, layout, method) {
    if (method === activeMethod) return;
    const methodIndex = METHODS.indexOf(method);
    const comparisonColors = [palette.muted, palette.orange, palette.cloud, palette.ink];
    const run = runs[method];
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    context.save();
    context.beginPath();
    for (let index = 0; index <= end; index += 1) {
      const x = scaleX(run[index].position[0], layout);
      const y = scaleY(run[index].position[1], layout);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.setLineDash([3 + methodIndex, 4]);
    context.strokeStyle = rgba(comparisonColors[methodIndex], 0.48);
    context.lineWidth = 1.25;
    context.stroke();
    if (end > 3) {
      const endpoint = run[end].position;
      context.font = `600 ${layout.compact ? 8 : 9}px ${palette.fontBody}`;
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.fillStyle = rgba(comparisonColors[methodIndex], 0.76);
      context.fillText(
        METHOD_LABELS[method],
        scaleX(endpoint[0], layout) + 5,
        scaleY(endpoint[1], layout) - 4,
      );
    }
    context.restore();
  }

  function drawCurrentGeometry(context, layout) {
    const run = runs[activeMethod];
    const index = Math.min(TOTAL_STEPS, Math.floor(progress));
    const amount = Math.min(1, progress - index);
    const state = run[index];
    const nextState = run[Math.min(TOTAL_STEPS, index + 1)];
    const position = mixVector(state.position, nextState.position, smoothStep(amount));
    const pixel = [scaleX(position[0], layout), scaleY(position[1], layout)];

    if (["adam", "shampoo"].includes(activeMethod)) {
      drawPreconditioner(context, pixel, state.preconditioner, activeMethod === "shampoo");
    }

    const gradientDirection = scaleToLength(state.gradient, layout.compact ? 29 : 36);
    drawArrow(context, pixel, [pixel[0] + gradientDirection[0], pixel[1] - gradientDirection[1]], palette.orange, 0.82, false);

    const updateDirection = scaleToLength([
      state.update[0] / (X_RANGE[1] - X_RANGE[0]) * layout.width,
      -state.update[1] / (Y_RANGE[1] - Y_RANGE[0]) * layout.height,
    ], layout.compact ? 32 : 42);
    drawArrow(context, pixel, add(pixel, updateDirection), palette.accent, 1, false);

    context.beginPath();
    context.arc(pixel[0], pixel[1], layout.compact ? 4.2 : 5, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = color(palette.accent);
    context.stroke();
  }

  function drawPreconditioner(context, center, matrix, tilted) {
    const eigensystem = symmetricEigen(matrix);
    const largest = Math.max(eigensystem.values[0], eigensystem.values[1], 1e-8);
    const firstRadius = 30 * Math.max(0.22, eigensystem.values[0] / largest);
    const secondRadius = 30 * Math.max(0.22, eigensystem.values[1] / largest);
    const angle = tilted ? Math.atan2(eigensystem.vector[1], eigensystem.vector[0]) : 0;
    context.save();
    context.translate(center[0], center[1]);
    context.rotate(-angle);
    context.beginPath();
    context.ellipse(0, 0, firstRadius, secondRadius, 0, 0, Math.PI * 2);
    context.fillStyle = rgba(palette.orange, 0.055);
    context.fill();
    context.strokeStyle = rgba(palette.orange, 0.58);
    context.lineWidth = 1.2;
    context.stroke();
    context.restore();
  }

  function drawArrow(context, start, end, arrowColor, opacity, dashed) {
    const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
    const head = 6;
    context.save();
    if (dashed) context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(start[0], start[1]);
    context.lineTo(end[0], end[1]);
    context.strokeStyle = rgba(arrowColor, opacity);
    context.lineWidth = 1.5;
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(end[0], end[1]);
    context.lineTo(end[0] - head * Math.cos(angle - 0.55), end[1] - head * Math.sin(angle - 0.55));
    context.lineTo(end[0] - head * Math.cos(angle + 0.55), end[1] - head * Math.sin(angle + 0.55));
    context.closePath();
    context.fillStyle = rgba(arrowColor, opacity);
    context.fill();
    context.restore();
  }

  function drawOptimum(context, layout) {
    const x = scaleX(OPTIMUM[0], layout);
    const y = scaleY(OPTIMUM[1], layout);
    context.beginPath();
    context.arc(x, y, 5, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(palette.ink);
    context.lineWidth = 1.5;
    context.stroke();
    context.font = `500 ${layout.compact ? 9 : 10}px ${palette.fontBody}`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = color(palette.muted);
    context.fillText("minimum", x + 9, y);
  }

  function drawStartPoint(context, layout) {
    const x = scaleX(startPoint[0], layout);
    const y = scaleY(startPoint[1], layout);
    context.beginPath();
    context.arc(x, y, 3, 0, Math.PI * 2);
    context.fillStyle = color(palette.subtle);
    context.fill();
    context.font = `500 ${layout.compact ? 8 : 9}px ${palette.fontBody}`;
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.fillStyle = color(palette.subtle);
    context.fillText("start · click to move", x + 7, y - 5);
  }

  function updateReadout() {
    const index = Math.min(TOTAL_STEPS, Math.floor(progress));
    const state = runs[activeMethod][index];
    const gradientNorm = norm(state.gradient);
    const updateNorm = norm(state.update);
    stepLabel.textContent = `step ${index} / ${TOTAL_STEPS}`;
    lossLabel.textContent = `loss ${formatValue(state.loss)}`;
    gradientNormLabel.textContent = formatValue(gradientNorm);
    updateNormLabel.textContent = formatValue(updateNorm);
    gradientMeter.style.width = `${Math.min(100, gradientNorm / 8.5 * 100)}%`;
    updateMeter.style.width = `${Math.min(100, updateNorm / 0.18 * 100)}%`;
  }

  function fitCanvas(target) {
    const rect = target.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * ratio);
    const pixelHeight = Math.round(rect.height * ratio);
    if (target.width !== pixelWidth || target.height !== pixelHeight) {
      target.width = pixelWidth;
      target.height = pixelHeight;
      backgroundKey = "";
    }
    const context = target.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rect.width, height: rect.height };
  }

  function scaleX(value, layout) {
    return layout.left + ((value - X_RANGE[0]) / (X_RANGE[1] - X_RANGE[0])) * layout.width;
  }

  function scaleY(value, layout) {
    return layout.top + (1 - (value - Y_RANGE[0]) / (Y_RANGE[1] - Y_RANGE[0])) * layout.height;
  }

  function unscale(value, offset, extent, range) {
    return range[0] + ((value - offset) / extent) * (range[1] - range[0]);
  }

  function clampPoint(point) {
    return [
      Math.max(X_RANGE[0] + 0.02, Math.min(X_RANGE[1] - 0.02, point[0])),
      Math.max(Y_RANGE[0] + 0.02, Math.min(Y_RANGE[1] - 0.02, point[1])),
    ];
  }

  function add(first, second) { return [first[0] + second[0], first[1] + second[1]]; }
  function scale(vector, amount) { return [vector[0] * amount, vector[1] * amount]; }
  function norm(vector) { return Math.hypot(vector[0], vector[1]); }
  function clipNorm(vector, maximum) {
    const length = norm(vector);
    return length > maximum ? scale(vector, maximum / length) : vector.slice();
  }
  function scaleToLength(vector, length) {
    const currentLength = norm(vector);
    return currentLength < 1e-9 ? [0, 0] : scale(vector, length / currentLength);
  }
  function mixVector(first, second, amount) {
    return [first[0] + (second[0] - first[0]) * amount, first[1] + (second[1] - first[1]) * amount];
  }
  function smoothStep(value) { return value * value * (3 - 2 * value); }
  function outer(vector, other) {
    return [
      [vector[0] * other[0], vector[0] * other[1]],
      [vector[1] * other[0], vector[1] * other[1]],
    ];
  }
  function addMatrix(first, second) {
    return [
      [first[0][0] + second[0][0], first[0][1] + second[0][1]],
      [first[1][0] + second[1][0], first[1][1] + second[1][1]],
    ];
  }
  function scaleMatrix(matrix, amount) {
    return [
      [matrix[0][0] * amount, matrix[0][1] * amount],
      [matrix[1][0] * amount, matrix[1][1] * amount],
    ];
  }
  function matrixVector(matrix, vector) {
    return [
      matrix[0][0] * vector[0] + matrix[0][1] * vector[1],
      matrix[1][0] * vector[0] + matrix[1][1] * vector[1],
    ];
  }

  function symmetricEigen(matrix) {
    const a = matrix[0][0];
    const b = (matrix[0][1] + matrix[1][0]) / 2;
    const d = matrix[1][1];
    const root = Math.sqrt(((a - d) / 2) ** 2 + b ** 2);
    const values = [(a + d) / 2 + root, (a + d) / 2 - root];
    let vector = Math.abs(b) > 1e-10 ? [values[0] - d, b] : (a >= d ? [1, 0] : [0, 1]);
    vector = scale(vector, 1 / Math.max(norm(vector), 1e-12));
    return { values, vector };
  }

  function inverseFourthRoot(matrix, damping) {
    const eigensystem = symmetricEigen(matrix);
    const first = (Math.max(eigensystem.values[0], 0) + damping) ** -0.25;
    const second = (Math.max(eigensystem.values[1], 0) + damping) ** -0.25;
    const [vx, vy] = eigensystem.vector;
    const ux = -vy;
    const uy = vx;
    return [
      [first * vx * vx + second * ux * ux, first * vx * vy + second * ux * uy],
      [first * vy * vx + second * uy * ux, first * vy * vy + second * uy * uy],
    ];
  }

  function formatValue(value) {
    if (value >= 10) return value.toFixed(1);
    if (value >= 1) return value.toFixed(2);
    if (value >= 0.01) return value.toFixed(3);
    return value.toExponential(1);
  }

  function readPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: parseColor(styles.getPropertyValue("--bg")),
      ink: parseColor(styles.getPropertyValue("--ink")),
      muted: parseColor(styles.getPropertyValue("--muted")),
      subtle: parseColor(styles.getPropertyValue("--subtle")),
      line: parseColor(styles.getPropertyValue("--line")),
      accent: parseColor(styles.getPropertyValue("--accent")),
      orange: parseColor(styles.getPropertyValue("--viz-orange")),
      cloud: parseColor(styles.getPropertyValue("--viz-cloud")),
      fontBody: styles.getPropertyValue("--font-body").trim(),
    };
  }

  function parseColor(value) {
    const colorValue = value.trim();
    if (colorValue.startsWith("#")) {
      const hex = colorValue.slice(1);
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
    const match = colorValue.match(/[\d.]+/g);
    if (!match) throw new Error(`Unable to parse theme color: ${colorValue}`);
    return match.slice(0, 3).map(Number);
  }

  function blendRgb(first, second, amount) {
    return first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount));
  }
  function color(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }
  function rgba(rgb, alpha) { return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`; }
}());
