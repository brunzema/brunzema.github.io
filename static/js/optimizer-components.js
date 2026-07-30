/* Four linked views of the transformations between a gradient and an update. */
(function () {
  "use strict";

  const lab = document.querySelector("[data-component-lab]");
  if (!lab) return;

  const canvas = lab.querySelector("[data-component-canvas]");
  const tabs = Array.from(lab.querySelectorAll("[data-component]"));
  const panels = Array.from(lab.querySelectorAll("[data-component-panel]"));
  const flowItems = Array.from(lab.querySelectorAll("[data-component-flow]"));
  const titleLabel = lab.querySelector("[data-component-title]");
  const readoutLabel = lab.querySelector("[data-component-readout]");
  const stepLabel = lab.querySelector("[data-component-step]");
  const progressInput = lab.querySelector("[data-component-progress]");
  const playButton = lab.querySelector("[data-component-play]");
  const playLabel = lab.querySelector("[data-component-play-label]");
  const infoButton = lab.querySelector("[data-component-info-button]");
  const infoPopover = lab.querySelector("[data-component-info]");
  const infoCloseButton = lab.querySelector("[data-component-info-close]");
  const infoTitle = lab.querySelector("[data-component-info-title]");
  const infoCopy = lab.querySelector("[data-component-info-copy]");
  if (!canvas || tabs.length === 0 || !infoButton || !infoPopover || !infoCloseButton || !infoTitle || !infoCopy) return;

  const MODES = ["gradient", "memory", "scale", "geometry"];
  const TOTAL_STEPS = 96;
  const STEP_DURATION = 110;
  const BETA_ONE = 0.84;
  const BETA_TWO = 0.92;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stream = buildGradientStream();

  const META = {
    gradient: {
      title: "Mini-batch gradient",
      aria: "Noisy per-sample gradient arrows surrounding their mini-batch mean and the full gradient.",
      draw: drawGradientView,
      readout: (step) => `batch ${String(step + 1).padStart(2, "0")} · 12 samples`,
      info: {
        title: "Read the disagreement",
        copy: "Each faint arrow is one sample gradient. Their orange average is noisy, but it usually points near the blue full-gradient direction.",
      },
    },
    memory: {
      title: "Exponential memory",
      aria: "Recent and past gradients fading by exponential weight and combining into a momentum vector.",
      draw: drawMemoryView,
      readout: (step) => `β ${BETA_ONE.toFixed(2)} · ${Math.min(step + 1, 14)} gradients visible`,
      info: {
        title: "Read time as opacity",
        copy: "Older orange gradients fade while recent ones stay strong. The bars show those same exponential weights; their blue resultant is the momentum vector.",
      },
    },
    scale: {
      title: "Coordinate-wise scale",
      aria: "An Adam diagonal metric independently rescaling two gradient coordinates.",
      draw: drawScaleView,
      readout: (_step, state) => `scale 01 ${state.scales[0].toFixed(2)} · scale 02 ${state.scales[1].toFixed(2)}`,
      info: {
        title: "Read each axis separately",
        copy: "Adam divides each coordinate by its own learned scale. The raw orange moment becomes the blue update, but a diagonal metric can stretch axes without rotating them.",
      },
    },
    geometry: {
      title: "Matrix geometry",
      aria: "A two-by-two gradient matrix transformed first by Shampoo's left row factor and then by its right column factor.",
      draw: drawGeometryView,
      readout: (_step, state) => `κ ${state.rawMatrixCondition.toFixed(1)} → ${state.leftMatrixCondition.toFixed(1)} → ${state.fullMatrixCondition.toFixed(1)}`,
      info: {
        title: "Read shape, not size",
        copy: "The arrows are the matrix columns. The left factor rebalances rows; the right factor then mixes columns. Panels are independently normalized, and a rotated square with κ near 1 is balanced.",
      },
    },
  };

  let activeMode = "gradient";
  let progress = reducedMotion ? 72 : 0;
  let playing = false;
  let hasEnteredViewport = false;
  let resumeOnEnter = false;
  let previousTime = null;
  let animationFrame = null;
  let palette = readPalette();

  bindControls();
  setPlaying(playing);
  updateMode(false);
  requestDraw();

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      if (!hasEnteredViewport) {
        hasEnteredViewport = true;
        progress = reducedMotion ? progress : 0;
        setPlaying(!reducedMotion);
      } else if (resumeOnEnter) {
        resumeOnEnter = false;
        setPlaying(true);
      }
      requestDraw();
    } else if (playing) {
      resumeOnEnter = true;
      setPlaying(false);
    }
  }, { threshold: 0.2 });
  intersectionObserver.observe(lab);

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

  window.__componentVisualization = {
    getState: () => ({
      activeMode,
      progress,
      playing,
      infoOpen: !infoPopover.hidden,
      totalSteps: TOTAL_STEPS,
      sampleCount: stream[0].samples.length,
      finalConditionNumber: stream.at(-1).rawMatrixCondition,
      finalGeometryConditions: {
        raw: stream.at(-1).rawMatrixCondition,
        left: stream.at(-1).leftMatrixCondition,
        full: stream.at(-1).fullMatrixCondition,
      },
    }),
  };

  function bindControls() {
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        activeMode = tab.dataset.component;
        updateMode(false);
      });
      tab.addEventListener("keydown", (event) => {
        const currentIndex = MODES.indexOf(activeMode);
        let nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % MODES.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + MODES.length) % MODES.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = MODES.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        activeMode = MODES[nextIndex];
        updateMode(true);
      });
    });

    playButton.addEventListener("click", () => {
      if (progress >= TOTAL_STEPS - 1) progress = 0;
      resumeOnEnter = false;
      setPlaying(!playing);
      requestDraw();
    });

    progressInput.addEventListener("input", () => {
      progress = Number(progressInput.value);
      resumeOnEnter = false;
      setPlaying(false);
      requestDraw();
    });

    infoButton.addEventListener("click", () => setInfoOpen(infoPopover.hidden));
    infoCloseButton.addEventListener("click", () => setInfoOpen(false, true));

    document.addEventListener("click", (event) => {
      if (infoPopover.hidden || infoPopover.contains(event.target) || infoButton.contains(event.target)) return;
      setInfoOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || infoPopover.hidden) return;
      setInfoOpen(false, true);
    });
  }

  function updateMode(focusTab) {
    setInfoOpen(false);
    tabs.forEach((tab) => {
      const active = tab.dataset.component === activeMode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    panels.forEach((panel) => {
      const active = panel.dataset.componentPanel === activeMode;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    flowItems.forEach((item) => item.classList.toggle("is-active", item.dataset.componentFlow === activeMode));
    lab.dataset.activeComponent = activeMode;
    lab.style.setProperty("--component-color", activeMode === "geometry" ? "var(--viz-orange)" : "var(--accent)");
    titleLabel.textContent = META[activeMode].title;
    infoTitle.textContent = META[activeMode].info.title;
    infoCopy.textContent = META[activeMode].info.copy;
    infoButton.setAttribute("aria-label", `Explain the ${META[activeMode].title.toLowerCase()} slide`);
    canvas.setAttribute("aria-label", META[activeMode].aria);
    updateReadout();
    requestDraw();
  }

  function setInfoOpen(open, returnFocus = false) {
    infoPopover.hidden = !open;
    infoButton.setAttribute("aria-expanded", String(open));
    if (returnFocus) infoButton.focus();
  }

  function setPlaying(nextPlaying) {
    playing = nextPlaying;
    lab.classList.toggle("is-paused", !playing);
    playLabel.textContent = playing ? "Pause" : (progress >= TOTAL_STEPS - 1 ? "Replay" : "Play");
    playButton.setAttribute("aria-label", playing ? "Pause component animation" : "Play component animation");
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
      progress = Math.min(TOTAL_STEPS - 1, progress + delta / STEP_DURATION);
      if (progress >= TOTAL_STEPS - 1) setPlaying(false);
    }
    draw();
    updateReadout();
    if (playing) requestDraw();
  }

  function updateReadout() {
    const step = currentStep();
    const state = stream[step];
    progressInput.value = String(Math.floor(progress));
    stepLabel.textContent = `${String(step + 1).padStart(2, "0")} / ${TOTAL_STEPS}`;
    readoutLabel.textContent = META[activeMode].readout(step, state);
  }

  function currentStep() {
    return Math.max(0, Math.min(TOTAL_STEPS - 1, Math.floor(progress)));
  }

  function draw() {
    const surface = fitCanvas(canvas);
    if (!surface) return;
    const state = stream[currentStep()];
    surface.context.clearRect(0, 0, surface.width, surface.height);
    META[activeMode].draw(surface, state);
  }

  function drawGradientView({ context, width, height }, state) {
    const plot = { x: 26, y: 20, width: width - 52, height: height - 42 };
    drawVectorGrid(context, plot, "sample gradients", "expectation");
    const center = [plot.x + plot.width * 0.48, plot.y + plot.height * 0.56];
    const vectorScale = Math.min(plot.width, plot.height) * 0.38;

    state.samples.forEach((sample, index) => {
      const alpha = 0.18 + (index / state.samples.length) * 0.16;
      drawVector(context, center, sample, vectorScale, palette.cloud, 1, null, alpha);
      const endpoint = vectorEndpoint(center, sample, vectorScale);
      context.beginPath();
      context.arc(endpoint[0], endpoint[1], 2.2, 0, Math.PI * 2);
      context.fillStyle = rgba(palette.cloud, 0.42);
      context.fill();
    });

    drawVector(context, center, state.trueGradient, vectorScale, palette.accent, 2, "full gradient", 0.78, true);
    drawVector(context, center, state.batchGradient, vectorScale, palette.orange, 3, "batch mean  gₜ", 1);
    drawOrigin(context, center);
    drawInlineLegend(context, plot.x + 4, plot.y + plot.height - 9, [
      ["sample", palette.cloud],
      ["full", palette.accent],
      ["batch", palette.orange],
    ]);
  }

  function drawMemoryView({ context, width, height }, state) {
    const compact = width < 560;
    const vectorPlot = compact
      ? { x: 24, y: 18, width: width - 48, height: height * 0.62 }
      : { x: 24, y: 18, width: width * 0.62, height: height - 40 };
    const weightPlot = compact
      ? { x: 34, y: height * 0.68, width: width - 68, height: height * 0.23 }
      : { x: width * 0.69, y: 36, width: width * 0.25, height: height - 76 };
    drawVectorGrid(context, vectorPlot, "gradient history", "momentum");
    const center = [vectorPlot.x + vectorPlot.width * 0.48, vectorPlot.y + vectorPlot.height * 0.54];
    const vectorScale = Math.min(vectorPlot.width, vectorPlot.height) * 0.4;
    const step = currentStep();
    const visible = Math.min(14, step + 1);

    for (let age = visible - 1; age >= 0; age -= 1) {
      const past = stream[step - age];
      const weight = (1 - BETA_ONE) * BETA_ONE ** age;
      drawVector(context, center, past.batchGradient, vectorScale, palette.orange, 1.2, null, 0.12 + weight * 2.7);
    }
    drawVector(context, center, state.batchGradient, vectorScale, palette.orange, 2, "current  gₜ", 0.9);
    drawVector(context, center, state.moment, vectorScale, palette.accent, 3.2, "memory  mₜ", 1);
    drawOrigin(context, center);
    drawMemoryWeights(context, weightPlot, visible);
  }

  function drawMemoryWeights(context, plot, count) {
    context.save();
    context.font = `600 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText("EXPONENTIAL WEIGHTS", plot.x, plot.y);
    const inner = { x: plot.x, y: plot.y + 22, width: plot.width, height: plot.height - 34 };
    const gap = 3;
    const barWidth = Math.max(3, (inner.width - gap * (count - 1)) / count);
    for (let age = count - 1; age >= 0; age -= 1) {
      const weight = BETA_ONE ** age;
      const index = count - 1 - age;
      const height = weight * inner.height;
      context.fillStyle = rgba(palette.accent, 0.16 + 0.72 * weight);
      context.fillRect(inner.x + index * (barWidth + gap), inner.y + inner.height - height, barWidth, height);
    }
    context.strokeStyle = color(palette.line);
    context.beginPath();
    context.moveTo(inner.x, inner.y + inner.height + 0.5);
    context.lineTo(inner.x + inner.width, inner.y + inner.height + 0.5);
    context.stroke();
    context.font = `500 8px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    context.fillText("older", inner.x, inner.y + inner.height + 6);
    context.textAlign = "right";
    context.fillText("now", inner.x + inner.width, inner.y + inner.height + 6);
    context.restore();
  }

  function drawScaleView({ context, width, height }, state) {
    const gap = width < 560 ? 16 : 28;
    const inset = 24;
    const panelWidth = (width - inset * 2 - gap) / 2;
    const panels = [
      { x: inset, y: 22, width: panelWidth, height: height - 86, title: "RAW MOMENT" },
      { x: inset + panelWidth + gap, y: 22, width: panelWidth, height: height - 86, title: "DIAGONALLY SCALED" },
    ];
    panels.forEach((panel) => drawMiniPanel(context, panel, panel.title));

    const leftCenter = [panels[0].x + panels[0].width / 2, panels[0].y + panels[0].height * 0.55];
    const rightCenter = [panels[1].x + panels[1].width / 2, panels[1].y + panels[1].height * 0.55];
    const scale = Math.min(panelWidth, panels[0].height) * 0.26;
    drawCoordinateAxes(context, leftCenter, panelWidth * 0.34, panels[0].height * 0.3);
    drawCoordinateAxes(context, rightCenter, panelWidth * 0.34, panels[1].height * 0.3);

    const rawRadii = [Math.sqrt(state.secondMoment[0]), Math.sqrt(state.secondMoment[1])];
    drawAxisEllipse(context, leftCenter, rawRadii, scale * 0.72, palette.orange, 0.42);
    drawAxisEllipse(context, rightCenter, [1, 1], scale * 0.7, palette.accent, 0.34);
    drawVector(context, leftCenter, state.correctedMoment, scale, palette.orange, 3, "m̂ₜ", 1);
    drawVector(context, rightCenter, state.adamUpdate, scale * 0.72, palette.accent, 3, "Dₜm̂ₜ", 1);
    drawOrigin(context, leftCenter);
    drawOrigin(context, rightCenter);

    const meterY = height - 43;
    drawScaleMeter(context, inset, meterY, width - inset * 2, state.scales);
  }

  function drawScaleMeter(context, x, y, width, scales) {
    context.font = `600 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText("LEARNED DIAGONAL", x, y - 15);
    const labelWidth = 28;
    const barX = x + labelWidth;
    const barWidth = width - labelWidth;
    scales.forEach((value, index) => {
      const rowY = y + index * 17;
      context.fillStyle = color(palette.subtle);
      context.fillText(`d${index + 1}`, x, rowY);
      context.fillStyle = rgba(palette.lineStrong, 0.72);
      context.fillRect(barX, rowY - 2, barWidth, 4);
      context.fillStyle = color(index === 0 ? palette.accent : palette.orange);
      context.fillRect(barX, rowY - 2, barWidth * Math.min(1, value / 2.4), 4);
    });
  }

  function drawGeometryView({ context, width, height }, state) {
    const compact = width < 640;
    lab.dataset.geometryLayout = compact ? "compact" : "wide";
    const inset = compact ? 14 : 18;
    const gap = compact ? 36 : 42;
    const panelWidth = compact ? width - inset * 2 : (width - inset * 2 - gap * 2) / 3;
    const panelHeight = compact ? (height - inset * 2 - gap * 2) / 3 : height - inset * 2;
    const panels = Array.from({ length: 3 }, (_, index) => ({
      x: compact ? inset : inset + index * (panelWidth + gap),
      y: compact ? inset + index * (panelHeight + gap) : inset,
      width: panelWidth,
      height: panelHeight,
    }));
    const stages = [
      { title: "01 · RAW  Gₜ", matrix: state.matrixGradient, condition: state.rawMatrixCondition, tone: palette.orange },
      { title: "02 · LEFT  PᴸGₜ", matrix: state.leftConditionedGradient, condition: state.leftMatrixCondition, tone: palette.orange },
      { title: "03 · BOTH  PᴸGₜPᴿ", matrix: state.fullConditionedGradient, condition: state.fullMatrixCondition, tone: palette.accent },
    ];

    panels.forEach((panel, index) => drawMatrixShapePanel(context, panel, stages[index], compact));
    drawGeometryConnector(context, panels[0], panels[1], state.leftPreconditioner, { symbol: "Pᴸ", action: "rows" }, compact);
    drawGeometryConnector(context, panels[1], panels[2], state.rightPreconditioner, { symbol: "Pᴿ", action: "columns" }, compact);
  }

  function buildGradientStream() {
    const random = createRandomSource(290726);
    const normal = createNormalSource(random);
    let moment = [0, 0];
    let secondMoment = [0, 0];
    let leftSecondMoment = [[0.35, 0], [0, 0.35]];
    let rightSecondMoment = [[0.35, 0], [0, 0.35]];
    const states = [];

    for (let step = 0; step < TOTAL_STEPS; step += 1) {
      const trueGradient = [
        0.68 + 0.16 * Math.sin(step * 0.075),
        0.28 + 0.12 * Math.cos(step * 0.11),
      ];
      const angle = -0.52 + 0.08 * Math.sin(step * 0.05);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const samples = Array.from({ length: 12 }, () => {
        const along = normal() * 0.48;
        const across = normal() * 0.13;
        return [
          trueGradient[0] + cosine * along - sine * across,
          trueGradient[1] + sine * along + cosine * across,
        ];
      });
      const batchGradient = [
        average(samples.map((sample) => sample[0])),
        average(samples.map((sample) => sample[1])),
      ];
      moment = [
        BETA_ONE * moment[0] + (1 - BETA_ONE) * batchGradient[0],
        BETA_ONE * moment[1] + (1 - BETA_ONE) * batchGradient[1],
      ];
      secondMoment = [
        BETA_TWO * secondMoment[0] + (1 - BETA_TWO) * batchGradient[0] ** 2,
        BETA_TWO * secondMoment[1] + (1 - BETA_TWO) * batchGradient[1] ** 2,
      ];
      const correctedMoment = moment.map((value) => value / (1 - BETA_ONE ** (step + 1)));
      const correctedSecondMoment = secondMoment.map((value) => value / (1 - BETA_TWO ** (step + 1)));
      const scales = correctedSecondMoment.map((value) => 1 / (Math.sqrt(value) + 0.1));
      const adamUpdate = [correctedMoment[0] * scales[0], correctedMoment[1] * scales[1]];
      const matrixGradient = structuredGradientMatrix(step);
      const matrixGradientTranspose = transposeMatrix2(matrixGradient);
      leftSecondMoment = addMatrix2(leftSecondMoment, multiplyMatrix2(matrixGradient, matrixGradientTranspose));
      rightSecondMoment = addMatrix2(rightSecondMoment, multiplyMatrix2(matrixGradientTranspose, matrixGradient));
      const leftPreconditioner = inverseFourthRoot2(leftSecondMoment, 0.08);
      const rightPreconditioner = inverseFourthRoot2(rightSecondMoment, 0.08);
      const leftConditionedGradient = multiplyMatrix2(leftPreconditioner, matrixGradient);
      const fullConditionedGradient = multiplyMatrix2(leftConditionedGradient, rightPreconditioner);
      states.push({
        samples,
        trueGradient,
        batchGradient,
        moment: moment.slice(),
        correctedMoment,
        secondMoment: correctedSecondMoment,
        scales,
        adamUpdate,
        matrixGradient,
        leftPreconditioner,
        rightPreconditioner,
        leftConditionedGradient,
        fullConditionedGradient,
        rawMatrixCondition: singularConditionNumber2(matrixGradient),
        leftMatrixCondition: singularConditionNumber2(leftConditionedGradient),
        fullMatrixCondition: singularConditionNumber2(fullConditionedGradient),
      });
    }
    return states;
  }

  function drawVectorGrid(context, plot, title, note) {
    context.save();
    context.strokeStyle = rgba(palette.line, 0.78);
    context.lineWidth = 1;
    for (let fraction = 0.2; fraction < 1; fraction += 0.2) {
      context.beginPath();
      context.moveTo(plot.x + plot.width * fraction, plot.y);
      context.lineTo(plot.x + plot.width * fraction, plot.y + plot.height);
      context.moveTo(plot.x, plot.y + plot.height * fraction);
      context.lineTo(plot.x + plot.width, plot.y + plot.height * fraction);
      context.stroke();
    }
    context.font = `600 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(title.toUpperCase(), plot.x + 4, plot.y + 4);
    context.fillStyle = color(palette.subtle);
    context.textAlign = "right";
    context.fillText(note, plot.x + plot.width - 4, plot.y + 4);
    context.restore();
  }

  function drawMiniPanel(context, panel, title) {
    context.fillStyle = rgba(palette.cloud, 0.025);
    context.fillRect(panel.x, panel.y, panel.width, panel.height);
    context.strokeStyle = color(palette.line);
    context.strokeRect(Math.round(panel.x) + 0.5, Math.round(panel.y) + 0.5, Math.round(panel.width) - 1, Math.round(panel.height) - 1);
    context.font = `600 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(title, panel.x + 10, panel.y + 9);
  }

  function drawCoordinateAxes(context, center, radiusX, radiusY) {
    context.strokeStyle = rgba(palette.lineStrong, 0.72);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(center[0] - radiusX, center[1]);
    context.lineTo(center[0] + radiusX, center[1]);
    context.moveTo(center[0], center[1] - radiusY);
    context.lineTo(center[0], center[1] + radiusY);
    context.stroke();
  }

  function drawAxisEllipse(context, center, radii, scale, ellipseColor, alpha) {
    const maximum = Math.max(...radii, 1e-6);
    context.save();
    context.translate(center[0], center[1]);
    context.beginPath();
    context.ellipse(0, 0, scale * radii[0] / maximum, scale * radii[1] / maximum, 0, 0, Math.PI * 2);
    context.fillStyle = rgba(ellipseColor, alpha * 0.16);
    context.fill();
    context.strokeStyle = rgba(ellipseColor, alpha + 0.2);
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  }

  function drawMatrixShapePanel(context, panel, stage, compact) {
    drawMiniPanel(context, panel, stage.title);
    context.font = `500 8px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    context.textAlign = "right";
    context.textBaseline = "top";
    context.fillText("SHAPE NORMALIZED", panel.x + panel.width - 10, panel.y + 9);

    const center = [panel.x + panel.width / 2, panel.y + panel.height * (compact ? 0.4 : 0.43)];
    const radius = Math.min(panel.width * (compact ? 0.2 : 0.27), panel.height * 0.25);
    drawCoordinateAxes(context, center, radius * 1.35, radius * 1.25);
    drawTransformedSquare(context, center, stage.matrix, radius, stage.tone);

    const heatmapSize = compact ? 31 : 42;
    const footerY = panel.y + panel.height - heatmapSize - 10;
    drawMatrixHeatmap(context, stage.matrix, panel.x + 10, footerY, heatmapSize, "matrix");
    drawConditionMeter(
      context,
      panel.x + heatmapSize + 25,
      footerY + heatmapSize * 0.58,
      panel.width - heatmapSize - 35,
      stage.condition,
      stage.tone,
    );
  }

  function drawTransformedSquare(context, center, matrix, radius, shapeColor) {
    const largestSingularValue = singularValues2(matrix)[0];
    const scale = radius / Math.max(largestSingularValue, 1e-8);
    const firstColumn = [matrix[0][0], matrix[1][0]];
    const secondColumn = [matrix[0][1], matrix[1][1]];
    const origin = [
      center[0] - (firstColumn[0] + secondColumn[0]) * scale / 2,
      center[1] + (firstColumn[1] + secondColumn[1]) * scale / 2,
    ];
    const point = (vector) => [origin[0] + vector[0] * scale, origin[1] - vector[1] * scale];
    const vertices = [
      origin,
      point(firstColumn),
      point([firstColumn[0] + secondColumn[0], firstColumn[1] + secondColumn[1]]),
      point(secondColumn),
    ];

    context.save();
    context.setLineDash([3, 4]);
    context.strokeStyle = rgba(palette.lineStrong, 0.72);
    context.strokeRect(center[0] - radius * 0.52, center[1] - radius * 0.52, radius * 1.04, radius * 1.04);
    context.setLineDash([]);
    context.beginPath();
    vertices.forEach((vertex, index) => index === 0 ? context.moveTo(vertex[0], vertex[1]) : context.lineTo(vertex[0], vertex[1]));
    context.closePath();
    context.fillStyle = rgba(shapeColor, 0.09);
    context.fill();
    context.strokeStyle = rgba(shapeColor, 0.78);
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();

    drawVector(context, origin, firstColumn, scale, palette.orange, 2.4, "c₁", 0.95);
    drawVector(context, origin, secondColumn, scale, palette.accent, 2.4, "c₂", 0.95);
    drawOrigin(context, origin);
  }

  function drawConditionMeter(context, x, y, width, condition, meterColor) {
    const descriptor = condition < 1.35 ? "balanced" : (condition < 3 ? "closer" : "skewed");
    context.font = `600 8px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.fillText(`κ ${condition.toFixed(1)} · ${descriptor}`, x, y - 7);
    context.fillStyle = rgba(palette.lineStrong, 0.72);
    context.fillRect(x, y, width, 3);
    context.fillStyle = rgba(meterColor, 0.86);
    context.fillRect(x, y, width * Math.min(1, Math.log2(Math.max(1, condition)) / 3), 3);
  }

  function drawGeometryConnector(context, first, second, factor, label, compact) {
    const factorSize = compact ? 23 : 27;
    if (compact) {
      const connectorTop = first.y + first.height;
      const centerX = first.x + first.width / 2;
      drawArrowLine(context, centerX, connectorTop + 4, centerX, second.y - 4, palette.subtle);
      drawMatrixHeatmap(context, factor, first.x + 9, connectorTop + 7, factorSize, label.symbol);
      context.font = `500 8px ${palette.fontBody}`;
      context.fillStyle = color(palette.subtle);
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillText(label.action, first.x + factorSize + 16, connectorTop + 18);
      return;
    }

    const fromX = first.x + first.width + 5;
    const toX = second.x - 5;
    const centerX = (fromX + toX) / 2;
    const centerY = first.y + first.height * 0.53;
    drawArrowLine(context, fromX, centerY, toX, centerY, palette.subtle);
    drawMatrixHeatmap(context, factor, centerX - factorSize / 2, first.y + first.height * 0.32, factorSize, label.symbol);
    context.font = `500 8px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(label.action, centerX, first.y + first.height * 0.32 + factorSize + 4);
  }

  function drawMatrixHeatmap(context, values, x, y, size, label) {
    context.font = `600 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.fillText(label, x, y - 5);
    const cell = size / 2;
    const maximum = Math.max(1e-8, ...values.flat().map(Math.abs));
    values.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      const target = value >= 0 ? palette.orange : palette.accent;
      context.fillStyle = color(blendRgb(palette.bg, target, 0.08 + 0.7 * Math.abs(value) / maximum));
      context.fillRect(x + columnIndex * cell + 0.7, y + rowIndex * cell + 0.7, cell - 1.4, cell - 1.4);
    }));
  }

  function drawVector(context, center, vector, scale, vectorColor, width, label, alpha = 1, dashed = false) {
    const endpoint = vectorEndpoint(center, vector, scale);
    context.save();
    context.strokeStyle = rgba(vectorColor, alpha);
    context.fillStyle = rgba(vectorColor, alpha);
    context.lineWidth = width;
    context.lineCap = "round";
    if (dashed) context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(center[0], center[1]);
    context.lineTo(endpoint[0], endpoint[1]);
    context.stroke();
    context.setLineDash([]);
    drawArrowHead(context, center[0], center[1], endpoint[0], endpoint[1], vectorColor, alpha, width + 4);
    if (label) {
      context.font = `600 9px ${palette.fontBody}`;
      context.textAlign = vector[0] >= 0 ? "left" : "right";
      context.textBaseline = vector[1] >= 0 ? "bottom" : "top";
      context.fillText(label, endpoint[0] + (vector[0] >= 0 ? 7 : -7), endpoint[1] + (vector[1] >= 0 ? -5 : 5));
    }
    context.restore();
  }

  function drawArrowHead(context, fromX, fromY, toX, toY, headColor, alpha, size) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    context.beginPath();
    context.moveTo(toX, toY);
    context.lineTo(toX - size * Math.cos(angle - 0.5), toY - size * Math.sin(angle - 0.5));
    context.lineTo(toX - size * Math.cos(angle + 0.5), toY - size * Math.sin(angle + 0.5));
    context.closePath();
    context.fillStyle = rgba(headColor, alpha);
    context.fill();
  }

  function drawArrowLine(context, fromX, fromY, toX, toY, arrowColor) {
    context.strokeStyle = rgba(arrowColor, 0.7);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
    drawArrowHead(context, fromX, fromY, toX, toY, arrowColor, 0.7, 5);
  }

  function drawOrigin(context, center) {
    context.beginPath();
    context.arc(center[0], center[1], 3, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(palette.ink);
    context.lineWidth = 1;
    context.stroke();
  }

  function drawInlineLegend(context, x, y, entries) {
    let offset = 0;
    context.font = `500 8px ${palette.fontBody}`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    entries.forEach(([label, markerColor]) => {
      context.fillStyle = color(markerColor);
      context.fillRect(x + offset, y - 1, 10, 2);
      context.fillStyle = color(palette.subtle);
      context.fillText(label, x + offset + 14, y);
      offset += context.measureText(label).width + 31;
    });
  }

  function vectorEndpoint(center, vector, scale) {
    return [center[0] + vector[0] * scale, center[1] - vector[1] * scale];
  }

  function structuredGradientMatrix(step) {
    const rowRotation = rotationMatrix2(-0.54 + 0.035 * Math.sin(step * 0.07));
    const columnRotation = rotationMatrix2(0.68 + 0.04 * Math.cos(step * 0.05));
    const singularValues = [
      1.15 + 0.09 * Math.sin(step * 0.09),
      0.18 + 0.025 * Math.cos(step * 0.13),
    ];
    const diagonal = [[singularValues[0], 0], [0, singularValues[1]]];
    return multiplyMatrix2(multiplyMatrix2(rowRotation, diagonal), transposeMatrix2(columnRotation));
  }

  function rotationMatrix2(angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [[cosine, -sine], [sine, cosine]];
  }

  function transposeMatrix2(input) {
    return [[input[0][0], input[1][0]], [input[0][1], input[1][1]]];
  }

  function multiplyMatrix2(first, second) {
    return [
      [
        first[0][0] * second[0][0] + first[0][1] * second[1][0],
        first[0][0] * second[0][1] + first[0][1] * second[1][1],
      ],
      [
        first[1][0] * second[0][0] + first[1][1] * second[1][0],
        first[1][0] * second[0][1] + first[1][1] * second[1][1],
      ],
    ];
  }

  function singularValues2(input) {
    const gram = multiplyMatrix2(input, transposeMatrix2(input));
    return eigenSymmetric2(gram).values.map((value) => Math.sqrt(Math.max(value, 1e-12)));
  }

  function singularConditionNumber2(input) {
    const values = singularValues2(input);
    return values[0] / Math.max(values[1], 1e-8);
  }

  function inverseFourthRoot2(input, damping) {
    const eigen = eigenSymmetric2(input);
    const first = (eigen.values[0] + damping) ** -0.25;
    const second = (eigen.values[1] + damping) ** -0.25;
    const cosine = Math.cos(eigen.angle);
    const sine = Math.sin(eigen.angle);
    return [
      [cosine * cosine * first + sine * sine * second, cosine * sine * (first - second)],
      [cosine * sine * (first - second), sine * sine * first + cosine * cosine * second],
    ];
  }

  function eigenSymmetric2(input) {
    const a = input[0][0];
    const b = (input[0][1] + input[1][0]) / 2;
    const d = input[1][1];
    const trace = a + d;
    const radius = Math.sqrt(((a - d) / 2) ** 2 + b ** 2);
    return { values: [Math.max(1e-10, trace / 2 + radius), Math.max(1e-10, trace / 2 - radius)], angle: 0.5 * Math.atan2(2 * b, a - d) };
  }

  function addMatrix2(first, second) {
    return [
      [first[0][0] + second[0][0], first[0][1] + second[0][1]],
      [first[1][0] + second[1][0], first[1][1] + second[1][1]],
    ];
  }

  function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  }

  function createRandomSource(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let mixed = value;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createNormalSource(random) {
    let spare = null;
    return () => {
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

  function readPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: parseColor(styles.getPropertyValue("--bg")),
      ink: parseColor(styles.getPropertyValue("--ink")),
      muted: parseColor(styles.getPropertyValue("--muted")),
      subtle: parseColor(styles.getPropertyValue("--subtle")),
      line: parseColor(styles.getPropertyValue("--line")),
      lineStrong: parseColor(styles.getPropertyValue("--line-strong")),
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
      return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
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
