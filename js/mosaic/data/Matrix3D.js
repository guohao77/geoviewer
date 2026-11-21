/**
 * Dense three-dimensional scalar field stored as one flat typed array.
 *
 * Layout is C order with the x axis contiguous: index = z * ny * nx + y * nx + x.
 * Slicing never copies the volume. A z-slice and a y-slice return typed-array
 * subarrays that alias the original buffer, so scrubbing a 500 MB cube costs a
 * handful of small object allocations. Only an x-slice is strided, and only that
 * slice gathers its rows into fresh typed arrays.
 */

import { DatasetError } from './Dataset.js';

const AXIS_DIMENSION = Object.freeze({ x: 2, y: 1, z: 0 });
const AXIS_NAMES = Object.freeze(['z', 'y', 'x']);
const DEFAULT_AXIS_LABELS = Object.freeze({ x: 'x', y: 'y', z: 'z' });

export const MATRIX_AXES = Object.freeze(['x', 'y', 'z']);

function normalizeAxis(axis) {
  const name = String(axis ?? '').toLowerCase();
  if (!MATRIX_AXES.includes(name)) {
    throw new DatasetError(`Matrix axis must be one of x, y or z, received "${axis}".`);
  }
  return name;
}

function requireIndex(index, size, label) {
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    throw new DatasetError(`${label} index must be an integer in [0, ${size - 1}], received ${index}.`);
  }
  return index;
}

function coordinateAxis(axis, size, supplied) {
  if (supplied == null) return Array.from({ length: size }, (_, index) => index);
  if (!Array.isArray(supplied) && !ArrayBuffer.isView(supplied)) {
    throw new DatasetError(`The ${axis} coordinates must be an array of ${size} numbers.`);
  }
  if (supplied.length !== size) {
    throw new DatasetError(`The ${axis} axis needs ${size} coordinates but ${supplied.length} were supplied.`);
  }
  return Array.from(supplied, (value) => {
    if (!Number.isFinite(value)) throw new DatasetError(`The ${axis} axis contains a non-numeric coordinate.`);
    return value;
  });
}

export class Matrix3D {
  /** @param {ArrayBufferView} data flat values; @param {number[]} shape [nz, ny, nx] */
  constructor(data, shape, options = {}) {
    if (!ArrayBuffer.isView(data)) {
      throw new DatasetError('Matrix3D needs a flat typed array of values.');
    }
    if (!Array.isArray(shape) || shape.length !== 3) {
      throw new DatasetError('Matrix3D shape must be [nz, ny, nx].');
    }
    if (shape.some((size) => !Number.isInteger(size) || size < 1)) {
      throw new DatasetError(`Matrix3D shape must be three positive integers, received [${shape.join(', ')}].`);
    }
    const [nz, ny, nx] = shape;
    const expected = nz * ny * nx;
    if (data.length !== expected) {
      throw new DatasetError(`Matrix3D has ${data.length} values but its shape needs ${expected}.`);
    }

    this.data = data;
    this.shape = Object.freeze([nz, ny, nx]);
    this.sizes = Object.freeze({ z: nz, y: ny, x: nx });
    this.names = Object.freeze({ ...DEFAULT_AXIS_LABELS, ...(options.labels || {}) });
    this.coordinates = Object.freeze({
      x: Object.freeze(coordinateAxis('x', nx, options.coordinates?.x)),
      y: Object.freeze(coordinateAxis('y', ny, options.coordinates?.y)),
      z: Object.freeze(coordinateAxis('z', nz, options.coordinates?.z))
    });
    this.capabilities = Object.freeze({
      axisSlices: MATRIX_AXES,
      transpose: true,
      flipAxes: MATRIX_AXES,
      aliasesData: true
    });

    this.range = Object.freeze({ min: 0, max: 1, finite: 0, total: expected, empty: true });
    this.sliceRanges = null;
    if (options.computeRanges !== false) this.computeRanges();
  }

  get size() { return this.data.length; }

  axisIndex(axis) { return AXIS_DIMENSION[normalizeAxis(axis)]; }

  axisSize(axis) { return this.sizes[normalizeAxis(axis)]; }

  axisCoordinates(axis) { return this.coordinates[normalizeAxis(axis)]; }

  axisLabel(axis) {
    const name = normalizeAxis(axis);
    return this.names[name] || name;
  }

  /** World coordinate of one slice position along an axis. */
  coordinateAt(axis, index) {
    const name = normalizeAxis(axis);
    const coordinates = this.coordinates[name];
    requireIndex(index, coordinates.length, name);
    return coordinates[index];
  }

  /** Summary of one axis: length, coordinate range and units text. */
  extent(axis) {
    const name = normalizeAxis(axis);
    const coordinates = this.coordinates[name];
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    return Object.freeze({
      axis: name,
      label: this.axisLabel(name),
      size: coordinates.length,
      min: Math.min(first, last),
      max: Math.max(first, last),
      ascending: last >= first
    });
  }

  indexAt(z, y, x) {
    const { sizes } = this;
    requireIndex(z, sizes.z, 'z');
    requireIndex(y, sizes.y, 'y');
    requireIndex(x, sizes.x, 'x');
    return (z * sizes.y + y) * sizes.x + x;
  }

  valueAt(z, y, x) { return this.data[this.indexAt(z, y, x)]; }

  /** One pass over the volume: global range plus per-slice min/max on every axis. */
  computeRanges() {
    const { z: nz, y: ny, x: nx } = this.sizes;
    const data = this.data;
    const ranges = {
      z: { min: new Float64Array(nz).fill(Infinity), max: new Float64Array(nz).fill(-Infinity) },
      y: { min: new Float64Array(ny).fill(Infinity), max: new Float64Array(ny).fill(-Infinity) },
      x: { min: new Float64Array(nx).fill(Infinity), max: new Float64Array(nx).fill(-Infinity) }
    };

    let min = Infinity;
    let max = -Infinity;
    let finite = 0;

    for (let z = 0; z < nz; z++) {
      const zLow = ranges.z.min;
      const zHigh = ranges.z.max;
      for (let y = 0; y < ny; y++) {
        const base = (z * ny + y) * nx;
        for (let x = 0; x < nx; x++) {
          const value = data[base + x];
          if (!Number.isFinite(value)) continue;
          finite += 1;
          if (value < min) min = value;
          if (value > max) max = value;
          if (value < zLow[z]) zLow[z] = value;
          if (value > zHigh[z]) zHigh[z] = value;
          if (value < ranges.y.min[y]) ranges.y.min[y] = value;
          if (value > ranges.y.max[y]) ranges.y.max[y] = value;
          if (value < ranges.x.min[x]) ranges.x.min[x] = value;
          if (value > ranges.x.max[x]) ranges.x.max[x] = value;
        }
      }
    }

    this.sliceRanges = ranges;
    this.range = Object.freeze({
      min: finite ? min : 0,
      max: finite ? max : 1,
      finite,
      total: this.data.length,
      empty: finite === 0
    });
    return this.range;
  }

  getRange() { return this.range; }

  /** Precomputed min/max of a single slice, without touching the volume again. */
  sliceRange(axis, index) {
    const name = normalizeAxis(axis);
    requireIndex(index, this.sizes[name], name);
    if (!this.sliceRanges) this.computeRanges();
    const min = this.sliceRanges[name].min[index];
    const max = this.sliceRanges[name].max[index];
    if (!Number.isFinite(min) || !Number.isFinite(max)) return Object.freeze({ min: 0, max: 1, empty: true });
    return Object.freeze({ min, max, empty: false });
  }

  /**
   * Two-dimensional section through the volume.
   * Rows are the vertical axis, columns the horizontal axis; for a z-slice
   * that is y by x, for a y-slice z by x, and for an x-slice z by y.
   * Rows alias the underlying buffer except for an x-slice, which is strided.
   */
  slice(axis, index) {
    const name = normalizeAxis(axis);
    const at = requireIndex(index, this.sizes[name], name);
    const { z: nz, y: ny, x: nx } = this.sizes;
    const data = this.data;
    const Ctor = data.constructor;
    let values;
    let verticalAxis;
    let horizontalAxis;

    if (name === 'z') {
      const plane = ny * nx;
      const offset = at * plane;
      values = new Array(ny);
      for (let y = 0; y < ny; y++) values[y] = data.subarray(offset + y * nx, offset + (y + 1) * nx);
      verticalAxis = 'y';
      horizontalAxis = 'x';
    } else if (name === 'y') {
      const plane = ny * nx;
      values = new Array(nz);
      for (let z = 0; z < nz; z++) {
        const start = z * plane + at * nx;
        values[z] = data.subarray(start, start + nx);
      }
      verticalAxis = 'z';
      horizontalAxis = 'x';
    } else {
      const plane = ny * nx;
      values = new Array(nz);
      for (let z = 0; z < nz; z++) {
        const row = new Ctor(ny);
        const base = z * plane + at;
        for (let y = 0; y < ny; y++) row[y] = data[base + y * nx];
        values[z] = row;
      }
      verticalAxis = 'z';
      horizontalAxis = 'y';
    }

    const range = this.sliceRange(name, at);
    return Object.freeze({
      values,
      rows: values.length,
      columns: values.length ? values[0].length : 0,
      x: this.coordinates[horizontalAxis],
      y: this.coordinates[verticalAxis],
      horizontalAxis,
      verticalAxis,
      axis: name,
      axisLabel: this.axisLabel(name),
      index: at,
      coordinate: this.coordinates[name][at],
      range,
      materialized: name === 'x' || undefined
    });
  }

  /** True when a slice along this axis can alias the volume instead of copying. */
  slicesAliasData(axis) {
    const name = normalizeAxis(axis);
    return name !== 'x';
  }
}

export { AXIS_NAMES };
