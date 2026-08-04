/* Interactive, dependency-free diagrams for the flow matching note. */
(function () {
  "use strict";

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SIGMA_MIN = 0.02;
  let palette = readPalette();
  const instances = [];

  const pathLab = document.querySelector("[data-flow-path]");
  const regressionLab = document.querySelector("[data-flow-regression]");
  const imageLab = document.querySelector("[data-flow-image]");
  if (pathLab) instances.push(createPathLab(pathLab));
  if (regressionLab) instances.push(createRegressionLab(regressionLab));
  if (imageLab) instances.push(createImageLab(imageLab));

  window.addEventListener("themechange", () => {
    palette = readPalette();
    instances.forEach((instance) => instance.draw());
  });

  window.__flowVisualization = {
    getState() {
      return Object.fromEntries(instances.map((instance) => [instance.name, instance.getState()]));
    },
  };

  /* ─────────────────────────────────────────────
     01 · Probability path, conditional and marginal fields
  ───────────────────────────────────────────── */

  function createPathLab(lab) {
    const canvas = lab.querySelector("[data-flow-canvas]");
    const tabs = Array.from(lab.querySelectorAll("[data-flow-mode]"));
    const panels = Array.from(lab.querySelectorAll("[data-flow-panel]"));
    const datasetButtons = Array.from(lab.querySelectorAll("[data-flow-dataset]"));
    const playButton = lab.querySelector("[data-flow-play]");
    const restartButton = lab.querySelector("[data-flow-restart]");
    const timeInput = lab.querySelector("[data-flow-time]");
    const stepsInput = lab.querySelector("[data-flow-steps]");
    const blurInput = lab.querySelector("[data-flow-blur]");
    const sketchEditor = lab.querySelector("[data-flow-sketch]");
    const VIEW_HALF = 2.55;
    const modeTitles = {
      path: "One straight conditional path",
      conditional: "Conditional field toward a single sample",
      marginal: "Marginal field learned by regression",
      sample: "Integrating the learned ODE",
    };

    let dataset = "moons";
    let mode = "path";
    let anchors = buildDataset(dataset);
    let steps = Number(stepsInput.value);
    let blur = Number(blurInput.value);
    let stepIndex = 0;
    let focus = 0;
    let sketchMessage = "";
    let running = false;
    let visible = true;
    let lastTime = 0;
    let accumulator = 0;
    let frameId = 0;
    let particles = resetParticles();

    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible && running) schedule();
    }, { rootMargin: "100px" });
    observer.observe(lab);
    new ResizeObserver(draw).observe(canvas);

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectMode(tab.dataset.flowMode));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        tabs[next].focus();
        selectMode(tabs[next].dataset.flowMode);
      });
    });

    datasetButtons.forEach((button) => button.addEventListener("click", () => {
      dataset = button.dataset.flowDataset;
      datasetButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      sketchEditor.hidden = dataset !== "sketch";
      lab.querySelector(".flow-stage").classList.toggle("is-sketch", dataset === "sketch");
      anchors = buildDataset(dataset);
      sketchMessage = "";
      restart();
    }));

    playButton.addEventListener("click", () => {
      if (!running && stepIndex >= steps) restart();
      running = !running;
      syncPlayButton();
      if (running) schedule();
    });
    restartButton.addEventListener("click", () => {
      running = false;
      syncPlayButton();
      restart();
    });
    timeInput.addEventListener("input", () => {
      running = false;
      syncPlayButton();
      setStep(Math.round(Number(timeInput.value) * steps));
    });
    stepsInput.addEventListener("input", () => {
      const fraction = stepIndex / steps;
      steps = Number(stepsInput.value);
      setStep(Math.round(fraction * steps));
    });
    blurInput.addEventListener("input", () => {
      blur = Number(blurInput.value);
      setStep(stepIndex);
    });
    lab.querySelector("[data-flow-sketch-clear]").addEventListener("click", () => {
      anchors = [];
      sketchMessage = "Empty canvas — click to place data.";
      restart();
    });
    lab.querySelector("[data-flow-sketch-reset]").addEventListener("click", () => {
      anchors = buildDataset("sketch");
      sketchMessage = "";
      restart();
    });
    canvas.addEventListener("pointerdown", handleCanvasPointer);
    canvas.addEventListener("pointermove", (event) => {
      if (event.buttons === 1 && dataset === "sketch") handleCanvasPointer(event);
    });

    syncOutputs();
    requestAnimationFrame(draw);

    function resetParticles() {
      const random = randomSource(717);
      return Array.from({ length: 150 }, (unused, index) => {
        const noise = [gaussian(random), gaussian(random)];
        return {
          noise,
          point: noise.slice(),
          pair: anchors.length ? index % anchors.length : 0,
          trail: [noise.slice()],
        };
      });
    }

    function restart() {
      particles = resetParticles();
      stepIndex = 0;
      focus = 0;
      syncOutputs();
      draw();
    }

    function setStep(next) {
      const target = clamp(Math.round(next), 0, steps);
      particles.forEach((particle) => {
        particle.point = particle.noise.slice();
        particle.trail = [particle.noise.slice()];
      });
      for (let index = 0; index < target; index += 1) advance(index);
      stepIndex = target;
      syncOutputs();
      draw();
    }

    function advance(fromStep) {
      if (anchors.length === 0) return;
      const dt = 1 / steps;
      const t = fromStep / steps;
      particles.forEach((particle) => {
        const velocity = marginalVelocity(particle.point, anchors, t, blur);
        particle.point = [particle.point[0] + dt * velocity[0], particle.point[1] + dt * velocity[1]];
        particle.trail.push(particle.point.slice());
      });
    }

    function selectMode(nextMode) {
      mode = nextMode;
      tabs.forEach((tab) => {
        const active = tab.dataset.flowMode === mode;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel) => {
        const active = panel.dataset.flowPanel === mode;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });
      lab.querySelector("[data-flow-view-title]").textContent = modeTitles[mode];
      draw();
    }

    function schedule() {
      if (!frameId && running && visible) frameId = requestAnimationFrame(tick);
    }

    function tick(time) {
      frameId = 0;
      if (!lastTime) lastTime = time;
      accumulator += Math.min(120, time - lastTime);
      lastTime = time;
      const interval = prefersReducedMotion.matches ? 150 : Math.max(26, 900 / steps);
      while (accumulator >= interval && stepIndex < steps) {
        advance(stepIndex);
        stepIndex += 1;
        accumulator -= interval;
      }
      syncOutputs();
      draw();
      if (stepIndex >= steps) {
        running = false;
        accumulator = 0;
        syncPlayButton();
        return;
      }
      schedule();
    }

    function syncPlayButton() {
      playButton.classList.toggle("is-playing", running);
      lab.classList.toggle("is-running", running);
      lab.querySelector("[data-flow-play-label]").textContent = running ? "Pause" : "Play";
      if (!running) lastTime = 0;
    }

    function syncOutputs() {
      const t = stepIndex / steps;
      timeInput.value = String(t);
      lab.querySelector("[data-flow-time-output]").textContent = `t = ${t.toFixed(2)}`;
      lab.querySelector("[data-flow-steps-output]").textContent = `${steps} steps`;
      lab.querySelector("[data-flow-blur-output]").textContent = `σ = ${blur.toFixed(2)}`;
      lab.querySelector("[data-flow-step]").textContent = `step ${stepIndex} / ${steps}`;
      lab.querySelector("[data-flow-nfe]").textContent = `${stepIndex} field evaluations`;
      lab.querySelector("[data-flow-anchors]").textContent = String(anchors.length);
      lab.querySelector("[data-flow-spread]").textContent = anchors.length
        ? spread(particles.map((particle) => particle.point)).toFixed(2)
        : "—";
      lab.querySelector("[data-flow-sigma]").textContent = pathSigma(t).toFixed(2);
      if (dataset === "sketch") {
        lab.querySelector("[data-flow-sketch-status]").textContent =
          sketchMessage || `${anchors.length} data point${anchors.length === 1 ? "" : "s"}`;
      }
    }

    function handleCanvasPointer(event) {
      const rect = canvas.getBoundingClientRect();
      const plot = plotBox(rect);
      if (!inBox(event.offsetX, event.offsetY, plot)) return;
      const point = unproject([event.offsetX, event.offsetY], plot, viewFor(plot, VIEW_HALF));

      /* In the conditional view a click re-aims the field at the nearest data sample. */
      if (mode === "conditional" && anchors.length > 0) {
        focus = anchors.reduce(
          (best, anchor, index) => (distance(anchor, point) < distance(anchors[best], point) ? index : best),
          0,
        );
        draw();
        return;
      }
      /* In the path view it promotes the nearest drawn pair to the highlighted one. */
      if (mode === "path" && anchors.length > 0) {
        const shown = pairIndices();
        const t = stepIndex / steps;
        focus = shown.reduce(
          (best, index, position) => {
            const current = distance(displayPoint(particles[index], t), point);
            return current < distance(displayPoint(particles[shown[best]], t), point) ? position : best;
          },
          0,
        );
        draw();
        return;
      }
      if (dataset !== "sketch") return;
      if (anchors.length >= 240) {
        sketchMessage = "240 points is the sandbox limit.";
        syncOutputs();
        return;
      }
      if (anchors.some((anchor) => distance(anchor, point) < 0.1)) return;
      anchors.push(point);
      sketchMessage = "";
      particles.forEach((particle, index) => { particle.pair = index % anchors.length; });
      setStep(stepIndex);
    }

    function plotBox(rect) {
      return { x: 30, y: 48, width: rect.width - 46, height: rect.height - 74 };
    }

    function draw() {
      const surface = fitCanvas(canvas);
      if (!surface) return;
      const { context, width, height } = surface;
      context.clearRect(0, 0, width, height);
      const plot = plotBox({ width, height });
      const view = viewFor(plot, VIEW_HALF);
      const project = makeProjector(plot, view);
      const t = stepIndex / steps;

      drawGrid(context, plot, view);
      drawTimeRail(context, plot, t, "noise · t = 0", "data · t = 1");
      if (anchors.length === 0) {
        context.fillStyle = color(palette.muted);
        context.font = `500 12px ${palette.fontBody}`;
        context.fillText("Click inside the frame to place data points.", plot.x + 16, plot.y + 28);
        drawFrame(context, plot);
        return;
      }

      /* The conditional view shows the single Gaussian it is aimed at, not the mixture. */
      const densityAnchors = mode === "conditional" ? [anchors[focusAnchor()]] : anchors;
      drawDensity(context, plot, view, densityAnchors, t, blur);
      drawAnchors(context, project);

      context.save();
      context.beginPath();
      context.rect(plot.x, plot.y, plot.width, plot.height);
      context.clip();

      if (mode === "conditional") drawConditionalBall(context, plot, view, project, t);
      if (mode === "conditional" || mode === "marginal") drawField(context, plot, view, project, t);
      if (mode === "path") drawPairs(context, project, t);
      if (mode === "sample") drawTrails(context, project);
      drawParticles(context, project, t);

      context.restore();
      drawFrame(context, plot);
    }

    function displayPoint(particle, t) {
      if (mode === "path" || mode === "conditional") {
        const anchor = anchors[particle.pair % anchors.length];
        const sigma = pathSigma(t);
        return [sigma * particle.noise[0] + t * anchor[0], sigma * particle.noise[1] + t * anchor[1]];
      }
      return particle.point;
    }

    function drawAnchors(context, project) {
      anchors.forEach((anchor, index) => {
        const [x, y] = project(anchor);
        const highlighted = mode === "conditional" && index === focusAnchor();
        context.beginPath();
        context.arc(x, y, highlighted ? 4.5 : 1.8, 0, Math.PI * 2);
        context.fillStyle = highlighted ? color(palette.orange) : rgba(palette.ink, 0.2);
        context.fill();
      });
    }

    /* The Gaussian ball p_t(· | x₁) that the highlighted sample drags along with it. */
    function drawConditionalBall(context, plot, view, project, t) {
      const anchor = anchors[focusAnchor()];
      const radius = pathStats(t, blur).scale;
      const center = project([t * anchor[0], t * anchor[1]]);
      context.beginPath();
      context.ellipse(
        center[0],
        center[1],
        (radius / view.width) * plot.width,
        (radius / view.height) * plot.height,
        0,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = rgba(palette.orange, 0.55);
      context.setLineDash([4, 4]);
      context.lineWidth = 1.2;
      context.stroke();
      context.setLineDash([]);
    }

    function drawField(context, plot, view, project, t) {
      const columns = Math.round(clamp(plot.width / 46, 8, 18));
      const rows = Math.round(clamp(plot.height / 46, 6, 14));
      const anchor = anchors[focusAnchor()];
      const reach = (view.width / columns) * 0.86;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const point = [
            view.x + ((column + 0.5) / columns) * view.width,
            view.y + (1 - (row + 0.5) / rows) * view.height,
          ];
          const velocity = mode === "conditional"
            ? conditionalVelocity(point, anchor, t, blur)
            : marginalVelocity(point, anchors, t, blur);
          const length = norm(velocity);
          if (length < 1e-4) continue;
          const alpha = mode === "conditional" ? 0.48 : clamp(0.24 + length * 0.14, 0.24, 0.75);
          drawArrow(
            context,
            project(point),
            project(offsetBy(point, velocity, reach)),
            mode === "conditional" ? palette.orange : palette.accent,
            alpha,
            1.1,
          );
        }
      }
    }

    /* One pair is the protagonist; the rest are there to show it is not special. */
    function pairIndices() {
      return particles.map((particle, index) => index).filter((index) => index % 26 === 0);
    }

    function drawPairs(context, project, t) {
      const sigma = pathSigma(t);
      const shown = pairIndices();
      const hero = shown[focus % shown.length];
      shown.forEach((index) => {
        const particle = particles[index];
        const anchor = anchors[particle.pair % anchors.length];
        const lead = index === hero;
        const start = project(particle.noise);
        const end = project(anchor);
        context.beginPath();
        context.moveTo(start[0], start[1]);
        context.lineTo(end[0], end[1]);
        context.strokeStyle = rgba(palette.ink, lead ? 0.5 : 0.14);
        context.setLineDash(lead ? [5, 4] : [3, 6]);
        context.lineWidth = lead ? 1.3 : 1;
        context.stroke();
        context.setLineDash([]);

        /* The conditional velocity of a straight path is the same vector at every t. */
        const current = [sigma * particle.noise[0] + t * anchor[0], sigma * particle.noise[1] + t * anchor[1]];
        const velocity = [
          anchor[0] - (1 - SIGMA_MIN) * particle.noise[0],
          anchor[1] - (1 - SIGMA_MIN) * particle.noise[1],
        ];
        drawArrow(
          context,
          project(current),
          project(offsetBy(current, velocity, lead ? 0.62 : 0.42)),
          palette.orange,
          lead ? 0.95 : 0.34,
          lead ? 1.8 : 1.1,
        );

        if (!lead) return;
        context.font = `600 11px ${palette.fontBody}`;
        context.fillStyle = color(palette.muted);
        context.textAlign = "center";
        const here = project(current);
        context.fillText("x₀", start[0], start[1] - 11);
        context.fillText("x₁", end[0], end[1] - 11);
        context.fillText("xₜ", here[0], here[1] - 12);
        context.textAlign = "left";
        context.beginPath();
        context.arc(here[0], here[1], 4.2, 0, Math.PI * 2);
        context.fillStyle = color(palette.ink);
        context.fill();
        [[start, palette.subtle], [end, palette.orange]].forEach(([position, dotColor]) => {
          context.beginPath();
          context.arc(position[0], position[1], 4, 0, Math.PI * 2);
          context.fillStyle = color(palette.bg);
          context.fill();
          context.strokeStyle = color(dotColor);
          context.lineWidth = 1.6;
          context.stroke();
        });
      });
    }

    function drawTrails(context, project) {
      particles.forEach((particle) => {
        const trail = particle.trail;
        if (trail.length < 2) return;
        for (let index = 1; index < trail.length; index += 1) {
          const [fromX, fromY] = project(trail[index - 1]);
          const [toX, toY] = project(trail[index]);
          context.beginPath();
          context.moveTo(fromX, fromY);
          context.lineTo(toX, toY);
          context.strokeStyle = rgba(palette.accent, 0.07 + 0.24 * (index / trail.length));
          context.lineWidth = 1;
          context.stroke();
        }
      });
    }

    function drawParticles(context, project, t) {
      const sparse = mode === "path" || mode === "conditional";
      particles.forEach((particle, index) => {
        if (sparse && index % 3 !== 0 && index % 26 !== 0) return;
        const [x, y] = project(displayPoint(particle, t));
        const emphasised = mode === "path" && index % 26 === 0;
        context.beginPath();
        context.arc(x, y, emphasised ? 3.2 : 2.1, 0, Math.PI * 2);
        context.fillStyle = color(palette.bg);
        context.fill();
        context.strokeStyle = color(emphasised ? palette.ink : palette.cloud);
        context.lineWidth = emphasised ? 1.3 : 1;
        context.stroke();
      });
    }

    function focusAnchor() {
      return anchors.length ? focus % anchors.length : 0;
    }

    return {
      name: "path",
      draw,
      getState: () => ({
        dataset,
        mode,
        steps,
        stepIndex,
        time: stepIndex / steps,
        blur,
        anchors: anchors.length,
        running,
        finite: particles.every((particle) => particle.point.every(Number.isFinite)),
        spread: spread(particles.map((particle) => particle.point)),
      }),
    };
  }

  /* ─────────────────────────────────────────────
     02 · Conditional flow matching regression
  ───────────────────────────────────────────── */

  function createRegressionLab(lab) {
    const canvas = lab.querySelector("[data-regression-canvas]");
    const timeInput = lab.querySelector("[data-regression-time]");
    const spreadInput = lab.querySelector("[data-regression-spread]");
    const resetButton = lab.querySelector("[data-regression-reset]");
    const data = buildRegressionData();
    const defaultQuery = [0, 0.1];
    const VIEW_HALF = 1.7;

    let query = defaultQuery.slice();
    let t = Number(timeInput.value);
    let separation = Number(spreadInput.value);
    let dragging = false;

    new ResizeObserver(draw).observe(canvas);
    timeInput.addEventListener("input", () => { t = Number(timeInput.value); update(); });
    spreadInput.addEventListener("input", () => { separation = Number(spreadInput.value); update(); });
    resetButton.addEventListener("click", () => { query = defaultQuery.slice(); update(); });
    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      moveQuery(event);
    });
    canvas.addEventListener("pointermove", (event) => { if (dragging) moveQuery(event); });
    canvas.addEventListener("pointerup", (event) => {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("keydown", (event) => {
      const nudge = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[event.key];
      if (!nudge) return;
      event.preventDefault();
      query = [clamp(query[0] + nudge[0], -2.4, 2.4), clamp(query[1] + nudge[1], -2, 2)];
      update();
    });

    update();
    requestAnimationFrame(draw);

    function targets() {
      return data.map(([x, y]) => [x * separation, y]);
    }

    function moveQuery(event) {
      const rect = canvas.getBoundingClientRect();
      const plot = mainBox(rect);
      const view = viewFor(plot, VIEW_HALF);
      const point = unproject([event.offsetX, event.offsetY], plot, view);
      query = [clamp(point[0], view.x, view.x + view.width), clamp(point[1], view.y, view.y + view.height)];
      update();
    }

    function statistics() {
      const points = targets();
      const weights = posteriorWeights(query, points, t, 0);
      const vectors = points.map((point) => conditionalVelocity(query, point, t, 0));
      const mean = vectors.reduce(
        (sum, vector, index) => [sum[0] + weights[index] * vector[0], sum[1] + weights[index] * vector[1]],
        [0, 0],
      );
      const variance = vectors.reduce(
        (sum, vector, index) => sum + weights[index] * ((vector[0] - mean[0]) ** 2 + (vector[1] - mean[1]) ** 2),
        0,
      );
      const effective = 1 / weights.reduce((sum, weight) => sum + weight * weight, 0);
      return { points, weights, vectors, mean, variance, effective };
    }

    function update() {
      const { mean, variance, effective } = statistics();
      lab.querySelector("[data-regression-time-output]").textContent = `t = ${t.toFixed(2)}`;
      lab.querySelector("[data-regression-spread-output]").textContent = `gap = ${separation.toFixed(2)}`;
      lab.querySelector("[data-regression-query]").textContent =
        `x = (${query[0].toFixed(2)}, ${query[1].toFixed(2)})`;
      lab.querySelector("[data-regression-marginal]").textContent =
        `(${mean[0].toFixed(2)}, ${mean[1].toFixed(2)})`;
      lab.querySelector("[data-regression-gap]").textContent = variance.toFixed(2);
      lab.querySelector("[data-regression-effective]").textContent = effective.toFixed(1);
      draw();
    }

    /* Two square panels: side by side when there is room, stacked when there is not. */
    function boxes(rect) {
      const top = 34;
      if (rect.width < 520) {
        const gap = 48;
        const size = Math.min(rect.width - 16, (rect.height - top - 28 - gap) / 2);
        const offset = (rect.width - size) / 2;
        return {
          main: { x: offset, y: top, width: size, height: size },
          velocity: { x: offset, y: top + size + gap, width: size, height: size },
        };
      }
      const gap = Math.max(34, rect.width * 0.05);
      const available = rect.width - gap - 24;
      const size = Math.min(available / 2, rect.height - top - 30);
      const offset = Math.max(12, (rect.width - (size * 2 + gap)) / 2);
      return {
        main: { x: offset, y: top, width: size, height: size },
        velocity: { x: offset + size + gap, y: top, width: size, height: size },
      };
    }

    function mainBox(rect) { return boxes(rect).main; }

    function draw() {
      const surface = fitCanvas(canvas);
      if (!surface) return;
      const { context, width, height } = surface;
      context.clearRect(0, 0, width, height);
      const { main, velocity } = boxes({ width, height });
      const view = viewFor(main, VIEW_HALF);
      const project = makeProjector(main, view);
      const { points, weights, vectors, mean, variance } = statistics();
      const order = weights.map((weight, index) => index).sort((a, b) => weights[b] - weights[a]);
      /* Weights are normalised by the largest one so the picture keeps its contrast
         whether the posterior is spread over every point or collapsed onto three. */
      const peak = weights[order[0]] || 1;
      const share = (index) => weights[index] / peak;

      drawBoxTitle(context, main, "sample space");
      drawGrid(context, main, view);
      context.save();
      context.beginPath();
      context.rect(main.x, main.y, main.width, main.height);
      context.clip();

      /* Raw data x₁ as open marks; the path means t·x₁ carry the posterior weight. */
      points.forEach((point, index) => {
        const [x, y] = project(point);
        context.beginPath();
        context.arc(x, y, 2.6, 0, Math.PI * 2);
        context.strokeStyle = rgba(palette.ink, 0.28);
        context.lineWidth = 1;
        context.stroke();
        const [meanX, meanY] = project([t * point[0], t * point[1]]);
        context.beginPath();
        context.arc(meanX, meanY, 1.8 + share(index) * 6, 0, Math.PI * 2);
        context.fillStyle = rgba(palette.orange, 0.1 + share(index) * 0.62);
        context.fill();
      });

      const origin = project(query);
      order.slice(0, 16).forEach((index) => {
        if (share(index) < 0.02) return;
        drawArrow(
          context,
          origin,
          project(offsetBy(query, vectors[index], 1.35)),
          palette.orange,
          0.12 + share(index) * 0.6,
          1,
        );
      });
      drawArrow(context, origin, project(offsetBy(query, mean, 1.5)), palette.accent, 1, 2.4);

      context.beginPath();
      context.arc(origin[0], origin[1], 5.5, 0, Math.PI * 2);
      context.fillStyle = color(palette.bg);
      context.fill();
      context.strokeStyle = color(palette.ink);
      context.lineWidth = 1.8;
      context.stroke();
      context.restore();
      drawFrame(context, main);
      caption(context, main, "x₁ data · sized dots are posterior weight");

      /* Velocity space: the same vectors as points, centred on the least-squares optimum. */
      drawBoxTitle(context, velocity, "velocity space");
      const relevant = order.filter((index) => share(index) > 0.02);
      const radius = Math.max(
        0.45,
        ...relevant.map((index) => norm([vectors[index][0] - mean[0], vectors[index][1] - mean[1]])),
      ) * 1.35;
      const velocityView = viewFor(velocity, radius, mean[0], mean[1]);
      const velocityProject = makeProjector(velocity, velocityView);
      drawGrid(context, velocity, velocityView);
      context.save();
      context.beginPath();
      context.rect(velocity.x, velocity.y, velocity.width, velocity.height);
      context.clip();

      /* Level sets of the weighted least-squares loss: circles around the minimiser. */
      const deviation = Math.sqrt(variance);
      [1.7, 1.1, 0.55].forEach((level) => {
        if (!(deviation > 0)) return;
        const focus = velocityProject(mean);
        context.beginPath();
        context.ellipse(
          focus[0],
          focus[1],
          ((deviation * level) / velocityView.width) * velocity.width,
          ((deviation * level) / velocityView.height) * velocity.height,
          0,
          0,
          Math.PI * 2,
        );
        context.strokeStyle = rgba(palette.accent, 0.32 - level * 0.11);
        context.lineWidth = 1;
        context.stroke();
      });
      vectors.forEach((vector, index) => {
        if (share(index) < 0.015) return;
        const [x, y] = velocityProject(vector);
        context.beginPath();
        context.arc(x, y, 2.2 + share(index) * 7, 0, Math.PI * 2);
        context.fillStyle = rgba(palette.orange, 0.12 + share(index) * 0.6);
        context.fill();
      });
      const center = velocityProject(mean);
      context.beginPath();
      context.moveTo(center[0] - 8, center[1]);
      context.lineTo(center[0] + 8, center[1]);
      context.moveTo(center[0], center[1] - 8);
      context.lineTo(center[0], center[1] + 8);
      context.strokeStyle = color(palette.accent);
      context.lineWidth = 2.2;
      context.stroke();
      context.restore();
      drawFrame(context, velocity);
      caption(context, velocity, "loss minimiser = weighted mean of the targets");
    }

    function caption(context, box, label) {
      context.fillStyle = color(palette.subtle);
      context.font = `500 10px ${palette.fontBody}`;
      context.textAlign = "left";
      context.fillText(label, box.x, box.y + box.height + 18);
    }

    return {
      name: "regression",
      draw,
      getState: () => {
        const { mean, variance, effective } = statistics();
        return {
          query: query.slice(),
          time: t,
          separation,
          marginalVelocity: mean,
          conditionalVariance: variance,
          effectiveSamples: effective,
          finite: mean.every(Number.isFinite),
        };
      },
    };
  }

  /* ─────────────────────────────────────────────
     03 · Application — generating images
  ───────────────────────────────────────────── */

  function createImageLab(lab) {
    const canvas = lab.querySelector("[data-image-canvas]");
    const playButton = lab.querySelector("[data-image-play]");
    const resampleButton = lab.querySelector("[data-image-resample]");
    const stepsInput = lab.querySelector("[data-image-steps]");
    const classButtons = Array.from(lab.querySelectorAll("[data-image-class]"));
    const SAMPLES = 12;
    const BLUR = 0.05;
    const library = buildGlyphLibrary();

    let label = "all";
    let steps = Number(stepsInput.value);
    let seed = 4711;
    let samples = drawNoise();
    let stepIndex = 0;
    let highlight = 0;
    let running = false;
    let visible = true;
    let lastTime = 0;
    let accumulator = 0;
    let frameId = 0;

    /* Twelve squares of noise say nothing, so the first scroll-past generates once. */
    let introduced = false;
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible && !introduced && stepIndex === 0) {
        introduced = true;
        running = true;
        syncPlayButton();
      }
      if (visible && running) schedule();
    }, { rootMargin: "100px" });
    observer.observe(lab);
    new ResizeObserver(draw).observe(canvas);

    classButtons.forEach((button) => button.addEventListener("click", () => {
      label = button.dataset.imageClass;
      classButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      restart();
    }));
    playButton.addEventListener("click", () => {
      if (!running && stepIndex >= steps) restart();
      running = !running;
      syncPlayButton();
      if (running) schedule();
    });
    resampleButton.addEventListener("click", () => {
      seed += 977;
      restart();
      running = true;
      syncPlayButton();
      schedule();
    });
    stepsInput.addEventListener("input", () => {
      steps = Number(stepsInput.value);
      restart();
    });
    canvas.addEventListener("pointerdown", (event) => {
      const rect = canvas.getBoundingClientRect();
      const tile = tileAt(event.offsetX, event.offsetY, rect);
      if (tile === null) return;
      highlight = tile;
      draw();
    });

    restart();
    requestAnimationFrame(draw);

    function anchors() {
      return label === "all" ? library.anchors : library.anchors.filter((entry) => entry.label === label);
    }

    function drawNoise() {
      const random = randomSource(seed);
      return Array.from({ length: SAMPLES }, () => {
        const noise = Array.from({ length: library.size }, () => gaussian(random));
        return { image: noise.slice(), frames: [noise.slice()] };
      });
    }

    function restart() {
      samples = drawNoise();
      stepIndex = 0;
      running = false;
      syncPlayButton();
      syncOutputs();
      draw();
    }

    function advance() {
      const points = anchors().map((entry) => entry.values);
      const dt = 1 / steps;
      const t = stepIndex / steps;
      samples.forEach((sample) => {
        const velocity = marginalVelocity(sample.image, points, t, BLUR);
        sample.image = sample.image.map((value, index) => value + dt * velocity[index]);
        sample.frames.push(sample.image.slice());
      });
      stepIndex += 1;
    }

    function schedule() {
      if (!frameId && running && visible) frameId = requestAnimationFrame(tick);
    }

    function tick(time) {
      frameId = 0;
      if (!lastTime) lastTime = time;
      accumulator += Math.min(140, time - lastTime);
      lastTime = time;
      const interval = prefersReducedMotion.matches ? 220 : Math.max(60, 1100 / steps);
      while (accumulator >= interval && stepIndex < steps) {
        advance();
        accumulator -= interval;
      }
      syncOutputs();
      draw();
      if (stepIndex >= steps) {
        running = false;
        accumulator = 0;
        syncPlayButton();
        return;
      }
      schedule();
    }

    function syncPlayButton() {
      playButton.classList.toggle("is-playing", running);
      lab.classList.toggle("is-running", running);
      lab.querySelector("[data-image-play-label]").textContent = running ? "Pause" : "Play";
      if (!running) lastTime = 0;
    }

    /* Which data image each sample ended up closest to — the honest way to read this panel. */
    function nearest(image) {
      let best = null;
      let bestDistance = Infinity;
      anchors().forEach((entry) => {
        let squared = 0;
        for (let index = 0; index < image.length; index += 1) squared += (image[index] - entry.values[index]) ** 2;
        if (squared < bestDistance) {
          bestDistance = squared;
          best = entry;
        }
      });
      return { label: best ? best.label : "—", distance: Math.sqrt(bestDistance / library.size) };
    }

    function syncOutputs() {
      const t = stepIndex / steps;
      const readings = samples.map((sample) => nearest(sample.image));
      const distinct = new Set(readings.map((reading) => reading.label)).size;
      const meanDistance = readings.reduce((sum, reading) => sum + reading.distance, 0) / readings.length;
      lab.querySelector("[data-image-step]").textContent = `step ${stepIndex} / ${steps}`;
      lab.querySelector("[data-image-time]").textContent = `t = ${t.toFixed(2)}`;
      lab.querySelector("[data-image-steps-output]").textContent = `${steps} steps`;
      lab.querySelector("[data-image-dim]").textContent = `${library.size}`;
      lab.querySelector("[data-image-classes]").textContent = String(distinct);
      lab.querySelector("[data-image-distance]").textContent = stepIndex === 0 ? "—" : meanDistance.toFixed(2);
    }

    function layout(rect) {
      const columns = rect.width < 620 ? 4 : 6;
      const rows = Math.ceil(SAMPLES / columns);
      const stripHeight = Math.min(96, rect.height * 0.26);
      const top = stripHeight + 62;
      const gap = 10;
      const tile = Math.min(
        (rect.width - 24 - gap * (columns - 1)) / columns,
        (rect.height - top - 26 - gap * (rows - 1)) / rows,
      );
      const offset = (rect.width - (tile * columns + gap * (columns - 1))) / 2;
      return { columns, rows, tile, gap, top, offset, stripHeight };
    }

    function tileAt(x, y, rect) {
      const { columns, rows, tile, gap, top, offset } = layout(rect);
      for (let index = 0; index < SAMPLES; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        if (row >= rows) break;
        const left = offset + column * (tile + gap);
        const topEdge = top + row * (tile + gap);
        if (x >= left && x <= left + tile && y >= topEdge && y <= topEdge + tile) return index;
      }
      return null;
    }

    function draw() {
      const surface = fitCanvas(canvas);
      if (!surface) return;
      const { context, width, height } = surface;
      context.clearRect(0, 0, width, height);
      const rect = { width, height };
      const { columns, rows, tile, gap, top, offset, stripHeight } = layout(rect);

      /* Filmstrip: the highlighted sample's own path from noise to image. */
      const frames = samples[highlight].frames;
      const strip = Math.min(7, frames.length);
      const stripTile = Math.min(stripHeight - 22, (width - 24 - 6 * 10) / 7);
      const stripLeft = 12;
      context.fillStyle = color(palette.muted);
      context.font = `600 9px ${palette.fontBody}`;
      context.textAlign = "left";
      context.fillText(`SAMPLE ${highlight + 1} · ONE TRAJECTORY THROUGH TIME`, stripLeft, 14);
      for (let index = 0; index < strip; index += 1) {
        const frameIndex = strip === 1 ? 0 : Math.round((index / (strip - 1)) * (frames.length - 1));
        const x = stripLeft + index * (stripTile + 10);
        drawImageTile(context, frames[frameIndex], x, 24, stripTile, false);
        context.fillStyle = color(palette.subtle);
        context.font = `500 9px ${palette.fontBody}`;
        context.fillText(`t = ${(frameIndex / Math.max(1, steps)).toFixed(2)}`, x, 24 + stripTile + 13);
      }

      context.fillStyle = color(palette.muted);
      context.font = `600 9px ${palette.fontBody}`;
      context.fillText(`${SAMPLES} SAMPLES FROM THE SAME FIELD`, stripLeft, top - 14);

      samples.forEach((sample, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        if (row >= rows) return;
        const x = offset + column * (tile + gap);
        const y = top + row * (tile + gap);
        drawImageTile(context, sample.image, x, y, tile, index === highlight);
      });
    }

    function drawImageTile(context, values, x, y, size, highlighted) {
      const raster = library.scratch;
      const rasterContext = raster.getContext("2d");
      const image = rasterContext.createImageData(library.grid, library.grid);
      for (let index = 0; index < values.length; index += 1) {
        const intensity = clamp((values[index] + 1) / 2, 0, 1);
        const shade = blend(palette.bg, palette.ink, intensity);
        image.data[index * 4] = shade[0];
        image.data[index * 4 + 1] = shade[1];
        image.data[index * 4 + 2] = shade[2];
        image.data[index * 4 + 3] = 255;
      }
      rasterContext.putImageData(image, 0, 0);
      context.save();
      context.imageSmoothingEnabled = false;
      context.drawImage(raster, x, y, size, size);
      context.restore();
      context.strokeStyle = highlighted ? color(palette.accent) : rgba(palette.line, 1);
      context.lineWidth = highlighted ? 2 : 1;
      context.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    }

    return {
      name: "image",
      draw,
      getState: () => {
        const readings = samples.map((sample) => nearest(sample.image));
        return {
          label,
          steps,
          stepIndex,
          time: stepIndex / steps,
          dimension: library.size,
          anchors: anchors().length,
          classes: [...new Set(readings.map((reading) => reading.label))].sort(),
          meanDistance: readings.reduce((sum, reading) => sum + reading.distance, 0) / readings.length,
          finite: samples.every((sample) => sample.image.every(Number.isFinite)),
          running,
        };
      },
    };
  }

  /* ─────────────────────────────────────────────
     Flow matching maths — shared by every panel

     Conditional path (Lipman et al., 2023, optimal-transport form):
       p_t(x | x1) = N(x ; t·x1, σ(t)² I),  σ(t) = 1 − (1 − σmin)·t
     Data smoothed by an isotropic blur b turns each anchor into a Gaussian
     component whose path stays Gaussian, so the marginal field is exact:
       p_t(x | k) = N(x ; t·μk, s_k(t)² I),  s(t)² = σ(t)² + t²b²
       u_t(x | k) = μk + (ṡ/s)·(x − t·μk)
       u_t(x)     = Σ_k p_t(k | x) · u_t(x | k)
     Everything below is dimension-agnostic: the same code runs the 2-D panels
     and the 196-D image panel.
  ───────────────────────────────────────────── */

  function pathSigma(t) { return 1 - (1 - SIGMA_MIN) * t; }

  function pathStats(t, blur) {
    const sigma = pathSigma(t);
    const scaleValue = Math.sqrt(sigma * sigma + t * t * blur * blur);
    const derivative = (-(1 - SIGMA_MIN) * sigma + t * blur * blur) / scaleValue;
    return { scale: scaleValue, ratio: derivative / scaleValue };
  }

  function conditionalVelocity(point, anchor, t, blur) {
    const { ratio } = pathStats(t, blur);
    return point.map((value, index) => anchor[index] + ratio * (value - t * anchor[index]));
  }

  function posteriorWeights(point, anchors, t, blur) {
    const { scale: scaleValue } = pathStats(t, blur);
    const inverse = 1 / (2 * scaleValue * scaleValue);
    let peak = -Infinity;
    const logits = anchors.map((anchor) => {
      let squared = 0;
      for (let index = 0; index < point.length; index += 1) squared += (point[index] - t * anchor[index]) ** 2;
      const value = -squared * inverse;
      if (value > peak) peak = value;
      return value;
    });
    let total = 0;
    const weights = logits.map((value) => {
      const exponent = Math.exp(value - peak);
      total += exponent;
      return exponent;
    });
    return weights.map((weight) => weight / total);
  }

  function marginalVelocity(point, anchors, t, blur) {
    if (anchors.length === 0) return point.map(() => 0);
    const { ratio } = pathStats(t, blur);
    const weights = posteriorWeights(point, anchors, t, blur);
    const velocity = point.map(() => 0);
    anchors.forEach((anchor, anchorIndex) => {
      const weight = weights[anchorIndex];
      if (weight < 1e-6) return;
      for (let index = 0; index < point.length; index += 1) {
        velocity[index] += weight * (anchor[index] + ratio * (point[index] - t * anchor[index]));
      }
    });
    return velocity;
  }

  /* ─────────────────────────────────────────────
     Datasets
  ───────────────────────────────────────────── */

  function buildDataset(key) {
    const random = randomSource(90210);
    if (key === "ring") {
      return Array.from({ length: 72 }, (unused, index) => {
        const angle = (index / 72) * Math.PI * 2;
        return [1.65 * Math.cos(angle), 1.65 * Math.sin(angle)];
      });
    }
    if (key === "mixture") {
      const centers = [[-1.75, 0.95], [1.7, 0.85], [0.1, -1.3]];
      const points = [];
      centers.forEach((center) => {
        for (let index = 0; index < 16; index += 1) {
          points.push([center[0] + gaussian(random) * 0.24, center[1] + gaussian(random) * 0.24]);
        }
      });
      return points;
    }
    if (key === "sketch") {
      return [
        [-1.5, 1], [-1.1, 1.15], [-0.7, 1.1], [-0.35, 0.9],
        [1.1, -0.8], [1.45, -0.6], [1.75, -0.25], [1.9, 0.15],
      ];
    }
    /* Two interlocking crescents: the upper one opens left, the lower one right. */
    const points = [];
    for (let index = 0; index < 48; index += 1) {
      const angle = (index / 47) * Math.PI;
      points.push([1.45 * Math.cos(angle) - 0.7, 1.45 * Math.sin(angle) - 0.35]);
      points.push([1.45 * Math.cos(angle) + 0.7, -1.45 * Math.sin(angle) + 0.35]);
    }
    return points;
  }

  function buildRegressionData() {
    const random = randomSource(31337);
    const points = [];
    for (let index = 0; index < 24; index += 1) {
      points.push([-0.85 + gaussian(random) * 0.2, 0.95 + gaussian(random) * 0.26]);
      points.push([0.85 + gaussian(random) * 0.2, -0.9 + gaussian(random) * 0.26]);
    }
    return points;
  }

  /* Rasterise digits at low resolution: a small, honest stand-in for an image dataset. */
  function buildGlyphLibrary() {
    const grid = 14;
    const size = grid * grid;
    const raster = document.createElement("canvas");
    raster.width = grid;
    raster.height = grid;
    const context = raster.getContext("2d", { willReadFrequently: true });
    const variants = [
      { size: 13, dx: 0, dy: 0, angle: 0, weight: 700 },
      { size: 12, dx: -0.7, dy: 0.4, angle: 0.11, weight: 600 },
      { size: 13.5, dx: 0.6, dy: -0.3, angle: -0.09, weight: 700 },
      { size: 11.5, dx: 0.3, dy: 0.6, angle: 0.05, weight: 800 },
      { size: 12.5, dx: -0.4, dy: -0.5, angle: -0.14, weight: 600 },
    ];
    const anchors = [];
    "0123456789".split("").forEach((character) => {
      variants.forEach((variant) => {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = "#000";
        context.fillRect(0, 0, grid, grid);
        context.translate(grid / 2 + variant.dx, grid / 2 + variant.dy);
        context.rotate(variant.angle);
        context.fillStyle = "#fff";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `${variant.weight} ${variant.size}px system-ui, sans-serif`;
        context.fillText(character, 0, 0);
        const pixels = context.getImageData(0, 0, grid, grid).data;
        const values = new Array(size);
        for (let index = 0; index < size; index += 1) values[index] = (pixels[index * 4] / 255) * 2 - 1;
        anchors.push({ label: character, values });
      });
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    return { grid, size, anchors, scratch: raster };
  }

  /* ─────────────────────────────────────────────
     Canvas helpers
  ───────────────────────────────────────────── */

  /* A world window with equal scale on both axes, sized to the plot it is drawn into. */
  function viewFor(plot, halfHeight, centerX = 0, centerY = 0) {
    const halfWidth = halfHeight * (plot.width / Math.max(1, plot.height));
    return {
      x: centerX - halfWidth,
      y: centerY - halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
    };
  }

  function makeProjector(plot, view) {
    return (point) => [
      plot.x + ((point[0] - view.x) / view.width) * plot.width,
      plot.y + plot.height - ((point[1] - view.y) / view.height) * plot.height,
    ];
  }

  function unproject([x, y], plot, view) {
    return [
      view.x + ((x - plot.x) / plot.width) * view.width,
      view.y + (1 - (y - plot.y) / plot.height) * view.height,
    ];
  }

  const densityRaster = document.createElement("canvas");

  /* Smooth density backdrop: evaluate p_t coarsely, then let the GPU interpolate it. */
  function drawDensity(context, plot, view, anchors, t, blur) {
    const columns = 52;
    const rows = Math.max(6, Math.round((columns * plot.height) / plot.width));
    densityRaster.width = columns;
    densityRaster.height = rows;
    const rasterContext = densityRaster.getContext("2d");
    const image = rasterContext.createImageData(columns, rows);
    const { scale: scaleValue } = pathStats(t, blur);
    const inverse = 1 / (2 * scaleValue * scaleValue);
    const values = new Float64Array(columns * rows);
    let peak = -Infinity;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = view.x + ((column + 0.5) / columns) * view.width;
        const y = view.y + (1 - (row + 0.5) / rows) * view.height;
        let best = -Infinity;
        let total = 0;
        for (let index = 0; index < anchors.length; index += 1) {
          const anchor = anchors[index];
          const logit = -((x - t * anchor[0]) ** 2 + (y - t * anchor[1]) ** 2) * inverse;
          if (logit > best) {
            total *= Math.exp(best - logit);
            best = logit;
          }
          total += Math.exp(logit - best);
        }
        const value = best + Math.log(total);
        values[row * columns + column] = value;
        if (value > peak) peak = value;
      }
    }
    for (let index = 0; index < values.length; index += 1) {
      const strength = Math.pow(Math.exp(values[index] - peak), 0.45);
      image.data[index * 4] = palette.cloud[0];
      image.data[index * 4 + 1] = palette.cloud[1];
      image.data[index * 4 + 2] = palette.cloud[2];
      image.data[index * 4 + 3] = Math.round(clamp(strength, 0, 1) * 88);
    }
    rasterContext.putImageData(image, 0, 0);
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(densityRaster, plot.x, plot.y, plot.width, plot.height);
    context.restore();
  }

  function drawGrid(context, plot, view) {
    const stepX = niceStep(view.width);
    const stepY = niceStep(view.height);
    context.strokeStyle = rgba(palette.line, 0.85);
    context.lineWidth = 1;
    for (let value = Math.ceil(view.x / stepX) * stepX; value <= view.x + view.width; value += stepX) {
      const x = plot.x + ((value - view.x) / view.width) * plot.width;
      context.beginPath();
      context.moveTo(x, plot.y);
      context.lineTo(x, plot.y + plot.height);
      context.stroke();
    }
    for (let value = Math.ceil(view.y / stepY) * stepY; value <= view.y + view.height; value += stepY) {
      const y = plot.y + plot.height - ((value - view.y) / view.height) * plot.height;
      context.beginPath();
      context.moveTo(plot.x, y);
      context.lineTo(plot.x + plot.width, y);
      context.stroke();
    }
  }

  function niceStep(span) {
    const raw = span / 6;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((factor) => factor * magnitude).find((step) => step >= raw) || magnitude * 10;
  }

  function drawFrame(context, plot) {
    context.strokeStyle = rgba(palette.line, 1);
    context.lineWidth = 1;
    context.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.width, plot.height);
  }

  function drawBoxTitle(context, box, label) {
    context.fillStyle = color(palette.muted);
    context.font = `600 9px ${palette.fontBody}`;
    context.textAlign = "left";
    context.fillText(label.toUpperCase(), box.x, box.y - 12);
  }

  function drawTimeRail(context, plot, t, startLabel, endLabel) {
    const y = plot.y - 22;
    const clamped = clamp(t, 0, 1);
    context.font = `500 9px ${palette.fontBody}`;
    context.fillStyle = color(palette.subtle);
    context.textAlign = "left";
    context.fillText(startLabel, plot.x, y - 9);
    context.textAlign = "right";
    context.fillText(endLabel, plot.x + plot.width, y - 9);
    context.textAlign = "left";
    context.strokeStyle = rgba(palette.line, 1);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(plot.x, y);
    context.lineTo(plot.x + plot.width, y);
    context.stroke();
    context.strokeStyle = color(palette.accent);
    context.beginPath();
    context.moveTo(plot.x, y);
    context.lineTo(plot.x + Math.max(0.001, clamped) * plot.width, y);
    context.stroke();
    context.beginPath();
    context.arc(plot.x + clamped * plot.width, y, 4, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(palette.accent);
    context.lineWidth = 2;
    context.stroke();
    context.lineCap = "butt";
  }

  /* Arrow tips stay inside their cell: the drawn length saturates with the speed. */
  function offsetBy(point, velocity, maximum) {
    const length = norm(velocity);
    if (length < 1e-9) return point.slice();
    const factor = (maximum * Math.tanh(length / 2.4)) / length;
    return [point[0] + velocity[0] * factor, point[1] + velocity[1] * factor];
  }

  function drawArrow(context, from, to, arrowColor, alpha, lineWidth) {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const size = 4 + lineWidth;
    context.strokeStyle = rgba(arrowColor, alpha);
    context.fillStyle = rgba(arrowColor, alpha);
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(from[0], from[1]);
    context.lineTo(to[0], to[1]);
    context.stroke();
    context.beginPath();
    context.moveTo(to[0], to[1]);
    context.lineTo(to[0] - size * Math.cos(angle - 0.5), to[1] - size * Math.sin(angle - 0.5));
    context.lineTo(to[0] - size * Math.cos(angle + 0.5), to[1] - size * Math.sin(angle + 0.5));
    context.closePath();
    context.fill();
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * ratio);
    const pixelHeight = Math.round(rect.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rect.width, height: rect.height };
  }

  function readPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: parseColor(styles.getPropertyValue("--bg")),
      bgWarm: parseColor(styles.getPropertyValue("--bg-warm")),
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
    const input = value.trim();
    if (input.startsWith("#")) {
      const hex = input.slice(1);
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
    const match = input.match(/[\d.]+/g);
    if (!match) throw new Error(`Unable to parse theme color: ${input}`);
    return match.slice(0, 3).map(Number);
  }

  function color(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }
  function rgba(rgb, alpha) { return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`; }
  function blend(first, second, amount) {
    return first.map((value, index) => Math.round(value + (second[index] - value) * amount));
  }
  function norm(vector) { return Math.hypot(...vector); }
  function distance(first, second) { return Math.hypot(first[0] - second[0], first[1] - second[1]); }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function inBox(x, y, box) { return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height; }

  function spread(points) {
    const mean = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
      .map((value) => value / points.length);
    return Math.sqrt(points.reduce(
      (sum, point) => sum + (point[0] - mean[0]) ** 2 + (point[1] - mean[1]) ** 2,
      0,
    ) / points.length);
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

  function gaussian(random) {
    const first = Math.max(1e-9, random());
    const second = random();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  }
}());
