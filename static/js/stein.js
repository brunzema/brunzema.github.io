/* Interactive, dependency-free diagrams for the Stein variational inference note. */
(function () {
  "use strict";

  const root = document.documentElement;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let palette = readPalette();
  const instances = [];
  let customTargetComponents = [];

  const particleLab = document.querySelector("[data-stein-lab]");
  const identityLab = document.querySelector("[data-stein-identity]");
  if (particleLab) instances.push(createParticleLab(particleLab));
  if (identityLab) instances.push(createIdentityLab(identityLab));

  window.addEventListener("themechange", () => {
    palette = readPalette();
    instances.forEach((instance) => instance.draw());
  });

  window.__steinVisualization = {
    getState() {
      return Object.fromEntries(instances.map((instance) => [instance.name, instance.getState()]));
    },
  };

  function createParticleLab(lab) {
    const canvas = lab.querySelector("[data-stein-canvas]");
    const tabs = Array.from(lab.querySelectorAll("[data-stein-mode]"));
    const panels = Array.from(lab.querySelectorAll("[data-stein-panel]"));
    const targetButtons = Array.from(lab.querySelectorAll("[data-stein-target]"));
    const playButton = lab.querySelector("[data-stein-play]");
    const restartButton = lab.querySelector("[data-stein-restart]");
    const bandwidthInput = lab.querySelector("[data-stein-bandwidth]");
    const customEditor = lab.querySelector("[data-custom-editor]");
    const modeTitles = {
      score: "Raw target score",
      attraction: "Kernel-weighted score",
      repulsion: "Kernel repulsion",
      svgd: "Coupled Stein field",
    };
    let target = "mixture";
    let mode = "score";
    let bandwidth = Number(bandwidthInput.value);
    let running = false;
    let visible = true;
    let lastTime = 0;
    let accumulator = 0;
    let frameId = 0;
    let selectedCustom = 0;
    let customMessage = "";
    let customDraft = null;
    let customPointerId = null;
    let states = resetStates();

    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible && running) schedule();
    }, { rootMargin: "100px" });
    observer.observe(lab);
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectMode(tab.dataset.steinMode));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        tabs[next].focus();
        selectMode(tabs[next].dataset.steinMode);
      });
    });
    targetButtons.forEach((button) => button.addEventListener("click", () => {
      target = button.dataset.steinTarget;
      targetButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      customEditor.hidden = target !== "custom";
      lab.querySelector(".stein-stage").classList.toggle("is-custom", target === "custom");
      states = resetStates();
      syncCustomControls();
      update();
      draw();
    }));
    playButton.addEventListener("click", () => {
      running = !running;
      playButton.classList.toggle("is-playing", running);
      lab.classList.toggle("is-running", running);
      lab.querySelector("[data-stein-play-label]").textContent = running ? "Pause" : "Play";
      if (running) schedule();
    });
    restartButton.addEventListener("click", () => {
      states = resetStates();
      update();
      draw();
    });
    bandwidthInput.addEventListener("input", () => {
      bandwidth = Number(bandwidthInput.value);
      lab.querySelector("[data-stein-bandwidth-output]").textContent = `h = ${bandwidth.toFixed(2)}`;
      update();
      draw();
    });
    lab.querySelector("[data-custom-reset]").addEventListener("click", () => {
      customTargetComponents = [];
      selectedCustom = -1;
      resetAfterTargetEdit("Blank canvas—drag to draw the first component.");
    });
    canvas.addEventListener("pointerdown", beginCustomEllipse);
    canvas.addEventListener("pointermove", resizeCustomDraft);
    canvas.addEventListener("pointerup", finishCustomEllipse);
    canvas.addEventListener("pointercancel", cancelCustomEllipse);

    update();
    requestAnimationFrame(draw);

    function resetStates() {
      const initial = initialParticles(target);
      return Object.fromEntries(["score", "attraction", "repulsion", "svgd"].map((key) => [key, {
        step: 0,
        particles: initial.map((point) => point.slice()),
        trails: initial.map((point) => [point.slice()]),
      }]));
    }

    function selectMode(nextMode) {
      mode = nextMode;
      tabs.forEach((tab) => {
        const active = tab.dataset.steinMode === mode;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel) => {
        const active = panel.dataset.steinPanel === mode;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });
      lab.querySelector("[data-stein-view-title]").textContent = modeTitles[mode];
      update();
      draw();
    }

    function schedule() {
      if (!frameId && running && visible) frameId = requestAnimationFrame(tick);
    }

    function tick(time) {
      frameId = 0;
      if (!lastTime) lastTime = time;
      accumulator += Math.min(50, time - lastTime);
      lastTime = time;
      const interval = prefersReducedMotion.matches ? 110 : 34;
      while (accumulator >= interval) {
        advance(states[mode], mode);
        accumulator -= interval;
      }
      update();
      draw();
      if (states[mode].step >= 180) {
        running = false;
        playButton.classList.remove("is-playing");
        lab.classList.remove("is-running");
        lab.querySelector("[data-stein-play-label]").textContent = "Play";
      }
      schedule();
    }

    function advance(state, activeMode) {
      if (state.step >= 180) return;
      const messages = computeMessages(state.particles, target, bandwidth);
      const rates = { score: 0.026, attraction: 0.13, repulsion: 0.18, svgd: 0.14 };
      state.particles = state.particles.map((point, index) => {
        const vector = activeMode === "score" ? messages.scores[index]
          : activeMode === "attraction" ? messages.attraction[index]
            : activeMode === "repulsion" ? messages.repulsion[index]
              : add(messages.attraction[index], messages.repulsion[index]);
        const clipped = clipVector(vector, activeMode === "score" ? 3 : 1.6);
        return [clamp(point[0] + rates[activeMode] * clipped[0], -3.65, 3.65), clamp(point[1] + rates[activeMode] * clipped[1], -2.85, 3.05)];
      });
      state.step += 1;
      if (state.step % 3 === 0) state.particles.forEach((point, index) => {
        state.trails[index].push(point.slice());
        if (state.trails[index].length > 13) state.trails[index].shift();
      });
    }

    function update() {
      const state = states[mode];
      const messages = computeMessages(state.particles, target, bandwidth);
      const meanLog = state.particles.reduce((sum, point) => sum + targetValue(point, target).logDensity, 0) / state.particles.length;
      lab.querySelector("[data-stein-step]").textContent = `step ${state.step} / 180`;
      lab.querySelector("[data-stein-log-density]").textContent = `mean log density ${meanLog.toFixed(2)}`;
      lab.querySelector("[data-stein-neighbors]").textContent = messages.effectiveNeighbors.toFixed(1);
      lab.querySelector("[data-stein-spacing]").textContent = meanNearestSpacing(state.particles).toFixed(2);
      lab.querySelector("[data-stein-particle-count]").textContent = String(state.particles.length);
    }

    function draw() {
      const surface = fitCanvas(canvas);
      if (!surface) return;
      const { context, width, height } = surface;
      context.clearRect(0, 0, width, height);
      const plot = { x: 38, y: 44, width: width - 58, height: height - 68 };
      drawTargetField(context, plot, target);
      drawGrid(context, plot, 6, 5);
      const state = states[mode];
      const messages = computeMessages(state.particles, target, bandwidth);
      const project = ([x, y]) => [plot.x + ((x + 3.7) / 7.4) * plot.width, plot.y + (1 - (y + 2.9) / 6) * plot.height];

      context.save();
      context.beginPath();
      context.rect(plot.x, plot.y, plot.width, plot.height);
      context.clip();
      state.trails.forEach((trail) => {
        context.beginPath();
        trail.forEach((point, index) => {
          const [x, y] = project(point);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.strokeStyle = rgba(palette.ink, 0.1);
        context.lineWidth = 1;
        context.stroke();
      });
      state.particles.forEach((point, index) => {
        if (index % 4 !== 0) return;
        const origin = project(point);
        const scale = Math.min(plot.width, plot.height) * 0.037;
        if (mode === "svgd") {
          drawVector(context, origin, messages.attraction[index], scale, palette.orange, 0.55);
          drawVector(context, origin, messages.repulsion[index], scale, palette.accent, 0.65);
        } else {
          const vector = mode === "score" ? messages.scores[index] : messages[mode][index];
          drawVector(context, origin, vector, scale, mode === "repulsion" ? palette.accent : palette.orange, 0.78);
        }
      });
      state.particles.forEach((point, index) => {
        const [x, y] = project(point);
        context.beginPath();
        context.arc(x, y, index % 4 === 0 ? 3.2 : 2.35, 0, Math.PI * 2);
        context.fillStyle = color(palette.bg);
        context.fill();
        context.strokeStyle = color(index % 4 === 0 ? palette.ink : palette.cloud);
        context.lineWidth = index % 4 === 0 ? 1.25 : 1;
        context.stroke();
      });
      if (target === "custom") drawCustomSelection(context, plot, project);
      context.restore();
    }

    function customPointFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      const plot = { x: 38, y: 44, width: rect.width - 58, height: rect.height - 68 };
      return {
        plot,
        world: [-3.7 + ((event.offsetX - plot.x) / plot.width) * 7.4, -2.9 + (1 - (event.offsetY - plot.y) / plot.height) * 6],
        inside: inBox(event.offsetX, event.offsetY, plot),
      };
    }

    function beginCustomEllipse(event) {
      if (target !== "custom") return;
      const { world, inside } = customPointFromEvent(event);
      if (!inside) return;
      if (customTargetComponents.length >= 5) {
        customMessage = "Five components is the mixture limit. Clear the mixture to redraw it.";
        syncCustomControls();
        return;
      }
      event.preventDefault();
      customPointerId = event.pointerId;
      customDraft = { start: world, current: world, candidate: null };
      canvas.setPointerCapture(event.pointerId);
      customMessage = "Keep dragging to shape the new component.";
      syncCustomControls();
      draw();
    }

    function resizeCustomDraft(event) {
      if (target !== "custom" || customPointerId !== event.pointerId || !customDraft) return;
      const { world } = customPointFromEvent(event);
      customDraft.current = [clamp(world[0], -3.55, 3.55), clamp(world[1], -2.7, 2.9)];
      const dx = customDraft.current[0] - customDraft.start[0];
      const dy = customDraft.current[1] - customDraft.start[1];
      customDraft.candidate = {
        center: [(customDraft.start[0] + customDraft.current[0]) / 2, (customDraft.start[1] + customDraft.current[1]) / 2],
        axes: [clamp(Math.abs(dx) / 3, 0.05, 1.05), clamp(Math.abs(dy) / 3, 0.05, 0.9)],
        angle: 0,
      };
      draw();
    }

    function finishCustomEllipse(event) {
      if (customPointerId !== event.pointerId || !customDraft) return;
      const candidate = customDraft.candidate;
      customDraft = null;
      customPointerId = null;
      if (!candidate || candidate.axes[0] < 0.22 || candidate.axes[1] < 0.18) {
        customMessage = "Drag a wider shape—from one corner of the ellipse to the other.";
        syncCustomControls();
        draw();
        return;
      }
      if (!customPlacementValid(candidate, -1)) {
        customMessage = "Keep the full ellipse inside the canvas.";
        syncCustomControls();
        draw();
        return;
      }
      customTargetComponents.push(candidate);
      selectedCustom = customTargetComponents.length - 1;
      resetAfterTargetEdit(`Component ${selectedCustom + 1} added—the target mixture has updated.`);
    }

    function cancelCustomEllipse() {
      customDraft = null;
      customPointerId = null;
      draw();
    }

    function resetAfterTargetEdit(message) {
      customMessage = message;
      states = resetStates();
      syncCustomControls();
      update();
      draw();
    }

    function syncCustomControls() {
      const defaultMessage = customTargetComponents.length
        ? `${customTargetComponents.length}-component Gaussian mixture`
        : "Drag to draw the first component.";
      lab.querySelector("[data-custom-status]").textContent = customMessage || defaultMessage;
    }

    function drawCustomSelection(context, plot, project) {
      customTargetComponents.forEach((component, index) => {
        const [x, y] = project(component.center);
        context.save();
        context.translate(x, y);
        context.rotate(-component.angle);
        context.beginPath();
        context.ellipse(0, 0, component.axes[0] / 7.4 * plot.width * 1.5, component.axes[1] / 6 * plot.height * 1.5, 0, 0, Math.PI * 2);
        context.strokeStyle = rgba(index === selectedCustom ? palette.orange : palette.ink, index === selectedCustom ? 0.9 : 0.28);
        context.lineWidth = index === selectedCustom ? 1.5 : 0.8;
        context.setLineDash(index === selectedCustom ? [] : [3, 4]);
        context.stroke();
        context.restore();
      });
      if (customDraft?.candidate) {
        const component = customDraft.candidate;
        const [x, y] = project(component.center);
        context.save();
        context.translate(x, y);
        context.beginPath();
        context.ellipse(0, 0, component.axes[0] / 7.4 * plot.width * 1.5, component.axes[1] / 6 * plot.height * 1.5, 0, 0, Math.PI * 2);
        context.strokeStyle = rgba(customPlacementValid(component, -1) ? palette.orange : palette.cloud, 0.9);
        context.lineWidth = 1.5;
        context.setLineDash([5, 4]);
        context.stroke();
        context.restore();
      }
    }

    return {
      name: "particles",
      draw,
      getState: () => {
        const state = states[mode];
        return {
          target,
          mode,
          step: state.step,
          particleCount: state.particles.length,
          finite: state.particles.every((point) => point.every(Number.isFinite)),
          meanLogDensity: state.particles.reduce((sum, point) => sum + targetValue(point, target).logDensity, 0) / state.particles.length,
          meanSpacing: meanNearestSpacing(state.particles),
          leftCount: state.particles.filter((point) => point[0] < 0).length,
          rightCount: state.particles.filter((point) => point[0] >= 0).length,
          customComponents: customTargetComponents.map((component) => ({ center: component.center.slice(), axes: component.axes.slice(), angle: component.angle })),
          running,
        };
      },
    };
  }

  function createIdentityLab(lab) {
    const canvas = lab.querySelector("[data-identity-canvas]");
    const centerInput = lab.querySelector("[data-identity-center]");
    const widthInput = lab.querySelector("[data-identity-width]");
    let mean = Number(centerInput.value);
    let qSigma = Number(widthInput.value);
    let values = calculate();
    new ResizeObserver(draw).observe(canvas);
    [centerInput, widthInput].forEach((input) => input.addEventListener("input", () => {
      mean = Number(centerInput.value);
      qSigma = Number(widthInput.value);
      update();
    }));
    lab.querySelector("[data-identity-reset]").addEventListener("click", () => {
      centerInput.value = "0";
      widthInput.value = "1";
      mean = 0;
      qSigma = 1;
      update();
    });
    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const plotLeft = 46;
      const plotWidth = rect.width - 68;
      if (event.offsetY > rect.height * 0.55 || event.offsetX < plotLeft || event.offsetX > plotLeft + plotWidth) return;
      mean = clamp(-4.5 + ((event.offsetX - plotLeft) / plotWidth) * 9, -2.2, 2.2);
      centerInput.value = String(mean);
      update();
    });
    canvas.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      mean = event.key === "Home" ? 0 : clamp(mean + (event.key === "ArrowLeft" ? -0.1 : 0.1), -2.2, 2.2);
      centerInput.value = String(mean);
      update();
    });
    update();

    function calculate() {
      const samples = [];
      let scoreIntegral = 0;
      let divergenceIntegral = 0;
      const phiCenter = 0.65;
      const phiWidth = 0.9;
      const count = 361;
      const dx = 9 / (count - 1);
      for (let index = 0; index < count; index += 1) {
        const x = -4.5 + index * dx;
        const pDensity = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
        const qDensity = Math.exp(-0.5 * ((x - mean) / qSigma) ** 2) / (qSigma * Math.sqrt(2 * Math.PI));
        const phi = Math.exp(-((x - phiCenter) ** 2) / (2 * phiWidth ** 2));
        const derivative = -(x - phiCenter) / (phiWidth ** 2) * phi;
        const scorePart = qDensity * (-x) * phi;
        const divergencePart = qDensity * derivative;
        const weight = index === 0 || index === count - 1 ? 0.5 : 1;
        scoreIntegral += scorePart * dx * weight;
        divergenceIntegral += divergencePart * dx * weight;
        samples.push({ x, pDensity, qDensity, phi, scorePart, divergencePart });
      }
      return { samples, scoreIntegral, divergenceIntegral, residual: scoreIntegral + divergenceIntegral };
    }

    function update() {
      values = calculate();
      lab.querySelector("[data-identity-center-output]").textContent = `μq = ${mean.toFixed(2)}`;
      lab.querySelector("[data-identity-width-output]").textContent = `σq = ${qSigma.toFixed(2)}`;
      lab.querySelector("[data-identity-score]").textContent = signed(values.scoreIntegral);
      lab.querySelector("[data-identity-divergence]").textContent = signed(values.divergenceIntegral);
      lab.querySelector("[data-identity-sum]").textContent = signed(values.residual, 4);
      lab.querySelector("[data-identity-residual]").textContent = Math.abs(values.residual) < 0.001 ? "Stein signal ≈ 0 · this probe balances" : `Stein signal ${signed(values.residual, 3)} · transport remains`;
      canvas.setAttribute("aria-label", `Target p and approximation q with mean ${mean.toFixed(2)} and standard deviation ${qSigma.toFixed(2)}. Stein signal ${signed(values.residual, 3)}. Click the upper plot or use arrow keys to move q.`);
      draw();
    }

    function draw() {
      const surface = fitCanvas(canvas);
      if (!surface) return;
      const { context, width, height } = surface;
      context.clearRect(0, 0, width, height);
      context.fillStyle = color(palette.bgWarm);
      context.fillRect(0, 0, width, height);
      const pad = { left: 46, right: 22, top: 40, bottom: 28 };
      const top = { x: pad.left, y: pad.top, width: width - pad.left - pad.right, height: height * 0.42 };
      const bottom = { x: pad.left, y: height * 0.61, width: width - pad.left - pad.right, height: height * 0.28 };
      drawIdentityAxes(context, top, "TARGET p + APPROXIMATION q");
      drawIdentityAxes(context, bottom, "EXPECTATION UNDER q");
      const sx = (x) => top.x + ((x + 4.5) / 9) * top.width;
      context.beginPath();
      values.samples.forEach((sample, index) => {
        const y = top.y + top.height - (sample.pDensity / 0.9) * top.height * 0.82;
        if (index === 0) context.moveTo(sx(sample.x), y); else context.lineTo(sx(sample.x), y);
      });
      context.strokeStyle = color(palette.ink);
      context.lineWidth = 1.5;
      context.stroke();
      context.beginPath();
      values.samples.forEach((sample, index) => {
        const y = top.y + top.height - (sample.qDensity / 0.9) * top.height * 0.82;
        if (index === 0) context.moveTo(sx(sample.x), y); else context.lineTo(sx(sample.x), y);
      });
      context.strokeStyle = color(palette.accent);
      context.lineWidth = 1.7;
      context.stroke();
      context.setLineDash([4, 5]);
      context.beginPath();
      values.samples.forEach((sample, index) => {
        const y = top.y + top.height - sample.phi * top.height * 0.42;
        if (index === 0) context.moveTo(sx(sample.x), y); else context.lineTo(sx(sample.x), y);
      });
      context.strokeStyle = rgba(palette.orange, 0.72);
      context.lineWidth = 1;
      context.stroke();
      context.setLineDash([]);
      for (let x = -3.7; x <= 3.7; x += 0.55) {
        const phi = Math.exp(-((x - 0.65) ** 2) / (2 * 0.9 ** 2));
        const from = [sx(x), top.y + top.height + 8];
        drawVector(context, from, [phi, 0], 18, palette.orange, 0.55);
      }
      const maxAbs = Math.max(0.02, ...values.samples.flatMap((sample) => [Math.abs(sample.scorePart), Math.abs(sample.divergencePart)]));
      const zero = bottom.y + bottom.height / 2;
      drawFilledCurve(context, values.samples, (sample) => sample.scorePart, bottom, maxAbs, palette.orange, 0.16);
      drawFilledCurve(context, values.samples, (sample) => sample.divergencePart, bottom, maxAbs, palette.accent, 0.16);
      context.beginPath(); context.moveTo(bottom.x, zero); context.lineTo(bottom.x + bottom.width, zero);
      context.strokeStyle = color(palette.lineStrong); context.lineWidth = 1; context.stroke();
      drawLegend(context, top.x + 4, top.y - 8, [[palette.ink, "target p"], [palette.accent, "approximation q"], [palette.orange, "test field φ"]]);
      drawLegend(context, bottom.x + 4, bottom.y - 8, [[palette.orange, "q · score · φ"], [palette.accent, "q · divergence"]]);
    }

    return { name: "identity", draw, getState: () => ({ mean, sigma: qSigma, scoreIntegral: values.scoreIntegral, divergenceIntegral: values.divergenceIntegral, residual: values.residual }) };
  }


  function computeMessages(particles, target, bandwidth) {
    const scores = particles.map((point) => targetValue(point, target).score);
    const attraction = [];
    const repulsion = [];
    let neighborSum = 0;
    particles.forEach((receiver) => {
      let attract = [0, 0];
      let repel = [0, 0];
      particles.forEach((sender, index) => {
        const weight = kernel(sender, receiver, bandwidth);
        neighborSum += weight;
        attract = add(attract, scale(scores[index], weight / particles.length));
        repel = add(repel, scale(sub(receiver, sender), 2 * weight / bandwidth / particles.length));
      });
      attraction.push(attract);
      repulsion.push(repel);
    });
    return { scores, attraction, repulsion, effectiveNeighbors: neighborSum / particles.length };
  }

  function targetValue([x, y], target) {
    if (target === "banana") {
      const sigmaX = 1.55;
      const sigmaY = 0.58;
      const bend = 0.32;
      const offset = 1.6;
      const v = (y - bend * (x * x - offset)) / sigmaY;
      return {
        logDensity: -0.5 * ((x / sigmaX) ** 2 + v * v),
        score: [-x / (sigmaX ** 2) + 2 * bend * x * v / sigmaY, -v / sigmaY],
      };
    }
    const definitions = target === "custom" ? customTargetComponents : [
      { center: [-1.45, 0.45], axes: [0.62, 0.78], angle: 0 },
      { center: [1.4, 0.65], axes: [0.72, 0.58], angle: 0 },
    ];
    if (definitions.length === 0) return { logDensity: -8, score: [0, 0] };
    const components = definitions.map((component) => {
      const dx = x - component.center[0];
      const dy = y - component.center[1];
      const cosine = Math.cos(component.angle);
      const sine = Math.sin(component.angle);
      const localX = cosine * dx + sine * dy;
      const localY = -sine * dx + cosine * dy;
      const localScoreX = -localX / component.axes[0] ** 2;
      const localScoreY = -localY / component.axes[1] ** 2;
      return {
        log: -0.5 * ((localX / component.axes[0]) ** 2 + (localY / component.axes[1]) ** 2) - Math.log(component.axes[0] * component.axes[1]),
        score: [cosine * localScoreX - sine * localScoreY, sine * localScoreX + cosine * localScoreY],
      };
    });
    const maximum = Math.max(...components.map((item) => item.log));
    const weights = components.map((item) => Math.exp(item.log - maximum));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return {
      logDensity: maximum + Math.log(total / components.length),
      score: components.reduce((sum, component, index) => add(sum, scale(component.score, weights[index] / total)), [0, 0]),
    };
  }

  function drawTargetField(context, plot, target) {
    if (target === "custom" && customTargetComponents.length === 0) {
      context.fillStyle = color(palette.bgWarm);
      context.fillRect(plot.x, plot.y, plot.width, plot.height);
      return;
    }
    const columns = 48; const rows = 38;
    const values = [];
    let maximum = -Infinity;
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const point = [-3.7 + column / (columns - 1) * 7.4, -2.9 + (rows - 1 - row) / (rows - 1) * 6];
      const value = targetValue(point, target).logDensity;
      values.push(value); maximum = Math.max(maximum, value);
    }
    const cellWidth = plot.width / columns; const cellHeight = plot.height / rows;
    values.forEach((value, index) => {
      const strength = Math.exp(Math.max(-7, value - maximum));
      context.fillStyle = color(blend(palette.bgWarm, palette.accent, 0.015 + 0.105 * strength));
      context.fillRect(plot.x + (index % columns) * cellWidth, plot.y + Math.floor(index / columns) * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    });
    [0.12, 0.28, 0.52, 0.76].forEach((level) => drawDensityContour(context, plot, target, maximum + Math.log(level), 58, 46));
  }

  function drawDensityContour(context, plot, target, level, columns, rows) {
    const grid = [];
    for (let row = 0; row <= rows; row += 1) {
      grid[row] = [];
      for (let column = 0; column <= columns; column += 1) grid[row][column] = targetValue([-3.7 + column / columns * 7.4, -2.9 + (rows - row) / rows * 6], target).logDensity;
    }
    context.beginPath();
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const corners = [grid[row][column], grid[row][column + 1], grid[row + 1][column + 1], grid[row + 1][column]].map((value) => value >= level);
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
    context.strokeStyle = rgba(palette.accent, 0.28); context.lineWidth = 0.8; context.stroke();
  }

  function initialParticles(target) {
    const random = randomSource(target === "mixture" ? 5619 : target === "banana" ? 9823 : 20260803);
    return Array.from({ length: 80 }, (_, index) => {
      const column = index % 16; const row = Math.floor(index / 16);
      return [-3.25 + column * 0.43 + (random() - 0.5) * 0.22, -2.35 + row * 0.31 + (random() - 0.5) * 0.2];
    });
  }

  function customPlacementValid(candidate) {
    return Math.abs(candidate.center[0]) + candidate.axes[0] * 1.55 <= 3.55
      && candidate.center[1] - candidate.axes[1] * 1.55 >= -2.7
      && candidate.center[1] + candidate.axes[1] * 1.55 <= 2.9;
  }

  function kernel(a, b, h) { const dx = a[0] - b[0]; const dy = a[1] - b[1]; return Math.exp(-(dx * dx + dy * dy) / h); }
  function meanNearestSpacing(points) { return points.reduce((sum, point, index) => sum + Math.min(...points.map((other, j) => j === index ? Infinity : distance(point, other))), 0) / points.length; }

  function drawGrid(context, plot, columns, rows) {
    context.strokeStyle = rgba(palette.line, 0.8); context.lineWidth = 1;
    for (let i = 0; i <= columns; i += 1) { const x = plot.x + i / columns * plot.width; context.beginPath(); context.moveTo(x, plot.y); context.lineTo(x, plot.y + plot.height); context.stroke(); }
    for (let i = 0; i <= rows; i += 1) { const y = plot.y + i / rows * plot.height; context.beginPath(); context.moveTo(plot.x, y); context.lineTo(plot.x + plot.width, y); context.stroke(); }
  }
  function drawVector(context, origin, vector, scaleFactor, vectorColor, alpha) {
    const clipped = clipVector(vector, 1.4); const end = [origin[0] + clipped[0] * scaleFactor, origin[1] - clipped[1] * scaleFactor];
    const angle = Math.atan2(end[1] - origin[1], end[0] - origin[0]);
    context.beginPath(); context.moveTo(...origin); context.lineTo(...end); context.strokeStyle = rgba(vectorColor, alpha); context.lineWidth = 1.25; context.stroke();
    context.beginPath(); context.moveTo(...end); context.lineTo(end[0] - 4 * Math.cos(angle - 0.55), end[1] - 4 * Math.sin(angle - 0.55)); context.lineTo(end[0] - 4 * Math.cos(angle + 0.55), end[1] - 4 * Math.sin(angle + 0.55)); context.closePath(); context.fillStyle = rgba(vectorColor, alpha); context.fill();
  }
  function drawIdentityAxes(context, box, title) { drawGrid(context, box, 6, 3); context.fillStyle = color(palette.muted); context.font = `600 9px ${palette.fontBody}`; context.fillText(title, box.x, box.y - 26); }
  function drawFilledCurve(context, samples, accessor, box, maxAbs, fillColor, alpha) {
    const zero = box.y + box.height / 2; const sx = (x) => box.x + ((x + 4.5) / 9) * box.width;
    context.beginPath(); context.moveTo(sx(samples[0].x), zero); samples.forEach((sample) => context.lineTo(sx(sample.x), zero - accessor(sample) / maxAbs * box.height * 0.42)); context.lineTo(sx(samples.at(-1).x), zero); context.closePath(); context.fillStyle = rgba(fillColor, alpha); context.fill();
    context.beginPath(); samples.forEach((sample, index) => { const x = sx(sample.x); const y = zero - accessor(sample) / maxAbs * box.height * 0.42; if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); }); context.strokeStyle = color(fillColor); context.lineWidth = 1.4; context.stroke();
  }
  function drawLegend(context, x, y, items) { context.font = `500 9px ${palette.fontBody}`; let offset = 0; items.forEach(([itemColor, label]) => { context.fillStyle = color(itemColor); context.fillRect(x + offset, y + 3, 12, 2); context.fillStyle = color(palette.muted); context.fillText(label, x + offset + 18, y); offset += context.measureText(label).width + 48; }); }
  function inBox(x, y, box) { return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height; }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect(); if (rect.width < 80 || rect.height < 60) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2); const pixelWidth = Math.round(rect.width * ratio); const pixelHeight = Math.round(rect.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const context = canvas.getContext("2d"); context.setTransform(ratio, 0, 0, ratio, 0, 0); return { context, width: rect.width, height: rect.height };
  }
  function readPalette() {
    const styles = getComputedStyle(root);
    return { bg: parseColor(styles.getPropertyValue("--bg")), bgWarm: parseColor(styles.getPropertyValue("--bg-warm")), ink: parseColor(styles.getPropertyValue("--ink")), muted: parseColor(styles.getPropertyValue("--muted")), subtle: parseColor(styles.getPropertyValue("--subtle")), line: parseColor(styles.getPropertyValue("--line")), lineStrong: parseColor(styles.getPropertyValue("--line-strong")), accent: parseColor(styles.getPropertyValue("--accent")), orange: parseColor(styles.getPropertyValue("--viz-orange")), cloud: parseColor(styles.getPropertyValue("--viz-cloud")), fontBody: styles.getPropertyValue("--font-body").trim() };
  }
  function parseColor(value) { const input = value.trim(); if (input.startsWith("#")) { const hex = input.slice(1); return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)]; } const match = input.match(/[\d.]+/g); if (!match) throw new Error(`Unable to parse theme color: ${input}`); return match.slice(0,3).map(Number); }
  function color(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }
  function rgba(rgb, alpha) { return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`; }
  function blend(a, b, amount) { return a.map((value, index) => Math.round(value + (b[index] - value) * amount)); }
  function add(a,b) { return [a[0]+b[0],a[1]+b[1]]; }
  function sub(a,b) { return [a[0]-b[0],a[1]-b[1]]; }
  function scale(a,s) { return [a[0]*s,a[1]*s]; }
  function norm(a) { return Math.hypot(a[0],a[1]); }
  function distance(a,b) { return Math.hypot(a[0]-b[0],a[1]-b[1]); }
  function clipVector(vector, maximum) { const length = norm(vector); return length > maximum ? scale(vector, maximum / length) : vector; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function signed(value, digits = 3) { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`; }
  function randomSource(seed) { let state = seed >>> 0; return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }
}());
