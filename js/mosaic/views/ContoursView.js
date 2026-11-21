/** Marching-squares isolines for a regular scalar grid. */
import { AxisTics } from '../AxisTics.js';
import { Projector } from '../Projector.js';
import { TiledView } from '../TiledView.js';
import { normalizeInterpolation, resampleGrid } from '../GridInterpolation.js';

const EDGE_CORNERS = [[0, 1], [1, 2], [2, 3], [3, 0]];

function interpolate(a, b, level) {
  const denominator = b.value - a.value;
  const t = denominator === 0 ? 0.5 : Math.max(0, Math.min(1, (level - a.value) / denominator));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export class ContoursView extends TiledView {
  constructor(values, options = {}) {
    super();
    this.values = values || [];
    this.x = options.x || Array.from({ length: this.values[0]?.length || 0 }, (_, index) => index);
    this.y = options.y || Array.from({ length: this.values.length }, (_, index) => index);
    this.colorMap = options.colorMap;
    this.levelCount = options.levelCount ?? 10;
    this.lineWidth = options.lineWidth ?? 1.15;
    this.interpolation = normalizeInterpolation(options.interpolation || 'linear');
    this._updateLimits();
  }

  getRange() {
    let min = Infinity;
    let max = -Infinity;
    for (const row of this.values) for (const value of row || []) {
      if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
    }
    if (!Number.isFinite(min) || min === max) {
      const center = Number.isFinite(min) ? min : 0;
      const pad = Math.max(1, Math.abs(center) * 0.05);
      return [center - pad, center + pad];
    }
    return [min, max];
  }

  setColorMap(colorMap) { this.colorMap = colorMap; this.tile?.mosaic.requestRender(); return this; }
  setInterpolation(interpolation) {
    this.interpolation = normalizeInterpolation(interpolation);
    this.tile?.mosaic.requestRender();
    return this;
  }

  _updateLimits() {
    const rows = this.values.length;
    const columns = rows ? Math.min(...this.values.map((row) => row?.length || 0)) : 0;
    if (rows < 2 || columns < 2) { this.setBestProjectors(null, null); return; }
    const x0 = this.x[0];
    const x1 = this.x[columns - 1];
    const y0 = this.y[0];
    const y1 = this.y[rows - 1];
    this.setBestProjectors(new Projector(Math.min(x0, x1), Math.max(x0, x1)), new Projector(Math.max(y0, y1), Math.min(y0, y1)));
  }

  _segmentsForLevel(level, values = this.values, xAxis = this.x, yAxis = this.y) {
    const segments = [];
    const rows = values.length;
    const columns = Math.min(...values.map((row) => row?.length || 0));
    for (let row = 0; row < rows - 1; row++) {
      for (let column = 0; column < columns - 1; column++) {
        const corners = [
          { x: xAxis[column], y: yAxis[row], value: values[row][column] },
          { x: xAxis[column + 1], y: yAxis[row], value: values[row][column + 1] },
          { x: xAxis[column + 1], y: yAxis[row + 1], value: values[row + 1][column + 1] },
          { x: xAxis[column], y: yAxis[row + 1], value: values[row + 1][column] }
        ];
        if (corners.some((corner) => !Number.isFinite(corner.value))) continue;
        const intersections = [];
        for (const [aIndex, bIndex] of EDGE_CORNERS) {
          const a = corners[aIndex];
          const b = corners[bIndex];
          if ((a.value < level && b.value >= level) || (b.value < level && a.value >= level)) {
            intersections.push(interpolate(a, b, level));
          }
        }
        if (intersections.length === 2) segments.push(intersections);
        else if (intersections.length === 4) {
          const centerHigh = corners.reduce((sum, corner) => sum + corner.value, 0) / 4 >= level;
          if (centerHigh) segments.push([intersections[0], intersections[1]], [intersections[2], intersections[3]]);
          else segments.push([intersections[0], intersections[3]], [intersections[1], intersections[2]]);
        }
      }
    }
    return segments;
  }

  paint(context, { tile, transcaler }) {
    if (!this.colorMap || this.values.length < 2) return;
    const [min, max] = this.getRange();
    this.colorMap.setRange(min, max);
    const levels = new AxisTics(min, max, this.levelCount + 1).majorValues()
      .filter((level) => level > min && level < max);
    const sampled = resampleGrid(this.values, this.interpolation, this.interpolation === 'nearest' ? 1 : 4);
    const sampledRows = sampled.values.length;
    const sampledColumns = sampledRows ? sampled.values[0].length : 0;
    const xAxis = Array.from({ length: sampledColumns }, (_, index) => {
      const position = index / sampled.subdivisions;
      const low = Math.floor(position);
      const high = Math.min(this.x.length - 1, low + 1);
      return this.x[low] + (this.x[high] - this.x[low]) * (position - low);
    });
    const yAxis = Array.from({ length: sampledRows }, (_, index) => {
      const position = index / sampled.subdivisions;
      const low = Math.floor(position);
      const high = Math.min(this.y.length - 1, low + 1);
      return this.y[low] + (this.y[high] - this.y[low]) * (position - low);
    });
    const hp = tile.horizontalProjector;
    const vp = tile.verticalProjector;
    context.save();
    context.beginPath();
    context.rect(0, 0, transcaler.width, transcaler.height);
    context.clip();
    context.lineWidth = this.lineWidth;
    for (const level of levels) {
      context.beginPath();
      for (const [a, b] of this._segmentsForLevel(level, sampled.values, xAxis, yAxis)) {
        context.moveTo(transcaler.worldToPixelX(a.x, hp), transcaler.worldToPixelY(a.y, vp));
        context.lineTo(transcaler.worldToPixelX(b.x, hp), transcaler.worldToPixelY(b.y, vp));
      }
      context.strokeStyle = this.colorMap.css(level, 0.92);
      context.stroke();
    }
    context.restore();
  }
}
