/** One cell in a Mosaic; multiple TiledViews are painted in insertion order. */
import { Projector } from './Projector.js';
import { Transcaler } from './Transcaler.js';

export class Tile {
  constructor(mosaic, rowIndex, columnIndex) {
    this.mosaic = mosaic;
    this.rowIndex = rowIndex;
    this.columnIndex = columnIndex;
    this.tiledViews = [];
    this.horizontalProjector = new Projector(0, 1);
    this.verticalProjector = new Projector(1, 0);
    this.bestHorizontalProjector = null;
    this.bestVerticalProjector = null;
    this.specifiedHorizontalProjector = null;
    this.specifiedVerticalProjector = null;
    this.viewRectangle = { x: 0, y: 0, width: 1, height: 1 };
  }

  getRowIndex() { return this.rowIndex; }
  getColumnIndex() { return this.columnIndex; }
  getHorizontalProjector() { return this.horizontalProjector; }
  getVerticalProjector() { return this.verticalProjector; }
  getBestHorizontalProjector() { return this.specifiedHorizontalProjector || this.bestHorizontalProjector; }
  getBestVerticalProjector() { return this.specifiedVerticalProjector || this.bestVerticalProjector; }
  getViewRectangle() { return { ...this.viewRectangle }; }
  getTiledViews() { return [...this.tiledViews]; }

  addTiledView(view) {
    if (!(view instanceof Object) || typeof view.paint !== 'function') throw new TypeError('Expected a TiledView-like object.');
    const existing = this.tiledViews.indexOf(view);
    if (existing >= 0) this.tiledViews.splice(existing, 1);
    else if (view.tile && view.tile !== this) view.tile.removeTiledView(view);
    this.tiledViews.push(view);
    view.setTile?.(this);
    this.mosaic.alignProjectors();
    return existing < 0;
  }

  removeTiledView(view) {
    const index = this.tiledViews.indexOf(view);
    if (index < 0) return false;
    this.tiledViews.splice(index, 1);
    view.setTile?.(null);
    this.mosaic.alignProjectors();
    return true;
  }

  setViewRectangle(rectangle) { this.mosaic.setViewRectangle(this, rectangle); }

  setLimits(horizontalMin, verticalMin, horizontalMax, verticalMax) {
    if (!(horizontalMin < horizontalMax) || !(verticalMin < verticalMax)) {
      throw new RangeError('Axis limits must be finite and increasing.');
    }
    this.specifiedHorizontalProjector = new Projector(horizontalMin, horizontalMax);
    this.specifiedVerticalProjector = new Projector(verticalMax, verticalMin);
    this.mosaic.alignProjectors();
    return this;
  }

  setHLimits(min, max) {
    if (!(min < max)) throw new RangeError('Horizontal limits must be increasing.');
    this.specifiedHorizontalProjector = new Projector(min, max);
    this.mosaic.alignProjectors();
    return this;
  }

  setVLimits(min, max) {
    if (!(min < max)) throw new RangeError('Vertical limits must be increasing.');
    this.specifiedVerticalProjector = new Projector(max, min);
    this.mosaic.alignProjectors();
    return this;
  }

  setLimitsDefault() {
    this.specifiedHorizontalProjector = null;
    this.specifiedVerticalProjector = null;
    this.mosaic.alignProjectors();
    return this;
  }

  setHLimitsDefault() {
    this.specifiedHorizontalProjector = null;
    this.mosaic.alignProjectors();
    return this;
  }

  setVLimitsDefault() {
    this.specifiedVerticalProjector = null;
    this.mosaic.alignProjectors();
    return this;
  }

  getTranscaler(width, height) {
    return new Transcaler(width, height, this.viewRectangle);
  }

  paint(context, width, height) {
    const transcaler = this.getTranscaler(width, height);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    for (const view of this.tiledViews) view.paint(context, { tile: this, transcaler });
    context.restore();
  }
}
