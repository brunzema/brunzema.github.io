/* ───────────────────────────────────────────────────────────
   Smooth, time-varying two-objective GP visualization.

   8,192 fixed 2-D Sobol sites are evaluated by two independent
   squared-exponential GP fields. A shared spectral base draw keeps
   length-scale changes coupled, while latent Fourier weights move
   along continuous temporal trajectories. This preserves a GP draw
   at every instant without discrete redraw boundaries.
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const demo = document.querySelector("[data-pareto-demo]");
  if (!demo) return;

  const mainCanvas = demo.querySelector("[data-pareto-canvas]");
  const pathCanvases = [
    demo.querySelector('[data-path-canvas="0"]'),
    demo.querySelector('[data-path-canvas="1"]'),
  ];
  const timeLabel = demo.querySelector("[data-time-step]");
  const frontCountLabel = demo.querySelector("[data-front-count]");
  const playButton = demo.querySelector("[data-play-toggle]");
  const playLabel = demo.querySelector("[data-play-label]");
  const newPathsButton = demo.querySelector("[data-new-paths]");
  const clearTraceButton = demo.querySelector("[data-clear-trace]");
  const traceLegend = demo.querySelector("[data-trace-legend]");
  const infoButton = demo.querySelector("[data-info-toggle]");
  const infoPanel = demo.querySelector("[data-info-panel]");
  const infoClose = demo.querySelector("[data-info-close]");

  if (!mainCanvas || pathCanvases.some((canvas) => !canvas)) return;

  const SAMPLE_COUNT = 8192;
  const FEATURE_COUNT = 40;
  const FIELD_RESOLUTION = 84;
  const FIELD_COUNT = FIELD_RESOLUTION * FIELD_RESOLUTION;
  const VALUE_COUNT = SAMPLE_COUNT + FIELD_COUNT;
  const MIN_AXIS_LIMIT = 3;
  const REFERENCE = [0, 0];
  const RATE_SCALE = 5;
  const LENGTH_RESPONSE_TIME = 320;
  const RESET_BLEND_DURATION = 1100;
  const FRONT_REFRESH_INTERVAL = 50;
  const FRONT_BLEND_DURATION = 45;
  const TRACE_SAMPLE_INTERVAL = 50;
  const TRACE_MAX_POINTS = 360;
  const SPECTRAL_LENGTH_SCALES = [0.06, 0.095, 0.15, 0.245, 0.4];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sobolInputs = makeSobolSequence(SAMPLE_COUNT);
  const evaluationInputs = buildEvaluationInputs();
  const fieldSurfaces = pathCanvases.map(() => {
    const canvas = document.createElement("canvas");
    const siteCanvas = document.createElement("canvas");
    canvas.width = FIELD_RESOLUTION;
    canvas.height = FIELD_RESOLUTION;
    const context = canvas.getContext("2d");
    return {
      canvas,
      context,
      image: context.createImageData(FIELD_RESOLUTION, FIELD_RESOLUTION),
      siteCanvas,
      siteTextureKey: "",
    };
  });

  let random = createRandomSource(randomSeed());
  let spareNormal = null;
  let palette = readPalette();
  let playing = !reducedMotion;
  let elapsedTime = 0;
  let lastFrame = null;
  let animationFrame = null;
  let resetFrom = null;
  let resetElapsed = RESET_BLEND_DURATION;
  let currentFront = [];
  let previousFront = [];
  let pendingFront = null;
  let frontRefreshElapsed = FRONT_REFRESH_INTERVAL;
  let frontBlendElapsed = FRONT_BLEND_DURATION;
  let trackedIndex = -1;
  const traceBuffer = new Array(TRACE_MAX_POINTS);
  let traceStart = 0;
  let traceLength = 0;
  let traceSampleElapsed = 0;
  let axisLimit = MIN_AXIS_LIMIT;
  let axisInitialized = false;

  let objectives = [
    createObjective(0.04, 0.16),
    createObjective(0.08, 0.24),
  ];

  bindControls();
  setPlaying(playing);
  updateTraceControls();
  evaluateObjectives();
  updateAxisLimit(0, true);
  refreshParetoFront(true);
  render();

  const resizeObserver = new ResizeObserver(requestDraw);
  resizeObserver.observe(mainCanvas);
  pathCanvases.forEach((canvas) => resizeObserver.observe(canvas));

  window.addEventListener("themechange", () => {
    palette = readPalette();
    requestDraw();
  });

  document.addEventListener("visibilitychange", () => {
    lastFrame = null;
    if (document.hidden && animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    } else if (!document.hidden) {
      requestDraw();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (
      infoPanel
      && !infoPanel.hidden
      && !infoPanel.contains(event.target)
      && event.target !== infoButton
    ) {
      setInfoOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && infoPanel && !infoPanel.hidden) {
      setInfoOpen(false);
      infoButton.focus();
    }
  });

  pathCanvases.forEach((canvas) => {
    canvas.addEventListener("click", (event) => selectTrackedSite(event, canvas));
  });
  requestDraw();

  // Read-only state for local browser validation.
  window.__paretoVisualization = {
    getState: () => ({
      sampleCount: SAMPLE_COUNT,
      inputDimension: 2,
      evolutionModel: "smooth-temporal-rff",
      lengthScaleCoupling: "shared-spectral-envelope",
      paretoRefreshMs: FRONT_REFRESH_INTERVAL,
      paretoBlendMs: FRONT_BLEND_DURATION,
      featureCount: FEATURE_COUNT,
      referencePoint: REFERENCE.slice(),
      sobolPreview: Array.from({ length: 4 }, (_, index) => [sobolInputs[0][index], sobolInputs[1][index]]),
      objectiveMeans: objectives.map((objective) => sampleMean(objective.display)),
      time: elapsedTime,
      paretoCount: currentFront.length,
      trackedIndex,
      trackedInput: trackedIndex >= 0
        ? [sobolInputs[0][trackedIndex], sobolInputs[1][trackedIndex]]
        : null,
      traceLength,
      traceCapacity: TRACE_MAX_POINTS,
      playing,
      objectives: objectives.map(({ rate, lengthScale, activeLengthScale }) => ({
        epsilon: rate,
        lengthScale,
        activeLengthScale,
      })),
    }),
  };

  function createObjective(rate, lengthScale) {
    const spatialFrequencyOne = new Float64Array(FEATURE_COUNT);
    const spatialFrequencyTwo = new Float64Array(FEATURE_COUNT);
    const proposalDensity = new Float64Array(FEATURE_COUNT);
    const spatialPhase = new Float64Array(FEATURE_COUNT);
    const temporalCosineWeight = new Float64Array(FEATURE_COUNT);
    const temporalSineWeight = new Float64Array(FEATURE_COUNT);
    const temporalFrequency = new Float64Array(FEATURE_COUNT);
    const temporalPhase = new Float64Array(FEATURE_COUNT);

    for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
      const proposalScale = SPECTRAL_LENGTH_SCALES[feature % SPECTRAL_LENGTH_SCALES.length];
      spatialFrequencyOne[feature] = normalSample() / proposalScale;
      spatialFrequencyTwo[feature] = normalSample() / proposalScale;
      const squaredFrequency = spatialFrequencyOne[feature] ** 2 + spatialFrequencyTwo[feature] ** 2;
      proposalDensity[feature] = SPECTRAL_LENGTH_SCALES.reduce(
        (sum, scale) => sum + squaredExponentialSpectralDensity(scale, squaredFrequency),
        0,
      ) / SPECTRAL_LENGTH_SCALES.length;
      spatialPhase[feature] = random() * Math.PI * 2;
      temporalCosineWeight[feature] = normalSample();
      temporalSineWeight[feature] = normalSample();
      temporalFrequency[feature] = 0.62 + random() * 0.76;
      temporalPhase[feature] = random() * Math.PI * 2;
    }

    const objective = {
      rate,
      lengthScale,
      activeLengthScale: lengthScale,
      spatialFrequencyOne,
      spatialFrequencyTwo,
      proposalDensity,
      spatialPhase,
      temporalCosineWeight,
      temporalSineWeight,
      temporalFrequency,
      temporalPhase,
      features: null,
      spectralAmplitude: new Float64Array(FEATURE_COUNT),
      weights: new Float64Array(FEATURE_COUNT),
      values: new Float32Array(VALUE_COUNT),
      display: new Float32Array(VALUE_COUNT),
    };
    objective.features = buildFeatureMatrix(objective);
    return objective;
  }

  function squaredExponentialSpectralDensity(lengthScale, squaredFrequency) {
    const squaredLengthScale = lengthScale * lengthScale;
    return (squaredLengthScale / (2 * Math.PI))
      * Math.exp(-0.5 * squaredLengthScale * squaredFrequency);
  }

  function buildFeatureMatrix(objective) {
    const features = new Float32Array(VALUE_COUNT * FEATURE_COUNT);
    const normalization = Math.sqrt(2 / FEATURE_COUNT);
    for (let point = 0; point < VALUE_COUNT; point += 1) {
      const xOne = evaluationInputs[0][point];
      const xTwo = evaluationInputs[1][point];
      const offset = point * FEATURE_COUNT;
      for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
        features[offset + feature] = normalization * Math.cos(
          objective.spatialFrequencyOne[feature] * xOne
          + objective.spatialFrequencyTwo[feature] * xTwo
          + objective.spatialPhase[feature],
        );
      }
    }
    return features;
  }

  function bindControls() {
    demo.querySelectorAll(".range-input").forEach((input) => {
      updateRange(input);

      input.addEventListener("input", () => {
        const objectiveIndex = Number.parseInt(input.dataset.objective, 10);
        const value = Number.parseFloat(input.value);
        if (input.dataset.param === "epsilon") objectives[objectiveIndex].rate = value;
        else setLengthScaleTarget(objectives[objectiveIndex], value);
        updateRange(input);
      });
    });

    playButton.addEventListener("click", () => {
      setPlaying(!playing);
      requestDraw();
    });

    newPathsButton.addEventListener("click", () => {
      clearTrackedSite();
      evaluateObjectives();
      resetFrom = objectives.map((objective) => objective.display.slice());
      resetElapsed = 0;
      random = createRandomSource(randomSeed());
      spareNormal = null;
      objectives = objectives.map((objective) => createObjective(objective.rate, objective.lengthScale));
      elapsedTime = 0;
      if (reducedMotion && !playing) {
        resetFrom = null;
        resetElapsed = RESET_BLEND_DURATION;
      }
      requestDraw();
    });

    clearTraceButton.addEventListener("click", () => {
      clearTrackedSite();
      requestDraw();
    });

    if (infoButton && infoPanel) {
      infoButton.addEventListener("click", () => setInfoOpen(infoPanel.hidden));
      infoClose.addEventListener("click", () => {
        setInfoOpen(false);
        infoButton.focus();
      });
    }
  }

  function updateRange(input) {
    const min = Number.parseFloat(input.min);
    const max = Number.parseFloat(input.max);
    const value = Number.parseFloat(input.value);
    const progress = ((value - min) / (max - min)) * 100;
    input.style.setProperty("--range-progress", `${progress}%`);

    const objectiveIndex = Number.parseInt(input.dataset.objective, 10);
    const subscript = objectiveIndex === 0 ? "₁" : "₂";
    const symbol = input.dataset.param === "epsilon" ? "ε" : "ℓ";
    const output = demo.querySelector(`[data-output="${input.dataset.param}-${objectiveIndex}"]`);
    if (output) output.textContent = `${symbol}${subscript} = ${value.toFixed(2)}`;
  }

  function setLengthScaleTarget(objective, nextLengthScale) {
    objective.lengthScale = nextLengthScale;
    if (reducedMotion && !playing) {
      objective.activeLengthScale = nextLengthScale;
    }
    requestDraw();
  }

  function setPlaying(nextPlaying) {
    playing = nextPlaying;
    demo.classList.toggle("is-paused", !playing);
    playLabel.textContent = playing ? "Pause" : "Play";
    playButton.setAttribute("aria-label", playing ? "Pause evolution" : "Play evolution");
    playButton.setAttribute("aria-pressed", String(!playing));
    lastFrame = null;
  }

  function setInfoOpen(open) {
    if (!infoPanel || !infoButton) return;
    infoPanel.hidden = !open;
    infoButton.setAttribute("aria-expanded", String(open));
  }

  function update(deltaTime) {
    const seconds = deltaTime / 1000;
    if (playing) {
      elapsedTime += seconds;
      for (const objective of objectives) {
        for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
          objective.temporalPhase[feature] += objective.temporalFrequency[feature]
            * objective.rate * RATE_SCALE * seconds;
        }
      }
    }

    for (const objective of objectives) {
      const difference = objective.lengthScale - objective.activeLengthScale;
      if (Math.abs(difference) < 1e-4) {
        objective.activeLengthScale = objective.lengthScale;
        continue;
      }
      const blend = reducedMotion ? 1 : 1 - Math.exp(-deltaTime / LENGTH_RESPONSE_TIME);
      objective.activeLengthScale += difference * blend;
    }

    if (resetFrom) {
      resetElapsed += deltaTime;
      if (resetElapsed >= RESET_BLEND_DURATION) {
        resetElapsed = RESET_BLEND_DURATION;
        resetFrom = null;
      }
    }

    frontBlendElapsed = Math.min(FRONT_BLEND_DURATION, frontBlendElapsed + deltaTime);
    frontRefreshElapsed += deltaTime;
  }

  function evaluateObjectives() {
    objectives.forEach((objective, objectiveIndex) => {
      const weights = objective.weights;
      let amplitudeEnergy = 0;
      for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
        const squaredFrequency = objective.spatialFrequencyOne[feature] ** 2
          + objective.spatialFrequencyTwo[feature] ** 2;
        const targetDensity = squaredExponentialSpectralDensity(
          objective.activeLengthScale,
          squaredFrequency,
        );
        const amplitude = Math.sqrt(targetDensity / Math.max(objective.proposalDensity[feature], 1e-16));
        objective.spectralAmplitude[feature] = amplitude;
        amplitudeEnergy += amplitude * amplitude;
      }
      const amplitudeNormalization = Math.sqrt(FEATURE_COUNT / Math.max(amplitudeEnergy, 1e-16));

      for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
        const phase = objective.temporalPhase[feature];
        const temporalWeight = objective.temporalCosineWeight[feature] * Math.cos(phase)
          + objective.temporalSineWeight[feature] * Math.sin(phase);
        weights[feature] = temporalWeight * objective.spectralAmplitude[feature] * amplitudeNormalization;
      }

      let mean = 0;
      for (let point = 0; point < VALUE_COUNT; point += 1) {
        const offset = point * FEATURE_COUNT;
        let value = 0;
        for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
          value += objective.features[offset + feature] * weights[feature];
        }
        objective.values[point] = value;
        if (point < SAMPLE_COUNT) mean += value;
      }
      mean /= SAMPLE_COUNT;

      const resetBlend = resetFrom ? smootherStep(resetElapsed / RESET_BLEND_DURATION) : 1;
      for (let point = 0; point < VALUE_COUNT; point += 1) {
        const centered = objective.values[point] - mean;
        objective.values[point] = centered;
        objective.display[point] = resetFrom
          ? resetFrom[objectiveIndex][point] + (centered - resetFrom[objectiveIndex][point]) * resetBlend
          : centered;
      }
    });
  }

  function needsContinuousFrame() {
    return playing
      || Boolean(resetFrom)
      || objectives.some(
        (objective) => Math.abs(objective.lengthScale - objective.activeLengthScale) >= 1e-4,
      );
  }

  function requestDraw() {
    if (animationFrame === null && !document.hidden) {
      animationFrame = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    animationFrame = null;
    if (lastFrame === null) lastFrame = now;
    const deltaTime = Math.min(now - lastFrame, 50);
    lastFrame = now;

    update(deltaTime);
    evaluateObjectives();
    updateTrackedTrail(deltaTime);
    updateAxisLimit(deltaTime);
    if (frontRefreshElapsed >= FRONT_REFRESH_INTERVAL || currentFront.length === 0) {
      refreshParetoFront(currentFront.length === 0);
    }
    startPendingFrontTransition();
    render();

    if (needsContinuousFrame()) requestDraw();
  }

  function refreshParetoFront(force) {
    const nextFront = findParetoFront(objectives[0].display, objectives[1].display);
    if (force || currentFront.length === 0) {
      currentFront = nextFront;
      previousFront = [];
      pendingFront = null;
      frontBlendElapsed = FRONT_BLEND_DURATION;
    } else {
      pendingFront = nextFront;
    }
    frontRefreshElapsed = 0;
  }

  function startPendingFrontTransition() {
    if (!pendingFront || frontBlendElapsed < FRONT_BLEND_DURATION) return;
    if (sameFront(currentFront, pendingFront)) {
      pendingFront = null;
      return;
    }
    previousFront = currentFront;
    currentFront = pendingFront;
    pendingFront = null;
    frontBlendElapsed = 0;
  }

  function sameFront(first, second) {
    if (first.length !== second.length) return false;
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] !== second[index]) return false;
    }
    return true;
  }

  function render() {
    drawParetoPlot();
    drawInputField(pathCanvases[0], fieldSurfaces[0], objectives[0].display, palette.accent);
    drawInputField(pathCanvases[1], fieldSurfaces[1], objectives[1].display, palette.orange);

    timeLabel.textContent = `t = ${elapsedTime.toFixed(2)}`;
    const countText = `${currentFront.length} Pareto point${currentFront.length === 1 ? "" : "s"}`;
    if (frontCountLabel.textContent !== countText) frontCountLabel.textContent = countText;
  }

  function drawParetoPlot() {
    const surface = fitCanvas(mainCanvas);
    if (!surface) return;

    const { context, width, height } = surface;
    const compact = width < 560;
    const margin = {
      top: compact ? 24 : 30,
      right: compact ? 17 : 28,
      bottom: compact ? 49 : 55,
      left: compact ? 47 : 62,
    };

    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const scaleX = (value) => margin.left + ((value + axisLimit) / (2 * axisLimit)) * plotWidth;
    const scaleY = (value) => margin.top + (1 - (value + axisLimit) / (2 * axisLimit)) * plotHeight;

    context.clearRect(0, 0, width, height);
    drawGrid(context, margin, plotWidth, plotHeight, scaleX, scaleY, compact, axisLimit);

    const frontBlend = smootherStep(frontBlendElapsed / FRONT_BLEND_DURATION);
    context.save();
    context.beginPath();
    context.rect(margin.left, margin.top, plotWidth, plotHeight);
    context.clip();

    if (previousFront.length && frontBlend < 1) {
      drawDominatedRegion(context, previousFront, scaleX, scaleY, 1 - frontBlend);
    }
    drawDominatedRegion(context, currentFront, scaleX, scaleY, frontBlend);
    drawSamples(context, scaleX, scaleY);
    if (previousFront.length && frontBlend < 1) {
      drawFront(context, previousFront, scaleX, scaleY, 1 - frontBlend);
    }
    drawFront(context, currentFront, scaleX, scaleY, frontBlend);
    drawTrackedTrail(context, scaleX, scaleY);
    context.restore();

    drawReference(context, scaleX, scaleY);
    drawAxisLabels(context, margin, plotWidth, plotHeight, compact);
  }

  function drawGrid(context, margin, plotWidth, plotHeight, scaleX, scaleY, compact, limit) {
    const ticks = compact ? [-limit, 0, limit] : buildAxisTicks(limit);
    context.save();
    context.lineWidth = 1;
    context.font = `500 ${compact ? 9 : 10}px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);

    for (const tick of ticks) {
      const x = Math.round(scaleX(tick)) + 0.5;
      const y = Math.round(scaleY(tick)) + 0.5;

      context.beginPath();
      context.moveTo(x, margin.top);
      context.lineTo(x, margin.top + plotHeight);
      context.strokeStyle = rgba(tick === 0 ? palette.ink : palette.line, tick === 0 ? 0.2 : 0.58);
      context.stroke();

      context.beginPath();
      context.moveTo(margin.left, y);
      context.lineTo(margin.left + plotWidth, y);
      context.strokeStyle = rgba(tick === 0 ? palette.ink : palette.line, tick === 0 ? 0.2 : 0.58);
      context.stroke();

      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(formatTick(tick), x, margin.top + plotHeight + 9);
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(formatTick(tick), margin.left - 9, y);
    }
    context.restore();
  }

  function buildAxisTicks(limit) {
    const step = limit <= 4.5 ? 1 : 2;
    const ticks = [0];
    for (let value = step; value <= Math.floor(limit); value += step) {
      ticks.unshift(-value);
      ticks.push(value);
    }
    return ticks;
  }

  function updateAxisLimit(deltaTime, immediate = false) {
    let largestMagnitude = 0;
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      largestMagnitude = Math.max(
        largestMagnitude,
        Math.abs(objectives[0].display[index]),
        Math.abs(objectives[1].display[index]),
      );
    }
    const target = Math.max(MIN_AXIS_LIMIT, Math.min(6, largestMagnitude * 1.12 + 0.18));
    if (immediate || !axisInitialized) {
      axisLimit = target;
      axisInitialized = true;
      return;
    }
    const blend = 1 - Math.exp(-deltaTime / 680);
    axisLimit += (target - axisLimit) * blend;
  }

  function drawDominatedRegion(context, front, scaleX, scaleY, opacity) {
    if (front.length === 0 || opacity <= 0) return;
    context.beginPath();
    context.moveTo(scaleX(REFERENCE[0]), scaleY(REFERENCE[1]));
    const first = front[0];
    context.lineTo(scaleX(REFERENCE[0]), scaleY(objectives[1].display[first]));
    context.lineTo(scaleX(objectives[0].display[first]), scaleY(objectives[1].display[first]));

    for (let position = 1; position < front.length; position += 1) {
      const previous = front[position - 1];
      const index = front[position];
      context.lineTo(scaleX(objectives[0].display[previous]), scaleY(objectives[1].display[index]));
      context.lineTo(scaleX(objectives[0].display[index]), scaleY(objectives[1].display[index]));
    }

    const last = front[front.length - 1];
    context.lineTo(scaleX(objectives[0].display[last]), scaleY(REFERENCE[1]));
    context.closePath();
    context.fillStyle = rgba(palette.accent, 0.05 * opacity);
    context.fill();
  }

  function drawSamples(context, scaleX, scaleY) {
    const pointSize = 2.7;
    const pointOffset = pointSize / 2;
    context.beginPath();
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const x = scaleX(objectives[0].display[index]);
      const y = scaleY(objectives[1].display[index]);
      context.rect(x - pointOffset, y - pointOffset, pointSize, pointSize);
    }
    context.fillStyle = rgba(palette.cloud, palette.cloudAlpha);
    context.fill();
  }

  function drawTrackedTrail(context, scaleX, scaleY) {
    if (trackedIndex < 0) return;

    if (traceLength > 1) {
      context.beginPath();
      for (let position = 0; position < traceLength; position += 1) {
        const point = tracePointAt(position);
        const x = scaleX(point[0]);
        const y = scaleY(point[1]);
        if (position === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.lineCap = "round";
      context.lineJoin = "round";

      for (let position = 1; position < traceLength; position += 1) {
        const previous = tracePointAt(position - 1);
        const point = tracePointAt(position);
        const progress = position / Math.max(1, traceLength - 1);
        context.beginPath();
        context.moveTo(scaleX(previous[0]), scaleY(previous[1]));
        context.lineTo(scaleX(point[0]), scaleY(point[1]));
        context.lineWidth = 1.8;
        context.strokeStyle = rgba(palette.orange, 0.12 + 0.78 * progress);
        context.stroke();
      }
    }

    const currentX = scaleX(objectives[0].display[trackedIndex]);
    const currentY = scaleY(objectives[1].display[trackedIndex]);
    context.beginPath();
    context.arc(currentX, currentY, 5, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = color(palette.orange);
    context.stroke();
    context.beginPath();
    context.arc(currentX, currentY, 1.5, 0, Math.PI * 2);
    context.fillStyle = color(palette.ink);
    context.fill();
  }

  function drawFront(context, front, scaleX, scaleY, opacity) {
    if (front.length === 0 || opacity <= 0) return;
    const point = (index) => [
      scaleX(objectives[0].display[index]),
      scaleY(objectives[1].display[index]),
    ];

    context.beginPath();
    const [firstX, firstY] = point(front[0]);
    context.moveTo(scaleX(REFERENCE[0]), firstY);
    context.lineTo(firstX, firstY);
    for (let position = 1; position < front.length; position += 1) {
      const [previousX] = point(front[position - 1]);
      const [x, y] = point(front[position]);
      context.lineTo(previousX, y);
      context.lineTo(x, y);
    }
    const [lastX] = point(front[front.length - 1]);
    context.lineTo(lastX, scaleY(REFERENCE[1]));
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = 2;
    context.strokeStyle = rgba(palette.accent, opacity);
    context.stroke();

    for (let position = 0; position < front.length; position += 1) {
      drawFrontMarker(context, point(front[position]), opacity);
    }
  }

  function drawFrontMarker(context, point, opacity) {
    context.beginPath();
    context.arc(point[0], point[1], 2.8, 0, Math.PI * 2);
    context.fillStyle = rgba(palette.accent, 0.86 * opacity);
    context.fill();
  }

  function drawReference(context, scaleX, scaleY) {
    const x = scaleX(REFERENCE[0]);
    const y = scaleY(REFERENCE[1]);
    context.beginPath();
    context.arc(x, y, 4.3, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.lineWidth = 1.6;
    context.strokeStyle = color(palette.ink);
    context.stroke();
    context.font = `500 10px ${palette.fontBody}`;
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.fillStyle = color(palette.muted);
    context.fillText("r = (0, 0)", x + 8, y - 6);
  }

  function drawAxisLabels(context, margin, plotWidth, plotHeight, compact) {
    context.save();
    context.font = `600 ${compact ? 11 : 12}px ${palette.fontBody}`;
    context.fillStyle = color(palette.muted);
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText("y₁", margin.left + plotWidth, margin.top + plotHeight + (compact ? 44 : 50));
    context.translate(compact ? 11 : 15, margin.top);
    context.rotate(-Math.PI / 2);
    context.textAlign = "right";
    context.textBaseline = "top";
    context.fillText("y₂", 0, 0);
    context.restore();
  }

  function drawInputField(canvas, surface, values, lineColor) {
    const fitted = fitCanvas(canvas);
    if (!fitted) return;
    const { context, width, height } = fitted;
    const contourScale = Math.max(1, Math.min(1.7, width / 270));
    const image = surface.image;

    for (let pixel = 0; pixel < FIELD_COUNT; pixel += 1) {
      const value = values[SAMPLE_COUNT + pixel];
      const normalizedValue = 0.5 + 0.5 * Math.tanh(value / 1.25);
      const mixed = blendRgb(palette.bg, lineColor, 0.02 + 0.68 * normalizedValue);
      const offset = pixel * 4;
      image.data[offset] = mixed[0];
      image.data[offset + 1] = mixed[1];
      image.data[offset + 2] = mixed[2];
      image.data[offset + 3] = 255;
    }
    surface.context.putImageData(image, 0, 0);

    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(surface.canvas, 0, 0, width, height);

    [-1.2, 0, 1.2].forEach((level) => {
      drawFieldContour(
        context,
        values,
        level,
        width,
        height,
        lineColor,
        level === 0 ? 0.44 : 0.22,
        (level === 0 ? 1.1 : 0.8) * contourScale,
      );
    });

    drawSobolSiteTexture(context, surface, width, height, canvas);

    const frontBlend = smootherStep(frontBlendElapsed / FRONT_BLEND_DURATION);
    if (previousFront.length && frontBlend < 1) {
      drawParetoSites(context, previousFront, width, height, lineColor, 1 - frontBlend);
    }
    drawParetoSites(context, currentFront, width, height, lineColor, frontBlend);
    drawTrackedInputSite(context, width, height, lineColor);

  }

  function drawSobolSiteTexture(context, surface, width, height, targetCanvas) {
    const textureKey = `${targetCanvas.width}:${targetCanvas.height}:${palette.card.join(",")}`;
    if (surface.siteTextureKey !== textureKey) {
      surface.siteCanvas.width = targetCanvas.width;
      surface.siteCanvas.height = targetCanvas.height;
      const siteContext = surface.siteCanvas.getContext("2d");
      const deviceScale = targetCanvas.width / width;
      siteContext.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      siteContext.clearRect(0, 0, width, height);
      const siteSize = Math.max(0.7, width * 0.0015);
      siteContext.beginPath();
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        const x = sobolInputs[0][index] * width;
        const y = (1 - sobolInputs[1][index]) * height;
        siteContext.rect(x - siteSize / 2, y - siteSize / 2, siteSize, siteSize);
      }
      siteContext.fillStyle = rgba(palette.card, 0.18);
      siteContext.fill();
      surface.siteTextureKey = textureKey;
    }
    context.drawImage(surface.siteCanvas, 0, 0, width, height);
  }

  function drawParetoSites(context, front, width, height, lineColor, opacity) {
    if (opacity <= 0) return;
    const radius = Math.max(2.2, width * 0.0072);
    for (const index of front) {
      const x = sobolInputs[0][index] * width;
      const y = (1 - sobolInputs[1][index]) * height;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = rgba(lineColor, 0.72 * opacity);
      context.fill();
    }
  }

  function drawTrackedInputSite(context, width, height, lineColor) {
    if (trackedIndex < 0) return;
    const x = sobolInputs[0][trackedIndex] * width;
    const y = (1 - sobolInputs[1][trackedIndex]) * height;
    const radius = Math.max(4.4, width * 0.0105);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.lineWidth = Math.max(1.6, radius * 0.28);
    context.strokeStyle = color(palette.ink);
    context.stroke();
    context.beginPath();
    context.arc(x, y, Math.max(1.6, radius * 0.3), 0, Math.PI * 2);
    context.fillStyle = color(lineColor);
    context.fill();
  }

  function drawFieldContour(context, values, level, width, height, lineColor, alpha, lineWidth) {
    const scaleX = width / (FIELD_RESOLUTION - 1);
    const scaleY = height / (FIELD_RESOLUTION - 1);
    const fieldValue = (column, row) => values[SAMPLE_COUNT + row * FIELD_RESOLUTION + column];
    const interpolate = (first, second) => {
      if (Math.abs(second - first) < 1e-9) return 0.5;
      return Math.max(0, Math.min(1, (level - first) / (second - first)));
    };

    context.beginPath();
    for (let row = 0; row < FIELD_RESOLUTION - 1; row += 1) {
      for (let column = 0; column < FIELD_RESOLUTION - 1; column += 1) {
        const topLeftValue = fieldValue(column, row);
        const topRightValue = fieldValue(column + 1, row);
        const bottomRightValue = fieldValue(column + 1, row + 1);
        const bottomLeftValue = fieldValue(column, row + 1);
        let cell = 0;
        if (topLeftValue > level) cell |= 8;
        if (topRightValue > level) cell |= 4;
        if (bottomRightValue > level) cell |= 2;
        if (bottomLeftValue > level) cell |= 1;
        if (cell === 0 || cell === 15) continue;

        const left = column * scaleX;
        const top = row * scaleY;
        const right = (column + 1) * scaleX;
        const bottom = (row + 1) * scaleY;
        const edgeTop = () => [left + scaleX * interpolate(topLeftValue, topRightValue), top];
        const edgeRight = () => [right, top + scaleY * interpolate(topRightValue, bottomRightValue)];
        const edgeBottom = () => [left + scaleX * interpolate(bottomLeftValue, bottomRightValue), bottom];
        const edgeLeft = () => [left, top + scaleY * interpolate(topLeftValue, bottomLeftValue)];
        const segment = (first, second) => {
          context.moveTo(first[0], first[1]);
          context.lineTo(second[0], second[1]);
        };

        switch (cell) {
          case 1: case 14: segment(edgeLeft(), edgeBottom()); break;
          case 2: case 13: segment(edgeBottom(), edgeRight()); break;
          case 3: case 12: segment(edgeLeft(), edgeRight()); break;
          case 4: case 11: segment(edgeTop(), edgeRight()); break;
          case 5: segment(edgeLeft(), edgeTop()); segment(edgeBottom(), edgeRight()); break;
          case 6: case 9: segment(edgeTop(), edgeBottom()); break;
          case 7: case 8: segment(edgeLeft(), edgeTop()); break;
          case 10: segment(edgeLeft(), edgeBottom()); segment(edgeTop(), edgeRight()); break;
        }
      }
    }

    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    context.strokeStyle = rgba(lineColor, alpha);
    context.stroke();
  }

  function findParetoFront(firstObjective, secondObjective) {
    const candidates = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      if (firstObjective[index] >= REFERENCE[0] && secondObjective[index] >= REFERENCE[1]) {
        candidates.push(index);
      }
    }
    candidates.sort((a, b) => {
      const firstDifference = firstObjective[b] - firstObjective[a];
      return Math.abs(firstDifference) > 1e-10
        ? firstDifference
        : secondObjective[b] - secondObjective[a];
    });

    const front = [];
    let bestSecondObjective = -Infinity;
    for (const index of candidates) {
      if (secondObjective[index] > bestSecondObjective + 1e-7) {
        front.push(index);
        bestSecondObjective = secondObjective[index];
      }
    }
    front.reverse();
    return front;
  }

  function selectTrackedSite(event, canvas) {
    const bounds = canvas.getBoundingClientRect();
    const xOne = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const xTwo = Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height));
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const dx = sobolInputs[0][index] - xOne;
      const dy = sobolInputs[1][index] - xTwo;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    trackedIndex = nearestIndex;
    resetTraceBuffer();
    pushTrackedPoint();
    updateTraceControls();
    requestDraw();
  }

  function updateTrackedTrail(deltaTime) {
    if (trackedIndex < 0) return;
    traceSampleElapsed += deltaTime;
    if (traceSampleElapsed < TRACE_SAMPLE_INTERVAL) return;
    traceSampleElapsed %= TRACE_SAMPLE_INTERVAL;
    pushTrackedPoint();
  }

  function pushTrackedPoint() {
    if (trackedIndex < 0) return;
    const point = [
      objectives[0].display[trackedIndex],
      objectives[1].display[trackedIndex],
    ];
    if (traceLength < TRACE_MAX_POINTS) {
      traceBuffer[(traceStart + traceLength) % TRACE_MAX_POINTS] = point;
      traceLength += 1;
    } else {
      traceBuffer[traceStart] = point;
      traceStart = (traceStart + 1) % TRACE_MAX_POINTS;
    }
  }

  function tracePointAt(position) {
    return traceBuffer[(traceStart + position) % TRACE_MAX_POINTS];
  }

  function resetTraceBuffer() {
    traceStart = 0;
    traceLength = 0;
    traceSampleElapsed = 0;
  }

  function clearTrackedSite() {
    trackedIndex = -1;
    resetTraceBuffer();
    updateTraceControls();
  }

  function updateTraceControls() {
    const hasTrackedSite = trackedIndex >= 0;
    clearTraceButton.disabled = !hasTrackedSite;
    traceLegend.hidden = !hasTrackedSite;
  }

  function buildEvaluationInputs() {
    const first = new Float32Array(VALUE_COUNT);
    const second = new Float32Array(VALUE_COUNT);
    first.set(sobolInputs[0]);
    second.set(sobolInputs[1]);
    for (let row = 0; row < FIELD_RESOLUTION; row += 1) {
      const xTwo = 1 - row / (FIELD_RESOLUTION - 1);
      for (let column = 0; column < FIELD_RESOLUTION; column += 1) {
        const index = SAMPLE_COUNT + row * FIELD_RESOLUTION + column;
        first[index] = column / (FIELD_RESOLUTION - 1);
        second[index] = xTwo;
      }
    }
    return [first, second];
  }

  function makeSobolSequence(count) {
    const firstDimension = new Float64Array(count);
    const secondDimension = new Float64Array(count);
    const firstDirections = new Uint32Array(32);
    const secondDirections = new Uint32Array(32);
    for (let bit = 0; bit < 32; bit += 1) firstDirections[bit] = (1 << (31 - bit)) >>> 0;
    secondDirections[0] = 0x80000000;
    for (let bit = 1; bit < 32; bit += 1) {
      secondDirections[bit] = (secondDirections[bit - 1] ^ (secondDirections[bit - 1] >>> 1)) >>> 0;
    }

    let firstState = 0;
    let secondState = 0;
    for (let index = 0; index < count; index += 1) {
      let trailingOnes = 0;
      let value = index;
      while ((value & 1) === 1) {
        trailingOnes += 1;
        value >>>= 1;
      }
      firstState = (firstState ^ firstDirections[trailingOnes]) >>> 0;
      secondState = (secondState ^ secondDirections[trailingOnes]) >>> 0;
      firstDimension[index] = firstState / 4294967296;
      secondDimension[index] = secondState / 4294967296;
    }
    return [firstDimension, secondDimension];
  }

  function normalSample() {
    if (spareNormal !== null) {
      const sample = spareNormal;
      spareNormal = null;
      return sample;
    }
    let first = 0;
    let second = 0;
    while (first === 0) first = random();
    while (second === 0) second = random();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    spareNormal = magnitude * Math.sin(2 * Math.PI * second);
    return magnitude * Math.cos(2 * Math.PI * second);
  }

  function randomSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      const seed = new Uint32Array(1);
      window.crypto.getRandomValues(seed);
      return seed[0];
    }
    return (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
  }

  function createRandomSource(seed) {
    let state = seed >>> 0;
    return function nextRandom() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleMean(values) {
    let sum = 0;
    for (let index = 0; index < SAMPLE_COUNT; index += 1) sum += values[index];
    return sum / SAMPLE_COUNT;
  }

  function smootherStep(value) {
    const progress = Math.max(0, Math.min(1, value));
    return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
  }

  function fitCanvas(canvas) {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(bounds.width * deviceScale);
    const pixelHeight = Math.round(bounds.height * deviceScale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    return { context, width: bounds.width, height: bounds.height };
  }

  function formatTick(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function readPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: parseColor(styles.getPropertyValue("--bg"), [251, 250, 247]),
      accent: parseColor(styles.getPropertyValue("--accent"), [31, 78, 121]),
      orange: parseColor(styles.getPropertyValue("--viz-orange"), [255, 127, 14]),
      cloud: parseColor(styles.getPropertyValue("--viz-cloud"), [43, 101, 148]),
      cloudAlpha: Number.parseFloat(styles.getPropertyValue("--viz-cloud-opacity")) || 0.19,
      card: parseColor(styles.getPropertyValue("--bg-card"), [255, 255, 255]),
      ink: parseColor(styles.getPropertyValue("--ink"), [28, 26, 23]),
      muted: parseColor(styles.getPropertyValue("--muted"), [108, 103, 96]),
      subtle: parseColor(styles.getPropertyValue("--subtle"), [154, 148, 138]),
      line: parseColor(styles.getPropertyValue("--line"), [232, 227, 217]),
      fontBody: styles.getPropertyValue("--font-body").trim() || "sans-serif",
    };
  }

  function parseColor(value, fallback) {
    const normalized = value.trim();
    if (normalized.startsWith("#")) {
      let hex = normalized.slice(1);
      if (hex.length === 3) hex = hex.split("").map((digit) => digit + digit).join("");
      const number = Number.parseInt(hex, 16);
      if (Number.isFinite(number)) return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
    }
    const match = normalized.match(/[\d.]+/g);
    if (match && match.length >= 3) return match.slice(0, 3).map(Number);
    return fallback;
  }

  function color(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function rgba(rgb, alpha) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  function blendRgb(first, second, amount) {
    return first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount));
  }
})();
