/**
 * Resolve which parser should read a data source.
 *
 * Detection is deliberately conservative: an explicit `format` attribute always
 * wins, a magic-number sniff of the first bytes beats the file extension, and
 * the extension is only trusted when the bytes are inconclusive text.
 */

export const DATA_FORMAT = Object.freeze({
  JSON: 'json',
  DELIMITED: 'delimited',
  NPY: 'npy',
  NPZ: 'npz',
  NETCDF3: 'netcdf3',
  BINARY: 'binary',
  UNKNOWN: 'unknown'
});

export const COMPRESSION = Object.freeze({ GZIP: 'gzip', ZIP: 'zip' });

const FORMAT_LABELS = Object.freeze({
  [DATA_FORMAT.JSON]: 'JSON',
  [DATA_FORMAT.DELIMITED]: 'CSV / TSV',
  [DATA_FORMAT.NPY]: 'NumPy .npy',
  [DATA_FORMAT.NPZ]: 'NumPy .npz',
  [DATA_FORMAT.NETCDF3]: 'NetCDF-3',
  [DATA_FORMAT.BINARY]: 'raw binary',
  [DATA_FORMAT.UNKNOWN]: 'unknown'
});

const EXTENSION_FORMAT = Object.freeze({
  json: DATA_FORMAT.JSON,
  geojson: DATA_FORMAT.JSON,
  csv: DATA_FORMAT.DELIMITED,
  tsv: DATA_FORMAT.DELIMITED,
  tab: DATA_FORMAT.DELIMITED,
  txt: DATA_FORMAT.DELIMITED,
  npy: DATA_FORMAT.NPY,
  npz: DATA_FORMAT.NPZ,
  nc: DATA_FORMAT.NETCDF3,
  nc3: DATA_FORMAT.NETCDF3,
  netcdf: DATA_FORMAT.NETCDF3,
  cdf: DATA_FORMAT.NETCDF3,
  bin: DATA_FORMAT.BINARY,
  f32: DATA_FORMAT.BINARY,
  f64: DATA_FORMAT.BINARY,
  dat: DATA_FORMAT.BINARY
});

/** Extensions that describe a container loosely; a text sniff outranks them. */
const WEAK_EXTENSIONS = Object.freeze(new Set(['bin', 'f32', 'f64', 'dat']));

const CONTENT_TYPE_FORMAT = Object.freeze({
  'application/json': DATA_FORMAT.JSON,
  'text/json': DATA_FORMAT.JSON,
  'text/csv': DATA_FORMAT.DELIMITED,
  'text/tab-separated-values': DATA_FORMAT.DELIMITED,
  'text/plain': DATA_FORMAT.DELIMITED,
  'application/x-netcdf': DATA_FORMAT.NETCDF3,
  'application/zip': DATA_FORMAT.NPZ,
  'application/x-npy': DATA_FORMAT.NPY
});

const NPY_MAGIC_FIRST_BYTE = 0x93;
const NPY_MAGIC_REST = [0x4e, 0x55, 0x4d, 0x50, 0x59]; // "NUMPY"
const GZIP_MAGIC = [0x1f, 0x8b];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const NETCDF_MAGIC = [0x43, 0x44, 0x46]; // "CDF"
const NETCDF_VERSIONS = [1, 2, 5];
const TEXT_SNIFF_BYTES = 512;

export function formatLabel(format) {
  return FORMAT_LABELS[format] || format;
}

/** Strip query string and hash so ".csv?token=1" still detects as csv. */
export function stripUrlDecorations(url) {
  return String(url || '').split('#')[0].split('?')[0];
}

/** Lower-case final extension of a URL or file name, without the dot. */
export function extensionOf(url) {
  const path = stripUrlDecorations(url);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function toBytes(head) {
  if (!head) return null;
  if (typeof head === 'string') return new TextEncoder().encode(head.slice(0, TEXT_SNIFF_BYTES));
  if (head instanceof Uint8Array) return head;
  if (head instanceof ArrayBuffer) return new Uint8Array(head);
  if (ArrayBuffer.isView(head)) return new Uint8Array(head.buffer, head.byteOffset, head.byteLength);
  return null;
}

function startsWith(bytes, signature, offset = 0) {
  if (!bytes || bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function decodeHead(bytes) {
  if (!bytes) return '';
  const slice = bytes.subarray(0, Math.min(bytes.length, TEXT_SNIFF_BYTES));
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}

function looksLikeJson(text) {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function looksLikeDelimited(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  return /[,;\t]/.test(firstLine);
}

function sniffCompression(bytes) {
  if (startsWith(bytes, GZIP_MAGIC)) return COMPRESSION.GZIP;
  if (startsWith(bytes, ZIP_MAGIC)) return COMPRESSION.ZIP;
  return null;
}

/** ".csv.gz" resolves through to "csv"; a bare ".gz" resolves to nothing. */
function formatFromExtension(url) {
  const trimmed = stripUrlDecorations(url);
  let extension = extensionOf(trimmed);
  if (extension === 'gz' || extension === 'gzip') {
    extension = extensionOf(trimmed.slice(0, trimmed.lastIndexOf('.')));
  }
  return { format: EXTENSION_FORMAT[extension] || null, extension };
}

function formatFromMagic(bytes, extension) {
  if (!bytes || bytes.length === 0) return null;
  if (bytes[0] === NPY_MAGIC_FIRST_BYTE && startsWith(bytes, NPY_MAGIC_REST, 1)) return DATA_FORMAT.NPY;
  if (startsWith(bytes, NETCDF_MAGIC) && NETCDF_VERSIONS.includes(bytes[3])) return DATA_FORMAT.NETCDF3;
  // A ZIP container is only ever read as a NumPy archive; other ZIP payloads are rejected by the parser.
  if (startsWith(bytes, ZIP_MAGIC)) return DATA_FORMAT.NPZ;
  return null;
}

/**
 * @param {string|ArrayBuffer|ArrayBufferView|null} head first bytes of the response
 * @param {{url?: string, format?: string, contentType?: string}} options
 * @returns {{format: string, compressed: string|null, extension: string, evidence: string}}
 */
export function detectFormat(head, options = {}) {
  const bytes = toBytes(head);
  const { format: fromExtension, extension } = formatFromExtension(options.url);
  const compressed = sniffCompression(bytes);
  const override = options.format ? String(options.format).toLowerCase().trim() : null;

  if (override) {
    if (!Object.values(DATA_FORMAT).includes(override)) {
      throw new Error(`Unsupported format "${options.format}". Use one of ${Object.values(DATA_FORMAT).join(', ')}.`);
    }
    const resolvedCompression = compressed ?? (extension === 'gz' || extension === 'gzip' ? COMPRESSION.GZIP : null);
    return { format: override, compressed: resolvedCompression, extension, evidence: 'format attribute' };
  }

  const fromMagic = formatFromMagic(bytes, extension);
  if (fromMagic) {
    return {
      format: fromMagic,
      compressed: compressed ?? (fromMagic === DATA_FORMAT.NPZ ? COMPRESSION.ZIP : null),
      extension,
      evidence: 'byte signature'
    };
  }

  const strongExtension = fromExtension && fromExtension !== DATA_FORMAT.DELIMITED && !WEAK_EXTENSIONS.has(extension);
  if (strongExtension) {
    return { format: fromExtension, compressed, extension, evidence: 'file extension' };
  }

  const text = decodeHead(bytes);
  if (looksLikeJson(text)) {
    return { format: DATA_FORMAT.JSON, compressed, extension, evidence: 'text sniff' };
  }

  if (fromExtension) {
    return { format: fromExtension, compressed, extension, evidence: 'file extension' };
  }

  if (looksLikeDelimited(text)) {
    return { format: DATA_FORMAT.DELIMITED, compressed, extension, evidence: 'text sniff' };
  }

  const contentType = String(options.contentType || '').split(';')[0].trim().toLowerCase();
  if (CONTENT_TYPE_FORMAT[contentType]) {
    return { format: CONTENT_TYPE_FORMAT[contentType], compressed, extension, evidence: 'content type' };
  }

  const hasBinaryBytes = bytes
    ? bytes.subarray(0, Math.min(bytes.length, 64)).some((value) => value === 0 || value > 0x7f)
    : false;
  return {
    format: hasBinaryBytes ? DATA_FORMAT.BINARY : DATA_FORMAT.UNKNOWN,
    compressed,
    extension,
    evidence: hasBinaryBytes ? 'binary heuristic' : 'nothing conclusive'
  };
}
