/** Sampling and regular-grid resampling for scientific raster/contour views. */
const MODES = new Set(['nearest', 'linear', 'cubic']);

export function normalizeInterpolation(mode = 'nearest') {
  const normalized = String(mode).toLowerCase();
  const aliases = { bilinear: 'linear', smooth: 'cubic', bicubic: 'cubic' };
  const resolved = aliases[normalized] || normalized;
  if (!MODES.has(resolved)) {
    throw new RangeError(`Unsupported interpolation "${mode}". Use nearest, linear, or cubic.`);
  }
  return resolved;
}

const clampIndex = (index, size) => Math.max(0, Math.min(size - 1, index));

function sampleNearest(values, x, y) {
  const row = values[clampIndex(Math.round(y), values.length)];
  return Number.isFinite(row?.[clampIndex(Math.round(x), row.length)])
    ? row[clampIndex(Math.round(x), row.length)]
    : NaN;
}

function sampleLinear(values, x, y) {
  const rows = values.length;
  const columns = Math.min(...values.map((row) => row?.length || 0));
  const x0 = clampIndex(Math.floor(x), columns);
  const x1 = clampIndex(x0 + 1, columns);
  const y0 = clampIndex(Math.floor(y), rows);
  const y1 = clampIndex(y0 + 1, rows);
  const tx = Math.max(0, Math.min(1, x - Math.floor(x)));
  const ty = Math.max(0, Math.min(1, y - Math.floor(y)));
  const samples = [values[y0]?.[x0], values[y0]?.[x1], values[y1]?.[x0], values[y1]?.[x1]];
  if (samples.some((value) => !Number.isFinite(value))) return sampleNearest(values, x, y);
  const upper = samples[0] + (samples[1] - samples[0]) * tx;
  const lower = samples[2] + (samples[3] - samples[2]) * tx;
  return upper + (lower - upper) * ty;
}

function cubicInterpolate(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

function sampleCubic(values, x, y) {
  const rows = values.length;
  const columns = Math.min(...values.map((row) => row?.length || 0));
  const xBase = Math.floor(x);
  const yBase = Math.floor(y);
  const tx = x - xBase;
  const ty = y - yBase;
  const rowValues = [];
  for (let rowOffset = -1; rowOffset <= 2; rowOffset++) {
    const sourceRow = clampIndex(yBase + rowOffset, rows);
    const samples = [];
    for (let columnOffset = -1; columnOffset <= 2; columnOffset++) {
      const sourceColumn = clampIndex(xBase + columnOffset, columns);
      const value = values[sourceRow]?.[sourceColumn];
      if (!Number.isFinite(value)) return sampleLinear(values, x, y);
      samples.push(value);
    }
    rowValues.push(cubicInterpolate(samples[0], samples[1], samples[2], samples[3], tx));
  }
  return cubicInterpolate(rowValues[0], rowValues[1], rowValues[2], rowValues[3], ty);
}

export function sampleGrid(values, x, y, interpolation = 'linear') {
  const mode = normalizeInterpolation(interpolation);
  if (!values?.length || !values[0]?.length) return NaN;
  const maxX = Math.min(...values.map((row) => row?.length || 0)) - 1;
  const maxY = values.length - 1;
  const boundedX = Math.max(0, Math.min(maxX, x));
  const boundedY = Math.max(0, Math.min(maxY, y));
  if (mode === 'nearest') return sampleNearest(values, boundedX, boundedY);
  if (mode === 'cubic' && values.length >= 4 && maxX >= 3) return sampleCubic(values, boundedX, boundedY);
  return sampleLinear(values, boundedX, boundedY);
}

/** Upsample a scalar grid while retaining endpoints and its row/column orientation. */
export function resampleGrid(values, interpolation = 'linear', subdivisions = 4) {
  const mode = normalizeInterpolation(interpolation);
  const rows = values?.length || 0;
  const columns = rows ? Math.min(...values.map((row) => row?.length || 0)) : 0;
  if (!rows || !columns) return { values: [], subdivisions: 1 };
  if (mode === 'nearest' || (rows === 1 && columns === 1)) {
    return { values: values.slice(0, rows).map((row) => row.slice(0, columns)), subdivisions: 1 };
  }
  const factor = Math.max(2, Math.min(8, Math.floor(subdivisions)));
  const outputRows = rows === 1 ? 1 : (rows - 1) * factor + 1;
  const outputColumns = columns === 1 ? 1 : (columns - 1) * factor + 1;
  const output = Array.from({ length: outputRows }, (_, row) => Array.from({ length: outputColumns }, (_, column) => {
    const sourceY = rows === 1 ? 0 : row / factor;
    const sourceX = columns === 1 ? 0 : column / factor;
    return sampleGrid(values, sourceX, sourceY, mode);
  }));
  return { values: output, subdivisions: factor };
}
