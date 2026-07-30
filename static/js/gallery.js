/* Faithful miniature renderings for the visualization gallery. */
(function () {
  "use strict";

  const canvases = Array.from(document.querySelectorAll("[data-viz-preview]"));
  if (canvases.length === 0) return;
  const landscape = window.OptimizationLandscape;
  if (!landscape) return;

  let palette = readPalette();
  const optimizationPath = buildOptimizationPath();
  const optimizationContours = landscape.buildContours({
    levels: [0.15, 0.4, 0.9, 1.8, 3.5, 7, 13],
    xRange: [-2.05, 2.15],
    yRange: [-0.95, 2.05],
    columns: 44,
    rows: 34,
  });
  const paretoSamples = buildParetoSamples();
  const paretoFront = findParetoFront(paretoSamples);

  const drawAll = () => canvases.forEach(drawPreview);
  const resizeObserver = new ResizeObserver(drawAll);
  canvases.forEach((canvas) => resizeObserver.observe(canvas));
  window.addEventListener("themechange", () => {
    palette = readPalette();
    drawAll();
  });
  requestAnimationFrame(drawAll);

  function drawPreview(canvas) {
    const surface = fitCanvas(canvas);
    if (!surface) return;
    if (canvas.dataset.vizPreview === "optimization") drawOptimization(surface);
    else drawPareto(surface);
  }

  function drawOptimization({ context, width, height }) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = color(palette.bgWarm);
    context.fillRect(0, 0, width, height);

    const gap = Math.max(8, width * 0.025);
    const inset = Math.max(10, width * 0.035);
    const dashboardWidth = Math.max(72, width * 0.29);
    const plot = {
      x: inset,
      y: 25,
      width: width - inset * 2 - dashboardWidth - gap,
      height: height - 37,
    };
    const dashboard = {
      x: plot.x + plot.width + gap,
      y: plot.y,
      width: dashboardWidth,
      height: plot.height,
    };

    drawMiniTitle(context, "2-D STOCHASTIC VALLEY", plot.x, 10, palette.muted);
    drawLossField(context, plot);
    drawMiniGrid(context, plot, 4, 3);
    drawMiniContours(context, plot);
    drawMiniOptimizationPath(context, plot);

    drawMiniTitle(context, "24-D TENSOR", dashboard.x, 10, palette.muted);
    const heatmap = {
      x: dashboard.x,
      y: dashboard.y,
      width: dashboard.width,
      height: dashboard.height * 0.56,
    };
    drawMiniHeatmap(context, heatmap);
    drawMiniLossCurves(context, {
      x: dashboard.x,
      y: dashboard.y + dashboard.height * 0.66,
      width: dashboard.width,
      height: dashboard.height * 0.34,
    });
  }

  function drawLossField(context, plot) {
    const columns = 52;
    const rows = 38;
    const cellWidth = plot.width / columns;
    const cellHeight = plot.height / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const point = [
          -2.05 + (column / (columns - 1)) * 4.2,
          -0.95 + ((rows - 1 - row) / (rows - 1)) * 3,
        ];
        const strength = Math.min(1, Math.log1p(landscape.loss(point)) / Math.log(24));
        context.fillStyle = color(blendRgb(palette.bg, palette.cloud, 0.025 + 0.14 * strength));
        context.fillRect(
          plot.x + column * cellWidth,
          plot.y + row * cellHeight,
          cellWidth + 0.5,
          cellHeight + 0.5,
        );
      }
    }
  }

  function drawMiniContours(context, plot) {
    context.save();
    context.beginPath();
    context.rect(plot.x, plot.y, plot.width, plot.height);
    context.clip();
    optimizationContours.forEach(({ columns, rows, segments }, levelIndex) => {
      context.beginPath();
      segments.forEach(([first, second]) => {
        context.moveTo(
          plot.x + (first[0] / columns) * plot.width,
          plot.y + plot.height - (first[1] / rows) * plot.height,
        );
        context.lineTo(
          plot.x + (second[0] / columns) * plot.width,
          plot.y + plot.height - (second[1] / rows) * plot.height,
        );
      });
      context.strokeStyle = rgba(palette.cloud, levelIndex < 2 ? 0.42 : 0.25);
      context.lineWidth = levelIndex < 2 ? 0.9 : 0.65;
      context.stroke();
    });
    context.restore();
  }

  function drawMiniOptimizationPath(context, plot) {
    const scaleX = (value) => plot.x + ((value + 2.05) / 4.2) * plot.width;
    const scaleY = (value) => plot.y + (1 - (value + 0.95) / 3) * plot.height;
    context.beginPath();
    optimizationPath.forEach((point, index) => {
      const x = scaleX(point[0]);
      const y = scaleY(point[1]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = color(palette.accent);
    context.lineWidth = Math.max(1.4, widthScale(plot.width, 2.1));
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();

    const start = optimizationPath[0];
    context.beginPath();
    context.arc(scaleX(start[0]), scaleY(start[1]), 2, 0, Math.PI * 2);
    context.fillStyle = color(palette.subtle);
    context.fill();

    const current = optimizationPath.at(-1);
    const currentX = scaleX(current[0]);
    const currentY = scaleY(current[1]);
    context.beginPath();
    context.arc(currentX, currentY, 3.8, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(palette.accent);
    context.lineWidth = 1.6;
    context.stroke();

    const optimumX = scaleX(1);
    const optimumY = scaleY(1 / 3);
    context.beginPath();
    context.arc(optimumX, optimumY, 3, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(palette.ink);
    context.lineWidth = 1;
    context.stroke();

    const gradient = landscape.gradient(current);
    const length = Math.hypot(gradient[0], gradient[1]);
    const arrowLength = Math.min(14, plot.width * 0.085);
    drawArrow(
      context,
      currentX,
      currentY,
      currentX + (gradient[0] / Math.max(length, 1e-9)) * arrowLength,
      currentY - (gradient[1] / Math.max(length, 1e-9)) * arrowLength,
      palette.orange,
    );
  }

  function drawMiniHeatmap(context, box) {
    const values = [
      [-0.68, -0.42, 0.18, 0.33],
      [-0.36, 0.54, 0.27, -0.19],
      [0.12, 0.31, -0.46, -0.22],
      [0.49, 0.21, -0.14, 0.38],
      [-0.27, -0.55, 0.44, 0.16],
      [0.19, -0.24, 0.29, -0.41],
    ];
    const cell = Math.min(box.width / 4, box.height / 6);
    const startX = box.x + (box.width - cell * 4) / 2;
    const startY = box.y + (box.height - cell * 6) / 2;
    values.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        const target = value >= 0 ? palette.orange : palette.accent;
        context.fillStyle = color(blendRgb(palette.bg, target, 0.1 + Math.abs(value) * 0.75));
        context.fillRect(
          startX + columnIndex * cell + 0.5,
          startY + rowIndex * cell + 0.5,
          cell - 1,
          cell - 1,
        );
      });
    });
  }

  function drawMiniLossCurves(context, box) {
    context.strokeStyle = rgba(palette.line, 0.8);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(box.x, box.y + box.height);
    context.lineTo(box.x + box.width, box.y + box.height);
    context.stroke();
    [
      { values: [1, 0.7, 0.52, 0.41, 0.29, 0.2, 0.14, 0.1], lineColor: palette.accent },
      { values: [1, 0.58, 0.37, 0.24, 0.14, 0.08, 0.045, 0.024], lineColor: palette.orange },
    ].forEach(({ values, lineColor }) => {
      context.beginPath();
      values.forEach((value, index) => {
        const x = box.x + (index / (values.length - 1)) * box.width;
        const y = box.y + (1 - value) * box.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = color(lineColor);
      context.lineWidth = 1.2;
      context.lineCap = "round";
      context.stroke();
    });
  }

  function drawPareto({ context, width, height }) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = color(palette.bgWarm);
    context.fillRect(0, 0, width, height);
    const plot = { x: 29, y: 28, width: width - 42, height: height - 43 };
    const limit = 2.45;
    const scaleX = (value) => plot.x + ((value + limit) / (2 * limit)) * plot.width;
    const scaleY = (value) => plot.y + (1 - (value + limit) / (2 * limit)) * plot.height;

    drawMiniTitle(context, "OBJECTIVE SPACE · Y₁ MAX · Y₂ MAX", 12, 10, palette.muted);
    drawMiniGrid(context, plot, 4, 4);

    context.save();
    context.beginPath();
    context.rect(plot.x, plot.y, plot.width, plot.height);
    context.clip();

    if (paretoFront.length > 0) {
      context.beginPath();
      context.moveTo(scaleX(0), scaleY(0));
      context.lineTo(scaleX(0), scaleY(paretoFront[0][1]));
      context.lineTo(scaleX(paretoFront[0][0]), scaleY(paretoFront[0][1]));
      for (let index = 1; index < paretoFront.length; index += 1) {
        context.lineTo(scaleX(paretoFront[index - 1][0]), scaleY(paretoFront[index][1]));
        context.lineTo(scaleX(paretoFront[index][0]), scaleY(paretoFront[index][1]));
      }
      context.lineTo(scaleX(paretoFront.at(-1)[0]), scaleY(0));
      context.closePath();
      context.fillStyle = rgba(palette.accent, 0.055);
      context.fill();
    }

    const pointSize = Math.max(0.7, width / 430);
    context.beginPath();
    paretoSamples.forEach(([x, y]) => {
      context.rect(scaleX(x) - pointSize / 2, scaleY(y) - pointSize / 2, pointSize, pointSize);
    });
    context.fillStyle = rgba(palette.cloud, palette.cloudAlpha);
    context.fill();

    if (paretoFront.length > 0) {
      context.beginPath();
      context.moveTo(scaleX(0), scaleY(paretoFront[0][1]));
      context.lineTo(scaleX(paretoFront[0][0]), scaleY(paretoFront[0][1]));
      for (let index = 1; index < paretoFront.length; index += 1) {
        context.lineTo(scaleX(paretoFront[index - 1][0]), scaleY(paretoFront[index][1]));
        context.lineTo(scaleX(paretoFront[index][0]), scaleY(paretoFront[index][1]));
      }
      context.lineTo(scaleX(paretoFront.at(-1)[0]), scaleY(0));
      context.strokeStyle = color(palette.accent);
      context.lineWidth = 1.7;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
    }
    context.restore();

    context.beginPath();
    context.arc(scaleX(0), scaleY(0), 3.2, 0, Math.PI * 2);
    context.fillStyle = color(palette.bg);
    context.fill();
    context.strokeStyle = color(palette.ink);
    context.lineWidth = 1.1;
    context.stroke();
  }

  function drawMiniGrid(context, plot, columns, rows) {
    context.strokeStyle = rgba(palette.line, 0.75);
    context.lineWidth = 1;
    for (let column = 0; column <= columns; column += 1) {
      const x = plot.x + (column / columns) * plot.width;
      context.beginPath();
      context.moveTo(x, plot.y);
      context.lineTo(x, plot.y + plot.height);
      context.stroke();
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = plot.y + (row / rows) * plot.height;
      context.beginPath();
      context.moveTo(plot.x, y);
      context.lineTo(plot.x + plot.width, y);
      context.stroke();
    }
  }

  function drawMiniTitle(context, label, x, y, titleColor) {
    context.font = `600 7px ${palette.fontBody}`;
    context.fillStyle = color(titleColor);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(label, x, y);
  }

  function drawArrow(context, fromX, fromY, toX, toY, arrowColor) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const size = 4;
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.strokeStyle = color(arrowColor);
    context.lineWidth = 1.3;
    context.stroke();
    context.beginPath();
    context.moveTo(toX, toY);
    context.lineTo(toX - size * Math.cos(angle - 0.55), toY - size * Math.sin(angle - 0.55));
    context.lineTo(toX - size * Math.cos(angle + 0.55), toY - size * Math.sin(angle + 0.55));
    context.closePath();
    context.fillStyle = color(arrowColor);
    context.fill();
  }

  function buildOptimizationPath() {
    const path = [];
    let point = [-1.55, 1.47];
    let moment = [0, 0];
    for (let step = 0; step < 78; step += 1) {
      path.push(point.slice());
      const gradient = landscape.gradient(point);
      const gradientNorm = Math.hypot(gradient[0], gradient[1]);
      const clipped = gradientNorm > 8.5
        ? [gradient[0] * 8.5 / gradientNorm, gradient[1] * 8.5 / gradientNorm]
        : gradient;
      moment = [0.88 * moment[0] + 0.12 * clipped[0], 0.88 * moment[1] + 0.12 * clipped[1]];
      point = [point[0] - 0.086 * moment[0], point[1] - 0.086 * moment[1]];
    }
    return path;
  }

  function buildParetoSamples() {
    const random = createRandomSource(240724);
    const samples = [];
    for (let index = 0; index < 1800; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random());
      const noiseX = (random() - 0.5) * 0.24;
      const noiseY = (random() - 0.5) * 0.24;
      samples.push([
        1.65 * radius * Math.cos(angle) + 0.38 * Math.sin(2 * angle) + noiseX,
        1.38 * radius * Math.sin(angle) + 0.28 * Math.cos(3 * angle) + noiseY,
      ]);
    }
    return samples;
  }

  function findParetoFront(samples) {
    const feasible = samples.filter(([x, y]) => x >= 0 && y >= 0).sort((first, second) => second[0] - first[0]);
    const front = [];
    let bestY = -Infinity;
    feasible.forEach((point) => {
      if (point[1] > bestY) {
        front.push(point);
        bestY = point[1];
      }
    });
    return front.reverse();
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

  function widthScale(width, value) { return Math.max(1, value * Math.min(1, width / 210)); }

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
      cloudAlpha: Number.parseFloat(styles.getPropertyValue("--viz-cloud-opacity")),
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
