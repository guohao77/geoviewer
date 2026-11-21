import { AxisScale } from './AxisScale.js';
import { Projector } from './Projector.js';

/** Base class for a graph layer rendered inside a Mosaic Tile. */
export class TiledView {
  constructor() {
    this.tile = null;
    this.bestHorizontalProjector = null;
    this.bestVerticalProjector = null;
  }

  setTile(tile) { this.tile = tile; }
  getTile() { return this.tile; }
  getHorizontalProjector() { return this.tile?.horizontalProjector || null; }
  getVerticalProjector() { return this.tile?.verticalProjector || null; }
  getTranscaler(width, height) { return this.tile?.getTranscaler(width, height) || null; }
  getHScale() { return this.bestHorizontalProjector?.scale || AxisScale.LINEAR; }
  getVScale() { return this.bestVerticalProjector?.scale || AxisScale.LINEAR; }

  setScales(horizontalScale, verticalScale) {
    const horizontal = this.bestHorizontalProjector;
    const vertical = this.bestVerticalProjector;
    this.setBestProjectors(
      horizontal ? new Projector(horizontal.v0, horizontal.v1, horizontal.u0, horizontal.u1, horizontalScale) : null,
      vertical ? new Projector(vertical.v0, vertical.v1, vertical.u0, vertical.u1, verticalScale) : null
    );
    return this;
  }

  setHScale(scale) { return this.setScales(scale, this.getVScale()); }
  setVScale(scale) { return this.setScales(this.getHScale(), scale); }

  /** Called by subclasses when data/limits change. */
  setBestProjectors(horizontal, vertical) {
    this.bestHorizontalProjector = horizontal;
    this.bestVerticalProjector = vertical;
    this.tile?.mosaic.alignProjectors();
  }

  paint(_context, _state) {
    throw new Error('TiledView.paint(context, state) must be implemented by subclasses.');
  }
}
