function linearRegression(data) {
  const n = data.length;
  if (!n) return { m: 0, b: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = data[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const b = (sumY - m * sumX) / n;
  return { m, b };
}

function trendPoints(data) {
  const { m, b } = linearRegression(data);
  return data.map((_, i) => m * (i + 1) + b);
}

function forecastNext(data, weeks) {
  const { m, b } = linearRegression(data);
  const results = [];
  const start = data.length + 1;
  for (let i = 0; i < weeks; i++) {
    results.push(m * (start + i) + b);
  }
  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { linearRegression, trendPoints, forecastNext };
}
if (typeof window !== 'undefined') {
  window.linearRegression = linearRegression;
  window.trendPoints = trendPoints;
  window.forecastNext = forecastNext;
}
