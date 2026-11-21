/** Grid lines aligned with the tick locations used by adjacent TileAxis instances. */
import { AxisScale } from '../AxisScale.js';
import { AxisTics } from '../AxisTics.js';
import { TiledView } from '../TiledView.js';

function ticksFor(projector, start, span) {
  const first = projector.v(start);
  const last = projector.v(start + span);
  if (projector.scale === AxisScale.LOG10) {
    const low = Math.min(first, last);
    const high = Math.max(first, last);
    const values = [];
    for (let exponent = Math.ceil(Math.log10(low)); exponent <= Math.floor(Math.log10(high)); exponent++) {
      values.push(10 ** exponent);
    }
    return values;
  }
  return new AxisTics(first, last, 7).majorValues();
}

export class GridView extends TiledView {
  constructor(options = {}) {
    super();
    this.color = options.color || 'rgba(125, 149, 173, 0.18)';
    this.width = options.width ?? 1;
    this.horizontal = options.horizontal !== false;
    this.vertical = options.vertical !== false;
  }

  paint(context, { tile, transcaler }) {
    const rectangle = tile.viewRectangle;
    const xs = this.vertical ? ticksFor(tile.horizontalProjector, rectangle.x, rectangle.width) : [];
    const ys = this.horizontal ? ticksFor(tile.verticalProjector, rectangle.y, rectangle.height) : [];
    context.save();
    context.beginPath();
    context.rect(0, 0, transcaler.width, transcaler.height);
    context.clip();
    context.strokeStyle = this.color;
    context.lineWidth = this.width;
    context.beginPath();
    for (const value of xs) {
      const x = transcaler.x(tile.horizontalProjector.u(value));
      context.moveTo(x, 0);
      context.lineTo(x, transcaler.height);
    }
    for (const value of ys) {
      const y = transcaler.y(tile.verticalProjector.u(value));
      context.moveTo(0, y);
      context.lineTo(transcaler.width, y);
    }
    context.stroke();
    context.restore();
  }
}
