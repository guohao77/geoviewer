/**
 * JSON parser for every dataset shape Mosaic understands.
 *
 * Accepted documents:
 *   { x, y, values: [[…]] }            regular 2D grid
 *   { x, y }                           two paired vectors (series)
 *   { x, y, z, values: [[[…]]] }       cube with coordinates
 *   { shape: [nz, ny, nx], data: […] } cube from a flat array
 *   [[…], […]]                          bare 2D array of values
 *   [[[…]], [[…]]]                      bare 3D array of values
 *
 * Nested arrays are assumed to be ordered z, y, x unless `axesOrder` says
 * otherwise, so an externally produced array can be described instead of guessed.
 */

import {
  DatasetError,
  axisRamp,
  createCubeDataset,
  createGridDataset,
  createSeriesDataset
} from '../Dataset.js';
import { Matrix3D } from '../Matrix3D.js';

const DEFAULT_AXES_ORDER = Object.freeze(['z', 'y', 'x']);
const KNOWN_AXES = Object.freeze(['z', 'y', 'x']);
const FLOAT32_LIMIT = 3.4028234663852886e38;

function decodeDocument(input, hint = 'JSON') {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (error) {
      throw new DatasetError(`Could not parse ${hint}: ${error.message}`);
    }
  }
  if (input instanceof Uint8Array || input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer ?? input, input.byteOffset ?? 0, input.byteLength);
    return decodeDocument(new TextDecoder('utf-8', { fatal: false }).decode(bytes), hint);
  }
  if (input && typeof input === 'object') return input;
  throw new DatasetError(`${hint} parser received ${input === null ? 'null' : typeof input} instead of JSON data.`);
}

function isNumericArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => Number.isFinite(item));
}

function isArrayOfArrays(value) {
  return Array.isArray(value) && value.length > 0 && value.every((row) => Array.isArray(row));
}

function numericAxis(source, label) {
  if (source == null) return null;
  if (!Array.isArray(source)) throw new DatasetError(`The ${label} axis must be an array of numbers.`);
  const values = source.map((value) => Number(value));
  if (!values.every(Number.isFinite)) throw new DatasetError(`The ${label} axis contains a non-numeric entry.`);
  return values;
}

/** Rectangularity check that names the offending row. */
function requireRectangular(rows, label) {
  if (!rows.length) throw new DatasetError(`${label} is empty.`);
  const width = rows[0].length;
  for (let index = 0; index < rows.length; index++) {
    if (!Array.isArray(rows[index])) throw new DatasetError(`${label} row ${index} is not an array.`);
    if (rows[index].length !== width) {
      throw new DatasetError(`${label} is ragged: row 0 has ${width} entries but row ${index} has ${rows[index].length}.`);
    }
  }
  return width;
}

function matrixShape(nested, label) {
  requireRectangular(nested, label);
  const planes = nested.length;
  requireRectangular(nested[0], `${label}[0]`);
  const rows = nested[0].length;
  const columns = nested[0][0].length;
  for (let plane = 0; plane < planes; plane++) {
    requireRectangular(nested[plane], `${label}[${plane}]`);
    if (nested[plane].length !== rows) {
      throw new DatasetError(`${label} plane ${plane} has ${nested[plane].length} rows but plane 0 has ${rows}.`);
    }
  }
  return [planes, rows, columns];
}

function normalizeAxesOrder(order) {
  if (!order) return DEFAULT_AXES_ORDER;
  const parts = Array.isArray(order) ? order.map(String) : String(order).toLowerCase().split('');
  if (parts.length !== 3 || new Set(parts).size !== 3 || !parts.every((axis) => KNOWN_AXES.includes(axis))) {
    throw new DatasetError(`axes-order must name x, y and z exactly once, received "${order}".`);
  }
  return parts;
}

/** Flatten a 3D nested array, permuting axis order into the internal z, y, x layout. */
function cubeFromNested(nested, axesOrder, coordinates, meta) {
  const [d0, d1, d2] = matrixShape(nested, 'values');
  const dims = { [axesOrder[0]]: d0, [axesOrder[1]]: d1, [axesOrder[2]]: d2 };
  const nz = dims.z ?? 1;
  const ny = dims.y ?? 1;
  const nx = dims.x ?? 1;
  const data = new Float32Array(nz * ny * nx);
  const identity = axesOrder[0] === 'z' && axesOrder[1] === 'y' && axesOrder[2] === 'x';

  if (identity) {
    let offset = 0;
    for (let z = 0; z < d0; z++) {
      for (let y = 0; y < d1; y++) {
        const row = nested[z][y];
        for (let x = 0; x < d2; x++) data[offset++] = toFloat(row[x], z, y, x);
      }
    }
  } else {
    for (let i0 = 0; i0 < d0; i0++) {
      for (let i1 = 0; i1 < d1; i1++) {
        for (let i2 = 0; i2 < d2; i2++) {
          const tuple = { [axesOrder[0]]: i0, [axesOrder[1]]: i1, [axesOrder[2]]: i2 };
          const target = (tuple.z * ny + tuple.y) * nx + tuple.x;
          data[target] = toFloat(nested[i0][i1][i2], i0, i1, i2);
        }
      }
    }
  }

  const matrix = new Matrix3D(data, [nz, ny, nx], {
    coordinates: {
      x: coordinates.x ?? rampFor(nx),
      y: coordinates.y ?? rampFor(ny),
      z: coordinates.z ?? rampFor(nz)
    },
    labels: meta.labels
  });
  return createCubeDataset({ matrix, meta });
}

function rampFor(length) {
  return axisRamp(length);
}

function toFloat(value, ...where) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  if (Math.abs(number) > FLOAT32_LIMIT) {
    throw new DatasetError(`Value ${number} at [${where.join(', ')}] exceeds float32 range.`);
  }
  return number;
}

function cubeFromFlat(flat, shape, coordinates, meta) {
  if (!Array.isArray(shape) || shape.length !== 3 || !shape.every((size) => Number.isInteger(size) && size > 0)) {
    throw new DatasetError(`shape must be three positive integers, received ${JSON.stringify(shape)}.`);
  }
  const [nz, ny, nx] = shape;
  if (flat.length !== nz * ny * nx) {
    throw new DatasetError(`data has ${flat.length} values but shape [${shape.join(', ')}] needs ${nz * ny * nx}.`);
  }
  const data = new Float32Array(flat.length);
  for (let index = 0; index < flat.length; index++) data[index] = toFloat(flat[index], index);
  const matrix = new Matrix3D(data, [nz, ny, nx], {
    coordinates: {
      x: coordinates.x ?? rampFor(nx),
      y: coordinates.y ?? rampFor(ny),
      z: coordinates.z ?? rampFor(nz)
    },
    labels: meta.labels
  });
  return createCubeDataset({ matrix, meta });
}

function gridFromDocument(document, meta) {
  const values = document.values ?? [];
  const x = numericAxis(document.x, 'x');
  const y = numericAxis(document.y, 'y');
  return createGridDataset({ x: x ?? undefined, y: y ?? undefined, values, meta });
}

function seriesFromDocument(document, meta) {
  const x = numericAxis(document.x, 'x');
  const y = numericAxis(document.y, 'y');
  if (!x || !y) throw new DatasetError('A series needs both x and y arrays.');
  return createSeriesDataset({ x, y, meta });
}

/**
 * @param {string|ArrayBuffer|object} input JSON text, bytes, or an already parsed document
 * @param {{key?: string, axesOrder?: string|string[], title?: string, source?: string, unit?: string, labels?: object}} options
 */
export function parseJsonDataset(input, options = {}) {
  const format = 'JSON';
  let document = decodeDocument(input, format);

  if (options.key) {
    if (!document || typeof document !== 'object' || !Object.hasOwn(document, options.key)) {
      const available = document && typeof document === 'object' ? Object.keys(document).join(', ') : 'none';
      throw new DatasetError(`JSON has no key "${options.key}". Available keys: ${available}.`);
    }
    document = document[options.key];
  }

  // A document may describe its own nesting order; an explicit attribute always overrides it.
  const declaredOrder = Array.isArray(document) ? undefined : document.axesOrder ?? document.axes_order;
  const axesOrderSetting = options.axesOrder ?? declaredOrder;

  const meta = {
    title: options.title || document?.title || '',
    source: options.source || '',
    unit: options.unit || document?.unit || '',
    format,
    axisOrder: Array.isArray(axesOrderSetting) ? axesOrderSetting.join('') : String(axesOrderSetting ?? 'zyx'),
    labels: options.labels
  };

  if (Array.isArray(document)) {
    if (document.length === 0) throw new DatasetError('JSON array is empty.');
    if (isNumericArray(document)) {
      return createSeriesDataset({ x: rampFor(document.length), y: document.map(Number), meta });
    }
    if (isArrayOfArrays(document) && isNumericArray(document[0])) {
      return createGridDataset({ values: document, meta });
    }
    if (isArrayOfArrays(document) && isArrayOfArrays(document[0])) {
      return cubeFromNested(document, normalizeAxesOrder(axesOrderSetting), {}, meta);
    }
    throw new DatasetError('JSON array is not a rectangular grid or cube of numbers.');
  }

  if (!document || typeof document !== 'object') {
    throw new DatasetError('JSON document must be an object or an array.');
  }

  const coordinates = {
    x: numericAxis(document.x, 'x') ?? undefined,
    y: numericAxis(document.y, 'y') ?? undefined,
    z: numericAxis(document.z, 'z') ?? undefined
  };

  // Cube from an explicit shape plus a flat array, or from axis lengths when only coordinates are given.
  if (Array.isArray(document.shape) || (Array.isArray(document.data) && !document.data.some(Array.isArray))) {
    const shape = document.shape ?? inferShapeFromAxes(coordinates);
    const flat = document.data ?? document.values;
    if (!Array.isArray(flat)) throw new DatasetError('A flat cube needs a data or values array.');
    return cubeFromFlat(flat, shape, coordinates, meta);
  }

  const values = options.valueKey ? document[options.valueKey] : document.values;

  if (isArrayOfArrays(values)) {
    if (isArrayOfArrays(values[0])) {
      if (values[0][0] !== undefined && Array.isArray(values[0][0])) {
        return cubeFromNested(values, normalizeAxesOrder(axesOrderSetting), coordinates, meta);
      }
    }
    return gridFromDocument({ ...document, values }, meta);
  }

  if (Array.isArray(values) && values.every((item) => typeof item === 'number')) {
    throw new DatasetError('A flat values array needs a shape triple, for example shape: [nz, ny, nx], to be read as a cube.');
  }

  if (isNumericArray(document.x) && isNumericArray(document.y) && document.x.length === document.y.length) {
    return seriesFromDocument(document, meta);
  }

  throw new DatasetError(
    'Unrecognized JSON layout. Supply x/y/values for a grid, x/y for a series, or shape plus data for a cube.'
  );
}

function inferShapeFromAxes(coordinates) {
  if (!coordinates.z || !coordinates.y || !coordinates.x) {
    throw new DatasetError('A flat cube needs a shape triple such as shape: [nz, ny, nx].');
  }
  return [coordinates.z.length, coordinates.y.length, coordinates.x.length];
}
