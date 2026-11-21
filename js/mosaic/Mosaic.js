/**
 * A fixed matrix of Tiles whose projectors and normalized view rectangles align by row/column.
 * Architecture follows Dave Hale's Mines JTK Mosaic design; JS implementation is fresh.
 */
import { Projector } from './Projector.js';
import { Tile } from './Tile.js';
import { TileAxis } from './TileAxis.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class Mosaic {
  constructor(rowCount, columnCount, axesPlacement = ['left', 'bottom']) {
    if (!Number.isInteger(rowCount) || rowCount < 1 || !Number.isInteger(columnCount) || columnCount < 1) {
      throw new RangeError('A Mosaic requires positive integer row and column counts.');
    }
    this.rowCount = rowCount;
    this.columnCount = columnCount;
    this.axesPlacement = new Set(axesPlacement);
    this.tiles = Array.from({ length: rowCount }, (_, row) =>
      Array.from({ length: columnCount }, (_, column) => new Tile(this, row, column))
    );
    this.topAxes = this.axesPlacement.has('top') ? Array.from({ length: columnCount }, (_, column) => new TileAxis(this, 'top', column)) : null;
    this.bottomAxes = this.axesPlacement.has('bottom') ? Array.from({ length: columnCount }, (_, column) => new TileAxis(this, 'bottom', column)) : null;
    this.leftAxes = this.axesPlacement.has('left') ? Array.from({ length: rowCount }, (_, row) => new TileAxis(this, 'left', row)) : null;
    this.rightAxes = this.axesPlacement.has('right') ? Array.from({ length: rowCount }, (_, row) => new TileAxis(this, 'right', row)) : null;
    this.changeHandler = null;
    this.interpretationMode = false;
    this.interpretationViews = [];
    this.activeInterpretationView = null;
    this.alignProjectors();
  }

  countRows() { return this.rowCount; }
  countColumns() { return this.columnCount; }
  getTile(row, column) { return this.tiles[row]?.[column] ?? null; }
  getTileAxisTop(column) { return this.topAxes?.[column] ?? null; }
  getTileAxisBottom(column) { return this.bottomAxes?.[column] ?? null; }
  getTileAxisLeft(row) { return this.leftAxes?.[row] ?? null; }
  getTileAxisRight(row) { return this.rightAxes?.[row] ?? null; }
  setChangeHandler(handler) { this.changeHandler = handler; }
  requestRender() { this.changeHandler?.(); }

  /** Merge views into one horizontal projector per column and one vertical projector per row. */
  alignProjectors() {
    for (const row of this.tiles) {
      for (const tile of row) {
        tile.bestHorizontalProjector = tile.specifiedHorizontalProjector || Projector.merge(tile.tiledViews.map((view) => view.bestHorizontalProjector));
        tile.bestVerticalProjector = tile.specifiedVerticalProjector || Projector.merge(tile.tiledViews.map((view) => view.bestVerticalProjector));
      }
    }
    for (let column = 0; column < this.columnCount; column++) {
      const projector = Projector.merge(this.tiles.map((row) => row[column].bestHorizontalProjector)) || new Projector(0, 1);
      for (let row = 0; row < this.rowCount; row++) this.tiles[row][column].horizontalProjector = projector;
    }
    for (let row = 0; row < this.rowCount; row++) {
      const projector = Projector.merge(this.tiles[row].map((tile) => tile.bestVerticalProjector)) || new Projector(1, 0);
      for (let column = 0; column < this.columnCount; column++) this.tiles[row][column].verticalProjector = projector;
    }
    this.requestRender();
  }

  /**
   * Apply the requested normalized view to one tile. Horizontal view state is
   * shared down its column; vertical view state is shared across its row.
   */
  setViewRectangle(tile, rectangle) {
    const current = tile.viewRectangle;
    const width = clamp(Number(rectangle.width), 0.002, 1);
    const height = clamp(Number(rectangle.height), 0.002, 1);
    const x = clamp(Number(rectangle.x), 0, 1 - width);
    const y = clamp(Number(rectangle.y), 0, 1 - height);
    for (let row = 0; row < this.rowCount; row++) {
      const sameColumn = this.tiles[row][tile.columnIndex];
      sameColumn.viewRectangle = { ...sameColumn.viewRectangle, x, width };
    }
    for (let column = 0; column < this.columnCount; column++) {
      const sameRow = this.tiles[tile.rowIndex][column];
      sameRow.viewRectangle = { ...sameRow.viewRectangle, y, height };
    }
    if (current.x !== x || current.y !== y || current.width !== width || current.height !== height) this.requestRender();
  }

  resetView() {
    for (const row of this.tiles) {
      for (const tile of row) tile.viewRectangle = { x: 0, y: 0, width: 1, height: 1 };
    }
    this.requestRender();
  }

  zoomAt(tile, localX, localY, factor) {
    const view = tile.viewRectangle;
    const width = clamp(view.width / factor, 0.002, 1);
    const height = clamp(view.height / factor, 0.002, 1);
    const anchorX = view.x + clamp(localX, 0, 1) * view.width;
    const anchorY = view.y + clamp(localY, 0, 1) * view.height;
    this.setViewRectangle(tile, {
      x: anchorX - localX * width,
      y: anchorY - localY * height,
      width,
      height
    });
  }

  pan(tile, deltaX, deltaY) {
    const view = tile.viewRectangle;
    this.setViewRectangle(tile, {
      x: view.x + deltaX,
      y: view.y + deltaY,
      width: view.width,
      height: view.height
    });
  }
}
