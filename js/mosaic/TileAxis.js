/** Axis annotated against the shared projector of an adjacent tile. */
import { AxisTics } from './AxisTics.js';
import { AxisScale } from './AxisScale.js';

function makeTicks(projector, start, span, count) {
  const first = projector.v(start);
  const last = projector.v(start + span);
  if (projector.scale === AxisScale.LOG10) {
    const minExponent = Math.ceil(Math.log10(Math.min(first, last)));
    const maxExponent = Math.floor(Math.log10(Math.max(first, last)));
    const values = [];
    for (let exponent = minExponent; exponent <= maxExponent; exponent++) values.push(10 ** exponent);
    return { majorValues: () => values };
  }
  return new AxisTics(first, last, count);
}

export class TileAxis {
  constructor(mosaic, placement, index) {
    this.mosaic = mosaic;
    this.placement = placement;
    this.index = index;
    this.label = '';
    this.formatter = AxisTics.format;
    this.tickCount = 7;
  }

  isTop() { return this.placement === 'top'; }
  isBottom() { return this.placement === 'bottom'; }
  isLeft() { return this.placement === 'left'; }
  isRight() { return this.placement === 'right'; }
  isHorizontal() { return this.isTop() || this.isBottom(); }
  isVertical() { return this.isLeft() || this.isRight(); }
  getIndex() { return this.index; }
  getPlacement() { return this.placement; }
  getTile() { return this.isHorizontal() ? this.mosaic.getTile(0, this.index) : this.mosaic.getTile(this.index, 0); }

  setLabel(label) { this.label = label || ''; this.mosaic.requestRender(); return this; }
  getLabel() { return this.label; }
  setFormat(formatter) {
    if (typeof formatter !== 'function') throw new TypeError('Axis format must be a function.');
    this.formatter = formatter;
    this.mosaic.requestRender();
    return this;
  }

  paint(context, width, height) {
    const tile = this.getTile();
    const horizontal = this.isHorizontal();
    const projector = horizontal ? tile.horizontalProjector : tile.verticalProjector;
    const rectangle = tile.viewRectangle;
    const start = horizontal ? rectangle.x : rectangle.y;
    const span = horizontal ? rectangle.width : rectangle.height;
    const ticks = makeTicks(projector, start, span, this.tickCount);
    const values = ticks.majorValues();
    const isBottom = this.isBottom();
    const isLeft = this.isLeft();

    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0e1721';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#45576a';
    context.fillStyle = '#9babbc';
    context.lineWidth = 1;
    context.font = '10px "DM Mono", monospace';

    if (horizontal) {
      const baseline = isBottom ? 1 : height - 1;
      context.beginPath();
      context.moveTo(0, baseline);
      context.lineTo(width, baseline);
      for (const value of values) {
        const normalized = projector.u(value);
        const pixel = (normalized - rectangle.x) / rectangle.width * (width - 1);
        if (pixel < -1 || pixel > width + 1) continue;
        context.moveTo(pixel, baseline);
        context.lineTo(pixel, baseline + (isBottom ? 5 : -5));
      }
      context.stroke();
      context.textAlign = 'center';
      context.textBaseline = isBottom ? 'top' : 'bottom';
      for (const value of values) {
        const pixel = (projector.u(value) - rectangle.x) / rectangle.width * (width - 1);
        if (pixel < 15 || pixel > width - 15) continue;
        context.fillText(this.formatter(value), pixel, baseline + (isBottom ? 7 : -7));
      }
      if (this.label) {
        context.fillStyle = '#d4dee8';
        context.textBaseline = isBottom ? 'bottom' : 'top';
        context.fillText(this.label, width / 2, isBottom ? height - 2 : 2);
      }
    } else {
      const baseline = isLeft ? width - 1 : 0;
      context.beginPath();
      context.moveTo(baseline, 0);
      context.lineTo(baseline, height);
      for (const value of values) {
        const normalized = projector.u(value);
        const pixel = (normalized - rectangle.y) / rectangle.height * (height - 1);
        if (pixel < -1 || pixel > height + 1) continue;
        context.moveTo(baseline, pixel);
        context.lineTo(baseline + (isLeft ? -5 : 5), pixel);
      }
      context.stroke();
      context.textAlign = isLeft ? 'right' : 'left';
      context.textBaseline = 'middle';
      for (const value of values) {
        const pixel = (projector.u(value) - rectangle.y) / rectangle.height * (height - 1);
        if (pixel < 8 || pixel > height - 8) continue;
        context.fillText(this.formatter(value), baseline + (isLeft ? -8 : 8), pixel);
      }
      if (this.label) {
        context.save();
        context.translate(isLeft ? 11 : width - 11, height / 2);
        context.rotate(-Math.PI / 2);
        context.fillStyle = '#d4dee8';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(this.label, 0, 0);
        context.restore();
      }
    }
  }
}
