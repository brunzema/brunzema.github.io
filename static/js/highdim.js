/* ───────────────────────────────────────────────────────────
   Linked views of a 24-dimensional tensor optimization problem.

   A 6×4 parameter matrix is optimized under a correlated quadratic
   loss. The large view uses PCA in the loss geometry; the heatmaps
   retain the structure its 2-D view hides.
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const demo = document.querySelector("[data-highdim-demo]");
  if (!demo) return;

  const canvas = demo.querySelector("[data-highdim-canvas]");
  const modeButtons = Array.from(demo.querySelectorAll("[data-highdim-mode]"));
  const playButton = demo.querySelector("[data-highdim-play]");
  const playLabel = demo.querySelector("[data-highdim-play-label]");
  const restartButton = demo.querySelector("[data-highdim-restart]");
  const stepLabel = demo.querySelector("[data-highdim-step]");
  const lossLabel = demo.querySelector("[data-highdim-loss]");
  const scoreElements = {
    adam: {
      loss: demo.querySelector("[data-highdim-adam-loss]"),
      bar: demo.querySelector("[data-highdim-adam-bar]"),
    },
    shampoo: {
      loss: demo.querySelector("[data-highdim-shampoo-loss]"),
      bar: demo.querySelector("[data-highdim-shampoo-bar]"),
    },
  };
  if (!canvas || modeButtons.length === 0) return;

  const ROWS = 6;
  const COLUMNS = 4;
  const DIMENSIONS = ROWS * COLUMNS;
  const TOTAL_STEPS = 140;
  const STEP_DURATION = 82;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const problem = createProblem();
  const initialParameterMaximum = Math.max(...problem.start.flat().map(Math.abs));
  const runs = {
    adam: simulateAdam(problem),
    shampoo: simulateShampoo(problem),
  };
  const lossProjection = buildOriginCenteredLossProjection(problem, runs);

  let mode = "both";
  let playing = !reducedMotion;
  let progress = reducedMotion ? TOTAL_STEPS : 0;
  let previousTime = null;
  let animationFrame = null;
  let palette = readPalette();

  bindControls();
  setPlaying(playing);
  updateModeControls();
  requestDraw();

  const resizeObserver = new ResizeObserver(requestDraw);
  resizeObserver.observe(canvas);

  window.addEventListener("themechange", () => {
    palette = readPalette();
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

  window.__highdimVisualization = {
    getState: () => {
      const checkpoints = [0, 10, 25, 50, 100, TOTAL_STEPS];
      return {
        dimensions: DIMENSIONS,
        shape: [ROWS, COLUMNS],
        mode,
        playing,
        progress,
        totalSteps: TOTAL_STEPS,
        finalLosses: {
          adam: runs.adam.at(-1).loss,
          shampoo: runs.shampoo.at(-1).loss,
        },
        retainedLossEnergy: lossProjection.retainedEnergyByAxis.slice(),
        lossCheckpoints: Object.fromEntries(
          ["adam", "shampoo"].map((method) => [
            method,
            checkpoints.map((step) => [step, runs[method][step].loss]),
          ]),
        ),
        parameterNorms: Object.fromEntries(
          ["adam", "shampoo"].map((method) => [
            method,
            {
              initial: Math.sqrt(frobeniusSquared(runs[method][0].weights)),
              final: Math.sqrt(frobeniusSquared(runs[method].at(-1).weights)),
            },
          ]),
        ),
      };
    },
  };

  function bindControls() {
    modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        mode = button.dataset.highdimMode;
        updateModeControls();
        requestDraw();
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
  }

  function updateModeControls() {
    modeButtons.forEach((button) => {
      const active = button.dataset.highdimMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setPlaying(nextPlaying) {
    playing = nextPlaying;
    demo.classList.toggle("is-paused", !playing);
    playLabel.textContent = playing ? "Pause" : (progress >= TOTAL_STEPS ? "Replay" : "Play");
    playButton.setAttribute("aria-label", playing ? "Pause high-dimensional optimization" : "Play high-dimensional optimization");
    previousTime = null;
  }

  function requestDraw() {
    if (animationFrame === null && !document.hidden) animationFrame = requestAnimationFrame(frame);
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

  function createProblem() {
    const left = rotatedPositiveDefinite(
      [0.34, 0.52, 0.78, 1.16, 1.72, 2.55],
      [[0, 4, 0.66], [1, 5, -0.48], [2, 4, 0.55], [0, 3, -0.35], [1, 2, 0.43]],
    );
    const right = rotatedPositiveDefinite(
      [0.48, 0.76, 1.22, 1.92],
      [[0, 3, -0.58], [1, 2, 0.51], [0, 2, 0.31]],
    );
    const random = createRandomSource(240628);
    const start = matrix(ROWS, COLUMNS, (row, column) => (
      (random() * 2 - 1) * 0.75 + 0.22 * Math.sin((row + 1) * (column + 1))
    ));
    const noises = Array.from({ length: TOTAL_STEPS }, (_, step) => (
      matrix(ROWS, COLUMNS, (row, column) => (
        0.018 * (random() * 2 - 1)
        + 0.009 * Math.sin(step * 0.37 + row * 0.8 - column * 0.55)
      ))
    ));
    return { left, right, start, noises };
  }

  function objective(problemState, weights) {
    const transformed = multiply(multiply(problemState.left, weights), problemState.right);
    return 0.5 * frobeniusSquared(transformed);
  }

  function objectiveGradient(problemState, weights) {
    return multiply(
      multiply(multiply(problemState.left, problemState.left), weights),
      multiply(problemState.right, problemState.right),
    );
  }

  function simulateAdam(problemState) {
    let weights = copyMatrix(problemState.start);
    let moment = zeroMatrix(ROWS, COLUMNS);
    let secondMoment = zeroMatrix(ROWS, COLUMNS);
    const run = [];

    for (let step = 0; step <= TOTAL_STEPS; step += 1) {
      const gradient = addMatrix(objectiveGradient(problemState, weights), problemState.noises[Math.min(step, TOTAL_STEPS - 1)]);
      const secondMomentCorrection = step === 0 ? 1 : 1 - 0.98 ** step;
      run.push({
        weights: copyMatrix(weights),
        loss: objective(problemState, weights),
        geometry: matrix(ROWS, COLUMNS, (row, column) => (
          1 / (Math.sqrt(secondMoment[row][column] / secondMomentCorrection) + 0.045)
        )),
      });
      if (step === TOTAL_STEPS) break;

      moment = combineMatrices(moment, gradient, 0.9, 0.1);
      secondMoment = matrix(ROWS, COLUMNS, (row, column) => (
        0.98 * secondMoment[row][column] + 0.02 * gradient[row][column] ** 2
      ));
      const biasOne = 1 - 0.9 ** (step + 1);
      const biasTwo = 1 - 0.98 ** (step + 1);
      const update = matrix(ROWS, COLUMNS, (row, column) => (
        -0.061 * (moment[row][column] / biasOne)
        / (Math.sqrt(secondMoment[row][column] / biasTwo) + 0.045)
      ));
      weights = addMatrix(weights, update);
    }
    return run;
  }

  function simulateShampoo(problemState) {
    let weights = copyMatrix(problemState.start);
    let leftStatistic = scaleMatrix(identity(ROWS), 0.18);
    let rightStatistic = scaleMatrix(identity(COLUMNS), 0.18);
    const run = [];

    for (let step = 0; step <= TOTAL_STEPS; step += 1) {
      const gradient = addMatrix(objectiveGradient(problemState, weights), problemState.noises[Math.min(step, TOTAL_STEPS - 1)]);
      run.push({
        weights: copyMatrix(weights),
        loss: objective(problemState, weights),
        leftStatistic: correlationMatrix(leftStatistic),
        rightStatistic: correlationMatrix(rightStatistic),
      });
      if (step === TOTAL_STEPS) break;

      leftStatistic = addMatrix(leftStatistic, multiply(gradient, transpose(gradient)));
      rightStatistic = addMatrix(rightStatistic, multiply(transpose(gradient), gradient));
      const leftPreconditioner = inverseFourthRoot(leftStatistic, 0.12);
      const rightPreconditioner = inverseFourthRoot(rightStatistic, 0.12);
      let update = scaleMatrix(multiply(multiply(leftPreconditioner, gradient), rightPreconditioner), -0.34);
      const updateNorm = Math.sqrt(frobeniusSquared(update));
      if (updateNorm > 0.38) update = scaleMatrix(update, 0.38 / updateNorm);
      weights = addMatrix(weights, update);
    }
    return run;
  }

  function buildOriginCenteredLossProjection(problemState, allRuns) {
    const transformedRuns = Object.fromEntries(
      ["adam", "shampoo"].map((method) => [
        method,
        allRuns[method].map((state) => multiply(multiply(problemState.left, state.weights), problemState.right).flat()),
      ]),
    );
    const samples = Object.values(transformedRuns).flat();
    const secondMoment = matrix(DIMENSIONS, DIMENSIONS, (row, column) => (
      samples.reduce((sum, sample) => sum + sample[row] * sample[column], 0) / samples.length
    ));
    const decomposition = jacobiEigen(secondMoment);
    const order = decomposition.values
      .map((value, index) => ({ value: Math.max(0, value), index }))
      .sort((first, second) => second.value - first.value);
    const axes = order.slice(0, 2).map(({ index }) => decomposition.vectors.map((row) => row[index]));
    const totalEnergy = order.reduce((sum, component) => sum + component.value, 0);
    const retainedEnergyByAxis = order.slice(0, 2).map(({ value }) => value / Math.max(totalEnergy, 1e-12));

    const points = {};
    const allPoints = [];
    ["adam", "shampoo"].forEach((method) => {
      points[method] = transformedRuns[method].map((sample) => {
        const point = [dot(sample, axes[0]), dot(sample, axes[1])];
        allPoints.push(point);
        return point;
      });
    });
    const xValues = allPoints.map((point) => point[0]);
    const yValues = allPoints.map((point) => point[1]);
    const xRange = paddedRange(Math.min(...xValues, 0), Math.max(...xValues, 0));
    const yRange = paddedRange(Math.min(...yValues, 0), Math.max(...yValues, 0));
    return { points, xRange, yRange, retainedEnergyByAxis };
  }

  function draw() {
    const surface = fitCanvas(canvas);
    if (!surface) return;
    const { context, width, height } = surface;
    const layout = buildLayout(width, height);
    context.clearRect(0, 0, width, height);

    drawTrajectoryPca(context, layout.projection);
    drawLossChart(context, layout.loss);
    drawParameters(context, layout.parameters);
    drawGeometry(context, layout.geometry);
  }

  function buildLayout(width, height) {
    const gap = width < 680 ? 18 : 22;
    const inset = width < 680 ? 0 : 2;
    if (width < 680) {
      const usable = height - gap * 3;
      return {
        projection: { x: inset, y: 0, width: width - inset * 2, height: usable * 0.36 },
        loss: { x: inset, y: usable * 0.36 + gap, width: width - inset * 2, height: usable * 0.19 },
        parameters: { x: inset, y: usable * 0.55 + gap * 2, width: width - inset * 2, height: usable * 0.2 },
        geometry: { x: inset, y: usable * 0.75 + gap * 3, width: width - inset * 2, height: usable * 0.25 },
      };
    }
    const leftWidth = width * 0.62;
    const rightX = leftWidth + gap;
    const rightWidth = width - rightX;
    const topHeight = height * 0.63;
    return {
      projection: { x: inset, y: 0, width: leftWidth - inset, height: topHeight },
      loss: { x: inset, y: topHeight + gap, width: leftWidth - inset, height: height - topHeight - gap },
      parameters: { x: rightX, y: 0, width: rightWidth, height: height * 0.39 },
      geometry: { x: rightX, y: height * 0.39 + gap, width: rightWidth, height: height * 0.61 - gap },
    };
  }

  function drawTrajectoryPca(context, panel) {
    const retainedEnergy = lossProjection.retainedEnergyByAxis.reduce((sum, value) => sum + value, 0);
    drawPanel(context, panel, "24-D trajectory · loss-space PCA", `${Math.round(retainedEnergy * 100)}% energy captured`);
    const compact = panel.width < 500;
    const plot = innerPlot(panel, { top: compact ? 57 : 40, right: 18, bottom: 24, left: 18 });
    const view = equalScaleRanges(plot, lossProjection.xRange, lossProjection.yRange);
    const methods = visibleMethods();
    context.save();
    context.beginPath();
    context.rect(plot.x, plot.y, plot.width, plot.height);
    context.clip();
    drawPcaGrid(context, plot, view);
    methods.forEach((method) => drawProjectedRun(context, plot, view, method, methodColor(method)));
    drawPcaStart(context, plot, view);
    context.restore();

    const legend = methods.map((method) => [method === "adam" ? "Adam" : "Shampoo", methodColor(method)]);
    drawInlineLegend(context, panel.x + 14, panel.y + (compact ? 45 : 29), legend);
  }

  function drawPcaGrid(context, plot, view) {
    context.lineWidth = 1;
    context.strokeStyle = rgba(palette.line, 0.7);
    for (let fraction = 0.2; fraction < 1; fraction += 0.2) {
      const x = plot.x + plot.width * fraction;
      const y = plot.y + plot.height * fraction;
      context.beginPath();
      context.moveTo(x, plot.y);
      context.lineTo(x, plot.y + plot.height);
      context.moveTo(plot.x, y);
      context.lineTo(plot.x + plot.width, y);
      context.stroke();
    }
    const originX = mapRange(0, view.x, [plot.x, plot.x + plot.width]);
    const originY = mapRange(0, view.y, [plot.y + plot.height, plot.y]);
    context.beginPath();
    context.arc(originX, originY, 6, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(palette.ink);
    context.lineWidth = 1.4;
    context.stroke();
    context.font = `500 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    const labelToLeft = plot.width < 500 && originX > plot.x + plot.width * 0.62;
    context.textAlign = labelToLeft ? "right" : "left";
    context.textBaseline = "middle";
    context.fillText("optimum", originX + (labelToLeft ? -9 : 9), originY);
  }

  function drawProjectedRun(context, plot, view, method, lineColor) {
    const points = lossProjection.points[method];
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    for (let index = 1; index <= end; index += 1) {
      const previousX = mapRange(points[index - 1][0], view.x, [plot.x, plot.x + plot.width]);
      const previousY = mapRange(points[index - 1][1], view.y, [plot.y + plot.height, plot.y]);
      const x = mapRange(points[index][0], view.x, [plot.x, plot.x + plot.width]);
      const y = mapRange(points[index][1], view.y, [plot.y + plot.height, plot.y]);
      context.beginPath();
      context.moveTo(previousX, previousY);
      context.lineTo(x, y);
      context.strokeStyle = rgba(lineColor, 0.16 + 0.78 * (index / Math.max(1, end)));
      context.lineWidth = 2;
      context.lineCap = "round";
      context.stroke();

      if (index % 20 === 0 && index < end) {
        context.beginPath();
        context.arc(x, y, 1.8, 0, Math.PI * 2);
        context.fillStyle = rgba(lineColor, 0.68);
        context.fill();
      }
    }

    const current = points[end];
    const x = mapRange(current[0], view.x, [plot.x, plot.x + plot.width]);
    const y = mapRange(current[1], view.y, [plot.y + plot.height, plot.y]);
    context.beginPath();
    context.arc(x, y, 4.5, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(lineColor);
    context.lineWidth = 2;
    context.stroke();

    if (end > 0) {
      const previous = points[end - 1];
      const previousX = mapRange(previous[0], view.x, [plot.x, plot.x + plot.width]);
      const previousY = mapRange(previous[1], view.y, [plot.y + plot.height, plot.y]);
      drawDirectionHead(context, previousX, previousY, x, y, lineColor);
    }

    context.font = `600 9px ${palette.fontBody}`;
    context.fillStyle = color(lineColor);
    const labelToLeft = plot.width < 500 && x > plot.x + plot.width * 0.62;
    context.textAlign = labelToLeft ? "right" : "left";
    const labelBelow = mode === "both" && method === "shampoo";
    context.textBaseline = labelBelow ? "top" : "bottom";
    const methodLabel = method === "adam" ? "Adam" : "Shampoo";
    context.fillText(`${methodLabel} · ${formatValue(runs[method][end].loss)}`, x + (labelToLeft ? -7 : 7), y + (labelBelow ? 6 : -6));
  }

  function drawPcaStart(context, plot, view) {
    const start = lossProjection.points.adam[0];
    const x = mapRange(start[0], view.x, [plot.x, plot.x + plot.width]);
    const y = mapRange(start[1], view.y, [plot.y + plot.height, plot.y]);
    context.beginPath();
    context.arc(x, y, 3.2, 0, Math.PI * 2);
    context.fillStyle = color(palette.subtle);
    context.fill();
    context.font = `500 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText("shared start", x + 7, y + 5);
  }

  function drawDirectionHead(context, fromX, fromY, toX, toY, headColor) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const size = 5.5;
    context.beginPath();
    context.moveTo(toX, toY);
    context.lineTo(toX - size * Math.cos(angle - 0.55), toY - size * Math.sin(angle - 0.55));
    context.lineTo(toX - size * Math.cos(angle + 0.55), toY - size * Math.sin(angle + 0.55));
    context.closePath();
    context.fillStyle = color(headColor);
    context.fill();
  }

  function drawLossChart(context, panel) {
    drawPanel(context, panel, "Loss through time", "log scale");
    const plot = innerPlot(panel, { top: 34, right: 17, bottom: 20, left: 38 });
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    const methods = visibleMethods();
    const visibleLosses = methods.flatMap((method) => runs[method].slice(0, end + 1).map((state) => state.loss));
    const maximum = Math.log10(Math.max(runs.adam[0].loss, runs.shampoo[0].loss));
    const currentMinimum = Math.log10(Math.max(1e-8, Math.min(...visibleLosses)));
    const minimum = Math.min(maximum - 1, currentMinimum - 0.12);
    context.save();
    context.beginPath();
    context.rect(plot.x, plot.y, plot.width, plot.height);
    context.clip();
    [0, 0.5, 1].forEach((fraction) => {
      const y = plot.y + plot.height * fraction;
      context.beginPath();
      context.moveTo(plot.x, y);
      context.lineTo(plot.x + plot.width, y);
      context.strokeStyle = rgba(palette.line, 0.76);
      context.lineWidth = 1;
      context.stroke();
    });
    methods.forEach((method) => drawLossRun(context, plot, runs[method], methodColor(method), minimum, maximum));
    context.restore();

    context.font = `500 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(formatPower(maximum), plot.x - 7, plot.y);
    context.fillText(formatPower(minimum), plot.x - 7, plot.y + plot.height);
  }

  function drawLossRun(context, plot, run, lineColor, minimum, maximum) {
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    context.beginPath();
    for (let index = 0; index <= end; index += 1) {
      const x = plot.x + (index / TOTAL_STEPS) * plot.width;
      const logLoss = Math.log10(Math.max(1e-6, run[index].loss));
      const y = mapRange(logLoss, [minimum, maximum], [plot.y + plot.height, plot.y]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = color(lineColor);
    context.lineWidth = 1.8;
    context.lineCap = "round";
    context.stroke();

    const x = plot.x + (end / TOTAL_STEPS) * plot.width;
    const logLoss = Math.log10(Math.max(1e-8, run[end].loss));
    const y = mapRange(logLoss, [minimum, maximum], [plot.y + plot.height, plot.y]);
    context.beginPath();
    context.arc(x, y, 3, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(lineColor);
    context.lineWidth = 1.6;
    context.stroke();
  }

  function drawParameters(context, panel) {
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    drawPanel(context, panel, "The parameter tensor W", "6 rows × 4 columns");
    if (mode === "both") {
      const gap = 12;
      const width = (panel.width - gap - 28) / 2;
      drawLabeledHeatmap(context, runs.adam[end].weights, { x: panel.x + 14, y: panel.y + 43, width, height: panel.height - 57 }, "Adam", palette.accent, false, initialParameterMaximum);
      drawLabeledHeatmap(context, runs.shampoo[end].weights, { x: panel.x + 14 + width + gap, y: panel.y + 43, width, height: panel.height - 57 }, "Shampoo", palette.orange, false, initialParameterMaximum);
    } else {
      drawLabeledHeatmap(context, runs[mode][end].weights, { x: panel.x + 14, y: panel.y + 43, width: panel.width - 28, height: panel.height - 57 }, mode === "adam" ? "Adam" : "Shampoo", mode === "adam" ? palette.accent : palette.orange, false, initialParameterMaximum);
    }
  }

  function drawGeometry(context, panel) {
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    if (mode === "adam") {
      drawPanel(context, panel, "Adam's geometry", "24 independent scales");
      drawLabeledHeatmap(context, runs.adam[end].geometry, { x: panel.x + 14, y: panel.y + 43, width: panel.width - 28, height: panel.height - 57 }, "1 / (√v̂ + ε)", palette.accent, false);
      return;
    }

    drawPanel(context, panel, "Shampoo's learned geometry", "row and column correlations");
    const state = runs.shampoo[end];
    const gap = 14;
    const available = panel.width - 28 - gap;
    const leftWidth = available * 0.58;
    drawLabeledHeatmap(context, state.leftStatistic, { x: panel.x + 14, y: panel.y + 43, width: leftWidth, height: panel.height - 57 }, "L · 6×6", palette.orange, true);
    drawLabeledHeatmap(context, state.rightStatistic, { x: panel.x + 14 + leftWidth + gap, y: panel.y + 43, width: available - leftWidth, height: panel.height - 57 }, "R · 4×4", palette.orange, true);
  }

  function drawPanel(context, panel, title, note) {
    context.fillStyle = rgba(palette.cloud, 0.035);
    context.fillRect(panel.x, panel.y, panel.width, panel.height);
    context.strokeStyle = color(palette.line);
    context.lineWidth = 1;
    context.strokeRect(Math.round(panel.x) + 0.5, Math.round(panel.y) + 0.5, Math.round(panel.width) - 1, Math.round(panel.height) - 1);
    context.font = `600 10px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(title.toUpperCase(), panel.x + 14, panel.y + 12);
    context.font = `500 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    const stackNote = panel.width < 500;
    context.textAlign = stackNote ? "left" : "right";
    context.fillText(note, stackNote ? panel.x + 14 : panel.x + panel.width - 14, panel.y + (stackNote ? 27 : 12));
  }

  function drawLabeledHeatmap(context, values, box, label, labelColor, correlations = false, maximumOverride = null) {
    const rows = values.length;
    const columns = values[0].length;
    const labelHeight = 17;
    const gridBox = { x: box.x, y: box.y + labelHeight, width: box.width, height: box.height - labelHeight };
    const cell = Math.min(gridBox.width / columns, gridBox.height / rows);
    const gridWidth = cell * columns;
    const gridHeight = cell * rows;
    const startX = gridBox.x + (gridBox.width - gridWidth) / 2;
    const startY = gridBox.y + (gridBox.height - gridHeight) / 2;
    const maximum = correlations
      ? 1
      : (maximumOverride || Math.max(1e-8, ...values.flat().map(Math.abs)));

    context.font = `600 9px ${palette.fontBody}`;
    context.fillStyle = color(labelColor);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(label, box.x, box.y);

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const normalized = Math.max(-1, Math.min(1, values[row][column] / maximum));
        const target = normalized >= 0 ? palette.orange : palette.accent;
        const fill = blendRgb(palette.bg, target, 0.06 + Math.abs(normalized) * 0.66);
        context.fillStyle = color(fill);
        context.fillRect(startX + column * cell + 0.7, startY + row * cell + 0.7, cell - 1.4, cell - 1.4);
      }
    }
  }

  function drawInlineLegend(context, x, y, entries) {
    let offset = 0;
    context.font = `500 9px ${palette.fontBody}`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    entries.forEach(([label, markerColor]) => {
      context.fillStyle = color(markerColor);
      context.fillRect(x + offset, y - 1, 11, 2);
      context.fillStyle = color(palette.subtle);
      context.fillText(label, x + offset + 16, y);
      offset += context.measureText(label).width + 34;
    });
  }

  function updateReadout() {
    const end = Math.min(TOTAL_STEPS, Math.floor(progress));
    stepLabel.textContent = `step ${end} / ${TOTAL_STEPS}`;
    if (mode === "both") {
      lossLabel.textContent = `Adam ${formatValue(runs.adam[end].loss)} · Shampoo ${formatValue(runs.shampoo[end].loss)}`;
    } else {
      lossLabel.textContent = `loss ${formatValue(runs[mode][end].loss)}`;
    }

    ["adam", "shampoo"].forEach((method) => {
      const run = runs[method];
      const initialLoss = run[0].loss;
      const currentLoss = run[end].loss;
      const finalLoss = run.at(-1).loss;
      const logJourney = Math.log(initialLoss / finalLoss);
      const logProgress = Math.max(0, Math.log(initialLoss / currentLoss));
      const completion = Math.min(1, logProgress / Math.max(1e-12, logJourney));
      scoreElements[method].loss.textContent = formatValue(currentLoss);
      scoreElements[method].bar.style.width = `${completion * 100}%`;
    });
  }

  function visibleMethods() {
    return mode === "both" ? ["adam", "shampoo"] : [mode];
  }

  function methodColor(method) {
    return method === "adam" ? palette.accent : palette.orange;
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
    }
    const context = target.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rect.width, height: rect.height };
  }

  function innerPlot(panel, margins) {
    return {
      x: panel.x + margins.left,
      y: panel.y + margins.top,
      width: panel.width - margins.left - margins.right,
      height: panel.height - margins.top - margins.bottom,
    };
  }

  function rotatedPositiveDefinite(diagonal, rotations) {
    const size = diagonal.length;
    let basis = identity(size);
    rotations.forEach(([first, second, angle]) => {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const rotation = identity(size);
      rotation[first][first] = cosine;
      rotation[second][second] = cosine;
      rotation[first][second] = -sine;
      rotation[second][first] = sine;
      basis = multiply(basis, rotation);
    });
    return multiply(multiply(basis, diagonalMatrix(diagonal)), transpose(basis));
  }

  function inverseFourthRoot(input, damping) {
    const { values, vectors } = jacobiEigen(input);
    const transformed = values.map((value) => (Math.max(0, value) + damping) ** -0.25);
    return multiply(multiply(vectors, diagonalMatrix(transformed)), transpose(vectors));
  }

  function jacobiEigen(input) {
    const size = input.length;
    const values = copyMatrix(input);
    const vectors = identity(size);
    for (let iteration = 0; iteration < size * size * 8; iteration += 1) {
      let first = 0;
      let second = 1;
      let largest = 0;
      for (let row = 0; row < size; row += 1) {
        for (let column = row + 1; column < size; column += 1) {
          if (Math.abs(values[row][column]) > largest) {
            largest = Math.abs(values[row][column]);
            first = row;
            second = column;
          }
        }
      }
      if (largest < 1e-10) break;
      const angle = 0.5 * Math.atan2(
        2 * values[first][second],
        values[second][second] - values[first][first],
      );
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);

      for (let index = 0; index < size; index += 1) {
        if (index === first || index === second) continue;
        const firstValue = values[index][first];
        const secondValue = values[index][second];
        values[index][first] = cosine * firstValue - sine * secondValue;
        values[first][index] = values[index][first];
        values[index][second] = sine * firstValue + cosine * secondValue;
        values[second][index] = values[index][second];
      }

      const firstDiagonal = values[first][first];
      const secondDiagonal = values[second][second];
      const offDiagonal = values[first][second];
      values[first][first] = cosine ** 2 * firstDiagonal - 2 * sine * cosine * offDiagonal + sine ** 2 * secondDiagonal;
      values[second][second] = sine ** 2 * firstDiagonal + 2 * sine * cosine * offDiagonal + cosine ** 2 * secondDiagonal;
      values[first][second] = 0;
      values[second][first] = 0;

      for (let row = 0; row < size; row += 1) {
        const firstVector = vectors[row][first];
        const secondVector = vectors[row][second];
        vectors[row][first] = cosine * firstVector - sine * secondVector;
        vectors[row][second] = sine * firstVector + cosine * secondVector;
      }
    }
    return { values: values.map((row, index) => row[index]), vectors };
  }

  function correlationMatrix(input) {
    return matrix(input.length, input.length, (row, column) => (
      input[row][column] / Math.sqrt(Math.max(1e-12, input[row][row] * input[column][column]))
    ));
  }

  function matrix(rows, columns, makeValue) {
    return Array.from({ length: rows }, (_, row) => (
      Array.from({ length: columns }, (_, column) => makeValue(row, column))
    ));
  }
  function zeroMatrix(rows, columns) { return matrix(rows, columns, () => 0); }
  function identity(size) { return matrix(size, size, (row, column) => (row === column ? 1 : 0)); }
  function diagonalMatrix(values) { return matrix(values.length, values.length, (row, column) => (row === column ? values[row] : 0)); }
  function copyMatrix(input) { return input.map((row) => row.slice()); }
  function transpose(input) { return matrix(input[0].length, input.length, (row, column) => input[column][row]); }
  function addMatrix(first, second) { return matrix(first.length, first[0].length, (row, column) => first[row][column] + second[row][column]); }
  function scaleMatrix(input, amount) { return matrix(input.length, input[0].length, (row, column) => input[row][column] * amount); }
  function combineMatrices(first, second, firstAmount, secondAmount) {
    return matrix(first.length, first[0].length, (row, column) => (
      firstAmount * first[row][column] + secondAmount * second[row][column]
    ));
  }
  function multiply(first, second) {
    return matrix(first.length, second[0].length, (row, column) => {
      let sum = 0;
      for (let index = 0; index < second.length; index += 1) sum += first[row][index] * second[index][column];
      return sum;
    });
  }
  function frobeniusSquared(input) { return input.flat().reduce((sum, value) => sum + value * value, 0); }
  function dot(first, second) { return first.reduce((sum, value, index) => sum + value * second[index], 0); }
  function paddedRange(minimum, maximum) {
    const span = Math.max(0.1, maximum - minimum);
    return [minimum - span * 0.12, maximum + span * 0.12];
  }
  function equalScaleRanges(plot, xRange, yRange) {
    const xCenter = (xRange[0] + xRange[1]) / 2;
    const yCenter = (yRange[0] + yRange[1]) / 2;
    const unitsPerPixel = Math.max(
      (xRange[1] - xRange[0]) / Math.max(plot.width, 1),
      (yRange[1] - yRange[0]) / Math.max(plot.height, 1),
    );
    const xRadius = unitsPerPixel * plot.width / 2;
    const yRadius = unitsPerPixel * plot.height / 2;
    return { x: [xCenter - xRadius, xCenter + xRadius], y: [yCenter - yRadius, yCenter + yRadius] };
  }
  function mapRange(value, source, target) {
    return target[0] + ((value - source[0]) / Math.max(1e-12, source[1] - source[0])) * (target[1] - target[0]);
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

  function formatPower(value) { return `10${toSuperscript(Math.round(value))}`; }
  function toSuperscript(value) {
    const characters = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
    return String(value).split("").map((character) => characters[character]).join("");
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
  function blendRgb(first, second, amount) { return first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount)); }
  function color(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }
  function rgba(rgb, alpha) { return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`; }
}());
