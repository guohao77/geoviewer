/**
 * Quote-aware splitting for delimited text.
 *
 * Written by hand rather than pulled from a library because Mosaic only needs
 * rectangular text tables, and this keeps the parse worker dependency free.
 * Handles quoted fields, doubled quotes, CRLF and LF, and trailing blank lines.
 */

const DELIMITER_CANDIDATES = Object.freeze([',', '\t', ';', '|']);
const SNIFF_LINE_COUNT = 10;

export class DelimitedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DelimitedError';
  }
}

export function decodeText(input) {
  if (typeof input === 'string') return input.replace(/^\uFEFF/, '');
  if (input instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: false }).decode(input).replace(/^\uFEFF/, '');
  if (input instanceof ArrayBuffer) return decodeText(new Uint8Array(input));
  if (ArrayBuffer.isView(input)) return decodeText(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  throw new DelimitedError(`Expected text or bytes, received ${input === null ? 'null' : typeof input}.`);
}

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { index += 1; continue; }
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      count += 1;
    }
  }
  return count;
}

/** Pick the delimiter that splits the sampled lines most consistently. */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, SNIFF_LINE_COUNT);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -Infinity;
  for (const delimiter of DELIMITER_CANDIDATES) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const expected = counts[0];
    if (expected < 1) continue;
    const mismatches = counts.reduce((total, count) => total + (count === expected ? 0 : 1), 0);
    const score = mismatches === 0 ? 1000 + expected : expected * 4 - mismatches * 10;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/** Split delimited text into rows of raw string fields. */
export function parseRows(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; continue; }
        quoted = false;
        continue;
      }
      field += character;
      continue;
    }
    if (character === '"' && !fieldStarted) { quoted = true; fieldStarted = true; continue; }
    if (character === delimiter) { row.push(field); field = ''; fieldStarted = false; continue; }
    if (character === '\r') continue;
    if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; fieldStarted = false; continue; }
    field += character;
    fieldStarted = true;
  }

  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  while (rows.length > 0 && rows[rows.length - 1].every((value) => value.trim() === '')) rows.pop();
  return rows;
}

/** True when the field looks like a number, tolerating surrounding blanks. */
export function toNumber(field) {
  if (typeof field === 'number') return Number.isFinite(field) ? field : NaN;
  if (field == null) return NaN;
  const trimmed = String(field).trim();
  if (trimmed === '') return NaN;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

export { DELIMITER_CANDIDATES };
