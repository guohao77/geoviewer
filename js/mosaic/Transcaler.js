/**
 * Normalized-coordinate ↔ device-pixel mapping for one tile.
 * Design reference: Mines JTK Mosaic Transcaler (Apache-2.0 Java package).
 */
export class Transcaler {
  constructor(width = 1, height = 1, viewRect = { x: 0, y: 0, width: 1, height: 1 }) {
    this.setMapping(width, height, viewRect);
  }

  setMapping(width, height, viewRect = this.viewRect) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.viewRect = { ...viewRect };
    return this;
  }

  /** A visible normalized x-coordinate to a canvas pixel. */
  x(normalized) {
    return ((normalized - this.viewRect.x) / this.viewRect.width) * (this.width - 1);
  }

  /** A visible normalized y-coordinate to a canvas pixel. */
  y(normalized) {
    return ((normalized - this.viewRect.y) / this.viewRect.height) * (this.height - 1);
  }

  worldToPixelX(value, projector) { return this.x(projector.u(value)); }
  worldToPixelY(value, projector) { return this.y(projector.u(value)); }

  pixelToWorldX(pixel, projector) {
    return projector.v(this.viewRect.x + pixel / Math.max(1, this.width - 1) * this.viewRect.width);
  }

  pixelToWorldY(pixel, projector) {
    return projector.v(this.viewRect.y + pixel / Math.max(1, this.height - 1) * this.viewRect.height);
  }

  pixelToNormalizedX(pixel) {
    return this.viewRect.x + pixel / Math.max(1, this.width - 1) * this.viewRect.width;
  }

  pixelToNormalizedY(pixel) {
    return this.viewRect.y + pixel / Math.max(1, this.height - 1) * this.viewRect.height;
  }
}
