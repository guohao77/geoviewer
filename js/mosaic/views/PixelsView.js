/** Raster/scalar-field TiledView. Matrix rows are ordered from low to high world Y. */
import { Projector } from '../Projector.js';
import { TiledView } from '../TiledView.js';
import { normalizeInterpolation, resampleGrid } from '../GridInterpolation.js';

function centersToEdges(values) {
  if (values.length === 1) return [values[0] - 0.5, values[0] + 0.5];
  const edges = new Array(values.length + 1);
  for (let index = 1; index < values.length; index++) edges[index] = (values[index - 1] + values[index]) / 2;
  edges[0] = values[0] - (edges[1] - values[0]);
  edges[values.length] = values.at(-1) + (values.at(-1) - edges[values.length - 1]);
  return edges;
}

function niceRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    return [min - pad, max + pad];
  }
  return [min, max];
}

export class PixelsView extends TiledView {
  constructor(values, options = {}) {
    super();
    this.values = values;
    this.x = options.x || Array.from({ length: values?.[0]?.length || 0 }, (_, index) => index);
    this.y = options.y || Array.from({ length: values?.length || 0 }, (_, index) => index);
    this.colorMap = options.colorMap;
    this.opacity = options.opacity ?? 1;
    this.interpolation = normalizeInterpolation(options.interpolation || 'nearest');
    this._updateProjectors();
  }

  set(values, options = {}) {
    this.values = values;
    if (options.x) this.x = options.x;
    if (options.y) this.y = options.y;
    this._updateProjectors();
    return this;
  }

  setColorMap(colorMap) { this.colorMap = colorMap; this.tile?.mosaic.requestRender(); return this; }
  setInterpolation(interpolation) {
    this.interpolation = normalizeInterpolation(interpolation);
    this.tile?.mosaic.requestRender();
    return this;
  }

  getRange() {
    let min = Infinity;
    let max = -Infinity;
    for (const row of this.values || []) {
      for (const value of row || []) {
        if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
      }
    }
    return niceRange(min, max);
  }

  _updateProjectors() {
    const rows = this.values?.length || 0;
    const columns = rows ? Math.min(...this.values.map((row) => row?.length || 0)) : 0;
    if (!rows || !columns) { this.setBestProjectors(null, null); return; }
    const xEdges = centersToEdges(this.x.slice(0, columns));
    const yEdges = centersToEdges(this.y.slice(0, rows));
    this.xEdges = xEdges;
    this.yEdges = yEdges;
    const xMin = Math.min(xEdges[0], xEdges.at(-1));
    const xMax = Math.max(xEdges[0], xEdges.at(-1));
    const yMin = Math.min(yEdges[0], yEdges.at(-1));
    const yMax = Math.max(yEdges[0], yEdges.at(-1));
    this.setBestProjectors(new Projector(xMin, xMax), new Projector(yMax, yMin));
  }

  paint(context, { tile, transcaler }) {
    if (!this.colorMap || !this.values?.length) return;
    const rows = this.values.length;
    const columns = Math.min(...this.values.map((row) => row?.length || 0));
    if (!columns) return;
    const range = this.getRange();
    this.colorMap.setRange(...range);
    const hp = tile.horizontalProjector;
    const vp = tile.verticalProjector;
    const raster = resampleGrid(this.values, this.interpolation, 4);
    const rasterRows = raster.values.length;
    const rasterColumns = rasterRows ? raster.values[0].length : 0;
    if (!rasterRows || !rasterColumns) return;
    const rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = rasterColumns;
    rasterCanvas.height = rasterRows;
    const rasterContext = rasterCanvas.getContext('2d');
    const image = rasterContext.createImageData(rasterColumns, rasterRows);
    for (let screenRow = 0; screenRow < rasterRows; screenRow++) {
      // Input row 0 corresponds to the lowest world-Y coordinate; canvas row 0 is at the top.
      const sourceRow = rasterRows - 1 - screenRow;
      for (let column = 0; column < rasterColumns; column++) {
        const rgba = this.colorMap.rgba(raster.values[sourceRow][column]);
        image.data.set(rgba, (screenRow * rasterColumns + column) * 4);
      }
    }
    rasterContext.putImageData(image, 0, 0);
    const left = transcaler.worldToPixelX(this.xEdges[0], hp);
    const right = transcaler.worldToPixelX(this.xEdges.at(-1), hp);
    const top = transcaler.worldToPixelY(this.yEdges.at(-1), vp);
    const bottom = transcaler.worldToPixelY(this.yEdges[0], vp);
    context.save();
    context.beginPath();
    context.rect(0, 0, transcaler.width, transcaler.height);
    context.clip();
    context.globalAlpha = this.opacity;
    context.imageSmoothingEnabled = this.interpolation !== 'nearest';
    context.imageSmoothingQuality = this.interpolation === 'cubic' ? 'high' : 'medium';
    context.drawImage(rasterCanvas, Math.min(left, right), Math.min(top, bottom), Math.abs(right - left), Math.abs(bottom - top));
    context.restore();
  }
}
