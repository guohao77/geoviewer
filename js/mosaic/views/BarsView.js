/** Bar-series TiledView with automatic bounds and optional per-bar colors. */
import { Projector } from '../Projector.js';
import { TiledView } from '../TiledView.js';

export class BarsView extends TiledView {
  constructor(values = [], options = {}) {
    super();
    this.values = values.map(Number);
    this.x = options.x ? options.x.map(Number) : values.map((_, index) => index);
    this.color = options.color || '#70a7ff';
    this.colors = options.colors || null;
    this.barWidth = options.barWidth ?? 0.72;
    this.zero = options.zero ?? 0;
    this.set(this.x, this.values);
  }

  set(x, values) {
    if (!Array.isArray(x) || !Array.isArray(values) || x.length !== values.length) {
      throw new TypeError('BarsView requires equal-length x and value arrays.');
    }
    this.x = x.map(Number);
    this.values = values.map(Number);
    const valid = this.x.map((value, index) => [value, this.values[index]])
      .filter(([xValue, yValue]) => Number.isFinite(xValue) && Number.isFinite(yValue));
    if (!valid.length) { this.setBestProjectors(null, null); return this; }
    const xMin = Math.min(...valid.map(([value]) => value));
    const xMax = Math.max(...valid.map(([value]) => value));
    const yMin = Math.min(this.zero, ...valid.map(([, value]) => value));
    const yMax = Math.max(this.zero, ...valid.map(([, value]) => value));
    const xPad = xMin === xMax ? 0.6 : (xMax - xMin) / Math.max(1, valid.length - 1) * 0.65;
    const yPad = yMin === yMax ? 1 : (yMax - yMin) * 0.06;
    this.setBestProjectors(
      new Projector(xMin - xPad, xMax + xPad),
      new Projector(yMax + yPad, yMin - yPad)
    );
    return this;
  }

  paint(context, { tile, transcaler }) {
    if (!this.values.length) return;
    const hp = tile.horizontalProjector;
    const vp = tile.verticalProjector;
    const baseline = transcaler.worldToPixelY(this.zero, vp);
    const sortedX = this.x.filter(Number.isFinite).sort((a, b) => a - b);
    const gaps = sortedX.slice(1).map((value, index) => value - sortedX[index]).filter((value) => value > 0);
    const nearestGap = gaps.length ? Math.min(...gaps) : 1;
    const halfWidth = nearestGap * this.barWidth / 2;

    context.save();
    context.beginPath();
    context.rect(0, 0, transcaler.width, transcaler.height);
    context.clip();
    context.lineWidth = 1;
    for (let index = 0; index < this.values.length; index++) {
      const x = this.x[index];
      const value = this.values[index];
      if (!Number.isFinite(x) || !Number.isFinite(value)) continue;
      const left = transcaler.worldToPixelX(x - halfWidth, hp);
      const right = transcaler.worldToPixelX(x + halfWidth, hp);
      const top = transcaler.worldToPixelY(value, vp);
      const barTop = Math.min(top, baseline);
      const barHeight = Math.max(1, Math.abs(baseline - top));
      context.fillStyle = this.colors?.[index] || this.color;
      context.fillRect(Math.min(left, right), barTop, Math.max(1, Math.abs(right - left)), barHeight);
      context.strokeStyle = 'rgba(230, 237, 245, 0.22)';
      context.strokeRect(Math.min(left, right) + 0.5, barTop + 0.5, Math.max(0, Math.abs(right - left) - 1), Math.max(0, barHeight - 1));
    }
    context.strokeStyle = 'rgba(190, 204, 218, 0.5)';
    context.beginPath();
    context.moveTo(0, baseline);
    context.lineTo(transcaler.width, baseline);
    context.stroke();
    context.restore();
  }
}
