/** A lightweight PointsView for line and marker plots in a Mosaic Tile. */
import { Projector } from '../Projector.js';
import { TiledView } from '../TiledView.js';

function expandedRange(min, max) {
  if (min !== max) return [min, max];
  const padding = Math.max(1, Math.abs(min) * 0.05);
  return [min - padding, max + padding];
}

export class PointsView extends TiledView {
  constructor(x = [], y = [], options = {}) {
    super();
    this.color = options.color || '#5dd6ca';
    this.lineWidth = options.lineWidth ?? 1.8;
    this.markerRadius = options.markerRadius ?? 0;
    this.connect = options.connect !== false;
    this.set(x, y);
  }

  set(x, y) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) {
      throw new TypeError('PointsView requires equal-length x and y arrays.');
    }
    this.x = x.map(Number);
    this.y = y.map(Number);
    const points = this.x.map((value, index) => [value, this.y[index]])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (!points.length) {
      this.setBestProjectors(null, null);
      return this;
    }
    const xs = points.map(([value]) => value);
    const ys = points.map(([, value]) => value);
    const [xmin, xmax] = expandedRange(Math.min(...xs), Math.max(...xs));
    const [ymin, ymax] = expandedRange(Math.min(...ys), Math.max(...ys));
    // Canvas y increases downward, so the vertical projector is intentionally reversed.
    this.setBestProjectors(
      new Projector(xmin, xmax, 0.02, 0.98),
      new Projector(ymax, ymin, 0.02, 0.98)
    );
    return this;
  }

  paint(context, { tile, transcaler }) {
    const hp = tile.horizontalProjector;
    const vp = tile.verticalProjector;
    const visible = tile.viewRectangle;
    context.save();
    context.beginPath();
    context.rect(0, 0, transcaler.width, transcaler.height);
    context.clip();
    context.strokeStyle = this.color;
    context.fillStyle = this.color;
    context.lineWidth = this.lineWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';

    let started = false;
    context.beginPath();
    for (let index = 0; index < this.x.length; index++) {
      const x = this.x[index];
      const y = this.y[index];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
      const u = hp.u(x);
      const v = vp.u(y);
      const px = transcaler.x(u);
      const py = transcaler.y(v);
      if (this.connect) {
        if (!started) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      started = true;
      if (this.markerRadius > 0) {
        context.moveTo(px + this.markerRadius, py);
        context.arc(px, py, this.markerRadius, 0, Math.PI * 2);
      }
    }
    if (this.connect) context.stroke();
    if (this.markerRadius > 0) context.fill();
    context.restore();
  }
}
