/* Shared mathematical landscape used by the optimization note and its gallery preview. */
(function () {
  "use strict";

  function loss([x, y]) {
    const valleyError = y - (x * x) / 3;
    return 0.42 * (1 - x) ** 2 + 3.8 * valleyError ** 2;
  }

  function gradient([x, y]) {
    const valleyError = y - (x * x) / 3;
    return [0.84 * (x - 1) - (15.2 / 3) * x * valleyError, 7.6 * valleyError];
  }

  function buildContours({ levels, xRange, yRange, columns, rows }) {
    const values = Array.from({ length: rows + 1 }, (_, row) => (
      Array.from({ length: columns + 1 }, (_, column) => loss([
        interpolate(column / columns, xRange),
        interpolate(row / rows, yRange),
      ]))
    ));

    return levels.map((level) => {
      const segments = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const corners = [
            [column, row, values[row][column]],
            [column + 1, row, values[row][column + 1]],
            [column + 1, row + 1, values[row + 1][column + 1]],
            [column, row + 1, values[row + 1][column]],
          ];
          const hits = [];
          for (let edge = 0; edge < 4; edge += 1) {
            const first = corners[edge];
            const second = corners[(edge + 1) % 4];
            if ((first[2] < level) === (second[2] < level)) continue;
            const amount = (level - first[2]) / (second[2] - first[2]);
            hits.push([
              first[0] + (second[0] - first[0]) * amount,
              first[1] + (second[1] - first[1]) * amount,
            ]);
          }
          if (hits.length >= 2) segments.push([hits[0], hits[1]]);
          if (hits.length === 4) segments.push([hits[2], hits[3]]);
        }
      }
      return { level, columns, rows, segments };
    });
  }

  function interpolate(amount, range) {
    return range[0] + amount * (range[1] - range[0]);
  }

  window.OptimizationLandscape = Object.freeze({ loss, gradient, buildContours });
}());
