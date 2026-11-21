# Mosaic-style scientific graphics for JavaScript

This is a JavaScript/React adaptation of the architecture documented in Dr. Dave Hale's Mines JTK Mosaic package: <https://github.com/dhale/jtk/tree/master/core/src/main/java/edu/mines/jtk/mosaic>. The original Java package is licensed under Apache License 2.0. This implementation follows its design and public concepts, but is newly written JavaScript rather than copied Java source.

## Java-to-JavaScript concepts

| Mines JTK concept | JavaScript implementation |
| --- | --- |
| `Mosaic` | [Mosaic.js](Mosaic.js) — owns an `nrow × ncolumn` tile matrix, edge axes, projector alignment, and normalized view rectangles. |
| `Tile` | [Tile.js](Tile.js) — stores tiled views and per-tile view state; exposes automatic or explicit axis limits. |
| `TiledView` | [TiledView.js](TiledView.js) — base contract for graphical views and their best horizontal/vertical projectors. |
| `Projector` | [Projector.js](Projector.js) — maps world coordinates to normalized coordinates and merges bounds. |
| `Transcaler` | [Transcaler.js](Transcaler.js) — maps normalized coordinates to canvas pixels and back. |
| `TileAxis`, `AxisTics` | [TileAxis.js](TileAxis.js), [AxisTics.js](AxisTics.js) — edge-axis labels and readable linear/log ticks. |
| `PixelsView` | [views/PixelsView.js](views/PixelsView.js) — scalar-grid raster rendered with a shared color map. |
| `ContoursView` | [views/ContoursView.js](views/ContoursView.js) — marching-squares isolines over a scalar grid. |
| `BarsView` | [views/BarsView.js](views/BarsView.js) — zero-baseline numeric bars with automatic projector bounds. |
| `GridView`, `PointsView` | [views/GridView.js](views/GridView.js), [views/PointsView.js](views/PointsView.js) — grid overlay and line/point views. |
| `ColorMap`, `ColorBar` | [ColorMap.js](ColorMap.js), [ColorBar.js](ColorBar.js) — selectable scientific palettes and a numeric legend. |

Horizontal projectors are merged and shared by tiles in the same **column**; vertical projectors are merged and shared by tiles in the same **row**. A tile view-rectangle update propagates its horizontal range down the column and its vertical range across the row. This is the core JTK Mosaic alignment behavior.

## Demo

Open the workspace-level [scientific-data-viewer.html](../../scientific-data-viewer.html). The page uses React for the view tree and native Canvas 2D for rendering; it does not depend on Plotly. Its 2×2 example displays pixels, contours, bars and points with a shared color map. Select among Viridis, Inferno, Magma, Coolwarm, Gray and Turbo to change the raster, contour colors and color-bar legend. Importing CSV uses PapaParse from a CDN. Drag a rectangle over a tile to zoom, Shift-drag to pan, Ctrl/⌘ + wheel to zoom around the cursor, and wheel to scroll. Right-click a tile to reset its row and column; right-click an axis to reset only its linked dimension. Per-column and per-row scrollbars appear when zoomed. Reset view restores the full mosaic.

## Declarative HTML data binding

The mosaic-level `data-source` is optional. Reference a JSON `<script>` tag directly on each view with `data="#tag-id"`; this lets every panel read a different dataset. Raster and contour views read `{ x, y, values }`, while point and bar views read `{ x, y }`. For backward compatibility, a mosaic may still declare one default `data-source` and views can select named objects from it with `data="key"`. A view can also set its own `data-source="#tag-id"` and select a named object using `data-key="key"`.

```html
<mosaic-viewer rows="1" columns="1" axes="left bottom">
	<mosaic-tile row="0" column="0" x-label="Distance (m)" y-label="Elevation (m)">
		<pixels-view data="#elevation-data" color-map="shared"></pixels-view>
		<contours-view data="#elevation-data" color-map="shared" levels="12"></contours-view>
		<points-view data="#station-data" color="#ff5d73"></points-view>
		<grid-view color="rgba(255,255,255,.2)"></grid-view>
	</mosaic-tile>
</mosaic-viewer>
<script type="application/json" id="elevation-data">
	{ "x": [0, 1], "y": [0, 1], "values": [[10, 12], [14, 15]] }
</script>
<script type="application/json" id="station-data">
	{ "x": [0.25, 0.8], "y": [0.4, 0.9] }
</script>
```

Supported tags are `<grid-view>`, `<pixels-view>`, `<contours-view>`, `<bars-view>`, and `<points-view>`. Add `interpolation="nearest"`, `interpolation="linear"`, or `interpolation="cubic"` to either `<pixels-view>` or `<contours-view>`; `bilinear` aliases `linear`, and `bicubic`/`smooth` alias `cubic`. Nearest preserves cell edges, linear uses bilinear scalar sampling, and cubic uses Catmull–Rom sampling for a smoother raster or denser marching-squares contours. The example uses cubic interpolation in both tags. Other view attributes include `data`, `color`, `line-width`, `marker-radius`, `width`, `levels`, and `zero`. Tile axis titles use `x-label` and `y-label`. `rows`, `columns`, and `axes` configure the mosaic. The parser reads these tags on page load; refresh to apply HTML edits.

Add an `<interpretation-view id="field-picks" color="#ff5d73" opacity="0.9" line-width="2.5"></interpretation-view>` to any tile to overlay editable world-coordinate line picks above its other views. Every interpretation view gets its own labeled toolbar group, independent color, opacity, width, undo/finish/clear actions, and JSON save/load. Press **Tab** to toggle interpretation mode; use **Pick here** to choose which overlay receives clicks. The selected tile shows an active pick badge. Double-click or press **Enter** to finish a pick. **Ctrl/⌘Z** removes the most recent vertex (or last pick when no pick is in progress), and **Esc** cancels the draft and returns to view mode. Pick coordinates and per-pick styles are included in each exported file.

The current port includes representative pixel, contour, bar, point, grid and color-bar views, but it does not yet include every JTK feature such as tensor fields, 3-D pixel plots, or Swing mode managers. Add a new `TiledView` subclass to provide additional renderers.
