/**
 * Normalized dataset contract shared by every Mosaic data parser and view.
 *
 * A parser never hands raw file bytes to a view. It returns one of the three
 * dataset kinds below, so views only ever deal with an x axis, a y axis and a
 * single scalar field. This keeps PixelsView, ContoursView, BarsView and
 * PointsView independent of the file format that produced their numbers.
 */

export const DATASET_KIND = Object.freeze({
  GRID: 'grid',
  SERIES: 'series',
  CUBE: 'cube'
});

const STATS_CACHE = new WeakMap();

export class DatasetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatasetError';
  }
}

/** Integer ramp used when a format carries values but no coordinates. */
export function axisRamp(length) {
  if (!Number.isInteger(length) || length < 0) {
    throw new DatasetError(`Axis length must be a non-negative integer, received ${length}.`);
  }
  return Array.from({ length }, (_, index) => index);
}

export function createMeta(meta = {}) {
  return Object.freeze({
    title: meta.title ?? '',
    source: meta.source ?? '',
    format: meta.format ?? 'unknown',
    unit: meta.unit ?? '',
    axisOrder: meta.axisOrder ?? null,
    notes: Object.freeze(Array.isArray(meta.notes) ? [...meta.notes] : [])
  });
}

function requireAxis(axis, minimumLength, label) {
  if (!Array.isArray(axis) || axis.length < minimumLength || !axis.every(Number.isFinite)) {
    throw new DatasetError(`${label} axis must be an array of at least ${minimumLength} finite numbers.`);
  }
}

/** Scan nested rows, a flat array, or a typed array for finite-value statistics. */
export function computeStats(source) {
  let min = Infinity;
  let max = -Infinity;
  let finite = 0;
  let total = 0;
  const visit = (value) => {
    total += 1;
    if (Number.isFinite(value)) {
      finite += 1;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  };

  if (!source) return Object.freeze({ min: 0, max: 1, finite: 0, total: 0, empty: true });

  const nested = Array.isArray(source) && source.length > 0 && Array.isArray(source[0]);
  if (nested) {
    for (const row of source) {
      if (!row) continue;
      for (const value of row) visit(value);
    }
  } else {
    for (const value of source) visit(value);
  }

  if (finite === 0) return Object.freeze({ min: 0, max: 1, finite: 0, total, empty: true });
  return Object.freeze({ min, max, finite, total, empty: false });
}

function gridColumnCount(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DatasetError('Grid values must be a non-empty array of rows.');
  }
  const columns = Math.min(...values.map((row) => (Array.isArray(row) ? row.length : 0)));
  if (!Number.isFinite(columns) || columns < 1) {
    throw new DatasetError('Grid values must contain at least one row with one column.');
  }
  const ragged = values.find((row) => !Array.isArray(row) || row.length !== columns);
  if (ragged) {
    throw new DatasetError('Grid values must be rectangular; every row needs the same length.');
  }
  return columns;
}

/** Scalar field on a regular lattice: values[row][column] with y[row] and x[column]. */
export function createGridDataset({ x, y, values, meta } = {}) {
  const columns = gridColumnCount(values);
  const rows = values.length;
  const xAxis = x ? x.slice(0, columns) : axisRamp(columns);
  const yAxis = y ? y.slice(0, rows) : axisRamp(rows);
  requireAxis(xAxis, columns, 'x');
  requireAxis(yAxis, rows, 'y');
  return Object.freeze({
    kind: DATASET_KIND.GRID,
    x: Object.freeze(xAxis),
    y: Object.freeze(yAxis),
    values,
    rows,
    columns,
    meta: createMeta(meta)
  });
}

/** Two paired coordinate vectors, used by points and bar views. */
export function createSeriesDataset({ x, y, meta } = {}) {
  if (!Array.isArray(x) || !Array.isArray(y)) {
    throw new DatasetError('Series datasets need both an x and a y array.');
  }
  const length = Math.min(x.length, y.length);
  if (length === 0) throw new DatasetError('Series datasets need at least one sample.');
  if (x.length !== y.length) {
    throw new DatasetError(`Series x and y lengths differ (${x.length} versus ${y.length}).`);
  }
  return Object.freeze({
    kind: DATASET_KIND.SERIES,
    x: Object.freeze(x.slice()),
    y: Object.freeze(y.slice()),
    length,
    meta: createMeta(meta)
  });
}

/** Volumetric scalar field; `matrix` is a Matrix3D with shape [nz, ny, nx]. */
export function createCubeDataset({ matrix, meta } = {}) {
  if (!matrix || typeof matrix.slice !== 'function' || !Array.isArray(matrix.shape)) {
    throw new DatasetError('Cube datasets need a Matrix3D instance with a slice method and a shape.');
  }
  if (matrix.shape.length !== 3 || matrix.shape.some((size) => !Number.isInteger(size) || size < 1)) {
    throw new DatasetError(`Cube shape must be three positive integers, received [${matrix.shape.join(', ')}].`);
  }
  return Object.freeze({
    kind: DATASET_KIND.CUBE,
    matrix,
    shape: Object.freeze([...matrix.shape]),
    meta: createMeta(meta)
  });
}

export function isDataset(value) {
  return Boolean(value) && Object.values(DATASET_KIND).includes(value.kind);
}

export const isGridDataset = (value) => isDataset(value) && value.kind === DATASET_KIND.GRID;
export const isSeriesDataset = (value) => isDataset(value) && value.kind === DATASET_KIND.SERIES;
export const isCubeDataset = (value) => isDataset(value) && value.kind === DATASET_KIND.CUBE;

/** Reject a malformed dataset before it reaches a view. */
export function validateDataset(dataset) {
  if (!isDataset(dataset)) {
    throw new DatasetError('Expected a dataset with a kind of grid, series or cube.');
  }
  if (isGridDataset(dataset)) {
    if (gridColumnCount(dataset.values) !== dataset.columns) {
      throw new DatasetError('Grid dataset columns do not match its values.');
    }
  } else if (isSeriesDataset(dataset)) {
    if (dataset.x.length !== dataset.y.length) {
      throw new DatasetError('Series dataset axes are not the same length.');
    }
  } else if (dataset.shape.length !== 3) {
    throw new DatasetError('Cube dataset shape must be three-dimensional.');
  }
  return dataset;
}

/** Finite min and max for any dataset kind; the result is memoized per dataset. */
export function datasetRange(dataset) {
  if (!isDataset(dataset)) throw new DatasetError('datasetRange expects a dataset.');
  const cached = STATS_CACHE.get(dataset);
  if (cached) return cached;

  let stats;
  if (isGridDataset(dataset)) stats = computeStats(dataset.values);
  else if (isSeriesDataset(dataset)) stats = computeStats(dataset.y);
  else stats = typeof dataset.matrix.getRange === 'function' ? dataset.matrix.getRange() : computeStats(dataset.matrix.data);

  const range = Object.freeze([stats.min, stats.max]);
  STATS_CACHE.set(dataset, range);
  return range;
}

/** Full statistics for any dataset kind, including how many samples were unusable. */
export function datasetStats(dataset) {
  if (isGridDataset(dataset)) return computeStats(dataset.values);
  if (isSeriesDataset(dataset)) return computeStats(dataset.y);
  const stats = typeof dataset.matrix.getRange === 'function' ? dataset.matrix.getRange() : computeStats(dataset.matrix.data);
  return Object.freeze({ min: stats.min, max: stats.max, finite: stats.finite ?? 0, total: stats.total ?? 0, empty: stats.empty ?? false });
}

/** Compact shape description used by status badges and the sources toolbar. */
export function datasetSummary(dataset) {
  if (isGridDataset(dataset)) return `grid ${dataset.rows} × ${dataset.columns}`;
  if (isSeriesDataset(dataset)) return `series ${dataset.length} points`;
  if (isCubeDataset(dataset)) return `cube ${dataset.shape.join(' × ')}`;
  return 'unknown data';
}

/** Longer human-readable description for tooltips and the status bar. */
export function describeDataset(dataset) {
  const [min, max] = datasetRange(dataset);
  const stats = datasetStats(dataset);
  const parts = [datasetSummary(dataset), `value ${formatNumber(min)} … ${formatNumber(max)}`];
  if (stats.total > stats.finite) parts.push(`${(stats.total - stats.finite).toLocaleString()} empty cells`);
  if (dataset.meta?.format) parts.push(dataset.meta.format);
  return parts.join(' · ');
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || magnitude < 1e-3) return value.toExponential(2);
  return Number(value.toFixed(3)).toString();
}
