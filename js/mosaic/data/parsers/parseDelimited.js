/**
 * CSV and TSV parser with three modes.
 *
 *   wide   first column is one axis, the header row holds the other axis
 *   long   x, y and value columns that repeat to form a lattice
 *   series two numeric columns taken as paired samples
 *
 * The mode is inferred from the header and column statistics unless `mode`
 * says otherwise, and every row that cannot contribute numbers is counted so
 * the UI can report how much of a file was usable.
 */

import { DatasetError, createGridDataset, createSeriesDataset } from '../Dataset.js';
import { decodeText, detectDelimiter, parseRows, toNumber } from '../text/splitDelimited.js';

const NUMERIC_COLUMN_RATIO = 0.8;
const SPARSE_GRID_FILL = 0.5;

function resolveColumn(columns, field, fallbackIndex) {
  if (field == null || field === '') return columns[fallbackIndex];
  const wanted = String(field).trim().toLowerCase();
  const match = columns.find((column) => column.name.toLowerCase() === wanted);
  if (!match) {
    throw new DatasetError(`No column named "${field}". Available columns: ${columns.map((column) => column.name).join(', ')}.`);
  }
  return match;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function seriesFromColumns(xColumn, yColumn, meta) {
  const x = [];
  const y = [];
  let skipped = 0;
  for (let index = 0; index < xColumn.values.length; index++) {
    const xv = xColumn.values[index];
    const yv = yColumn.values[index];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) { skipped += 1; continue; }
    x.push(xv);
    y.push(yv);
  }
  if (!x.length) throw new DatasetError('No row had numeric values in both selected columns.');
  return createSeriesDataset({
    x,
    y,
    meta: {
      ...meta,
      notes: [...meta.notes,
        `series from columns "${xColumn.name}" and "${yColumn.name}"`,
        skipped ? `${skipped} row(s) skipped` : null].filter(Boolean)
    }
  });
}

function gridFromLong(xColumn, yColumn, valueColumn, meta) {
  const xValues = uniqueSorted(xColumn.values.filter(Number.isFinite));
  const yValues = uniqueSorted(yColumn.values.filter(Number.isFinite));
  if (xValues.length < 1 || yValues.length < 1) {
    throw new DatasetError('The x and y columns contain no numeric coordinates.');
  }

  const xIndex = new Map(xValues.map((value, index) => [value, index]));
  const yIndex = new Map(yValues.map((value, index) => [value, index]));
  const values = Array.from({ length: yValues.length }, () => new Array(xValues.length).fill(NaN));
  let placed = 0;
  let skipped = 0;

  for (let row = 0; row < valueColumn.values.length; row++) {
    const xv = xColumn.values[row];
    const yv = yColumn.values[row];
    const value = valueColumn.values[row];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) { skipped += 1; continue; }
    const columnIndex = xIndex.get(xv);
    const rowIndex = yIndex.get(yv);
    if (columnIndex === undefined || rowIndex === undefined) { skipped += 1; continue; }
    if (Number.isFinite(value)) { values[rowIndex][columnIndex] = value; placed += 1; }
  }

  return {
    values,
    x: xValues,
    y: yValues,
    placed,
    skipped,
    fill: placed / (xValues.length * yValues.length)
  };
}

function gridFromWide(columns, body, meta, orientation) {
  const firstColumnIsY = orientation !== 'x-first';
  const headerColumns = columns.slice(1);
  const axisValues = headerColumns.map((column) => toNumber(column.name));
  if (!axisValues.every(Number.isFinite)) {
    throw new DatasetError('Wide-matrix mode needs numeric column headers for the second axis.');
  }

  const labels = body.map((row) => toNumber(row[0]));
  const usable = labels.map((value, index) => ({ value, index })).filter((entry) => Number.isFinite(entry.value));
  if (!usable.length) throw new DatasetError('The first column holds no numeric axis values.');

  const values = usable.map(({ index }) => headerColumns.map((column) => {
    const cell = toNumber(body[index][column.index]);
    return Number.isFinite(cell) ? cell : NaN;
  }));
  const axis = usable.map((entry) => entry.value);
  const skipped = body.length - usable.length;
  const notes = [...meta.notes,
    firstColumnIsY ? 'wide matrix, first column is y' : 'wide matrix, first column is x',
    skipped ? `${skipped} row(s) skipped` : null].filter(Boolean);

  if (firstColumnIsY) {
    return createGridDataset({ x: axisValues, y: axis, values, meta: { ...meta, notes } });
  }
  const transposed = values.length ? values[0].map((_, columnIndex) => values.map((row) => row[columnIndex])) : [];
  return createGridDataset({ x: axis, y: axisValues, values: transposed, meta: { ...meta, notes } });
}
/**
 * @param {string|ArrayBuffer|Uint8Array} input delimited text or bytes
 * @param {{delimiter?: string, hasHeader?: boolean, mode?: 'wide'|'long'|'series', orientation?: string,
 *          xField?: string, yField?: string, valueField?: string, title?: string, source?: string,
 *          unit?: string}} options
 */
export function parseDelimited(input, options = {}) {
  const text = decodeText(input);
  const delimiter = options.delimiter || detectDelimiter(text);
  const rows = parseRows(text, delimiter);
  if (rows.length < 2) {
    throw new DatasetError('Delimited text needs a header row and at least one data row.');
  }

  const hasHeader = options.hasHeader !== false;
  const width = Math.max(...rows.map((row) => row.length));
  const header = (hasHeader ? rows[0] : []).map((name, index) => name.trim() || `column ${index + 1}`);
  while (header.length < width) header.push(`column ${header.length + 1}`);

  const body = (hasHeader ? rows.slice(1) : rows)
    .filter((row) => row.some((field) => field.trim() !== ''))
    .map((row) => {
      const padded = row.slice(0, width);
      while (padded.length < width) padded.push('');
      return padded;
    });

  if (!body.length) throw new DatasetError('Delimited text has no data rows.');

  const columns = header.map((name, index) => {
    const values = body.map((row) => toNumber(row[index]));
    const numeric = values.filter(Number.isFinite).length;
    return { index, name, values, ratio: body.length ? numeric / body.length : 0 };
  });

  const formatLabel = delimiter === '\t' ? 'TSV' : 'CSV';
  const meta = {
    title: options.title || '',
    source: options.source || '',
    unit: options.unit || '',
    format: formatLabel,
    notes: []
  };

  if (options.xField || options.yField || options.mode === 'series') {
    const xFallback = columns.findIndex((column) => column.ratio >= NUMERIC_COLUMN_RATIO);
    const xColumn = resolveColumn(columns, options.xField, xFallback);
    const yFallback = columns.findIndex((column, index) => index !== xColumn.index && column.ratio >= NUMERIC_COLUMN_RATIO);
    const yColumn = resolveColumn(columns, options.yField, yFallback);
    if (yColumn.index === xColumn.index) throw new DatasetError('x-field and y-field must name different columns.');
    return seriesFromColumns(xColumn, yColumn, meta);
  }

  const numericColumns = columns.filter((column) => column.ratio >= NUMERIC_COLUMN_RATIO);
  const headerIsNumeric = columns.length > 1 && columns.slice(1).every((column) => Number.isFinite(toNumber(column.name)));
  const firstColumnIsText = columns[0].ratio < NUMERIC_COLUMN_RATIO;
  const wideMatrix = options.mode === 'wide'
    || (options.mode !== 'long' && headerIsNumeric && firstColumnIsText && columns.length > 2);

  if (wideMatrix) return gridFromWide(columns, body, meta, options.orientation);

  if (options.mode === 'long' || numericColumns.length >= 3) {
    const fallbackX = numericColumns[0]?.index ?? 0;
    const fallbackY = numericColumns.find((column) => column.index !== fallbackX)?.index ?? 1;
    const xColumn = resolveColumn(columns, options.xField, fallbackX);
    const yColumn = resolveColumn(columns, options.yField, fallbackY);
    const fallbackValue = numericColumns.find((column) => column.index !== xColumn.index && column.index !== yColumn.index)?.index ?? 2;
    const valueColumn = resolveColumn(columns, options.valueField, fallbackValue);
    const grid = gridFromLong(xColumn, yColumn, valueColumn, meta);

    if (grid.fill < SPARSE_GRID_FILL) {
      return seriesFromColumns(xColumn, valueColumn, {
        ...meta,
        notes: [...meta.notes, 'lattice was too sparse for a grid, plotted as a series']
      });
    }

    return createGridDataset({
      x: grid.x,
      y: grid.y,
      values: grid.values,
      meta: {
        ...meta,
        notes: [...meta.notes,
          `long lattice from "${xColumn.name}", "${yColumn.name}", "${valueColumn.name}"`,
          grid.fill < 1 ? `${Math.round((1 - grid.fill) * 100)}% empty cells` : null,
          grid.skipped ? `${grid.skipped} row(s) skipped` : null].filter(Boolean)
      }
    });
  }

  if (numericColumns.length === 2) {
    return seriesFromColumns(numericColumns[0], numericColumns[1], meta);
  }

  throw new DatasetError(
    `Found ${numericColumns.length} numeric column(s); a grid needs three (x, y, value) and a series needs two.`
  );
}
