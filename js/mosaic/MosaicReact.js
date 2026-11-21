/** React/canvas adapter for the Mosaic, Tile, TileAxis and TiledView model. */
import { Mosaic } from './Mosaic.js';
import { ColorBar } from './ColorBar.js';
import { ColorMap } from './ColorMap.js';
import { BarsView } from './views/BarsView.js';
import { ContoursView } from './views/ContoursView.js';
import { GridView } from './views/GridView.js';
import { InterpretationView } from './views/InterpretationView.js';
import { PixelsView } from './views/PixelsView.js';
import { PointsView } from './views/PointsView.js';

const React = window.React;
const ReactDOM = window.ReactDOM;
const h = React.createElement;
const { useEffect, useMemo, useRef, useState } = React;

function readDeclarativeSpec() {
  const definition = document.querySelector('mosaic-viewer');
  if (!definition) throw new Error('Add a <mosaic-viewer> definition to the HTML page.');
  const defaultDataSource = definition.getAttribute('data-source');
  const rows = Number(definition.getAttribute('rows')) || 1;
  const columns = Number(definition.getAttribute('columns')) || 1;
  const axes = (definition.getAttribute('axes') || 'left bottom').trim().split(/\s+/);
  const tiles = Array.from(definition.querySelectorAll(':scope > mosaic-tile')).map((element) => ({
    row: Number(element.getAttribute('row')),
    column: Number(element.getAttribute('column')),
    xLabel: element.getAttribute('x-label') || '',
    yLabel: element.getAttribute('y-label') || '',
    views: Array.from(element.children)
  }));
  return { rows, columns, axes, defaultDataSource, tiles, title: definition.getAttribute('data-title') || 'Scientific data' };
}

const DECLARATION = readDeclarativeSpec();

function numericRange(values) {
  const finite = values.flat(Infinity).filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}

const JSON_SOURCE_CACHE = new WeakMap();

function readJsonSource(selector) {
  if (!selector) return null;
  let source;
  try {
    source = selector.startsWith('#')
      ? document.getElementById(selector.slice(1))
      : document.querySelector(selector);
  } catch {
    throw new Error(`Invalid data reference "${selector}". Use a JSON tag id such as #field-data.`);
  }
  if (!source) throw new Error(`Data reference "${selector}" did not match an HTML JSON data tag.`);
  if (!JSON_SOURCE_CACHE.has(source)) {
    try {
      JSON_SOURCE_CACHE.set(source, JSON.parse(source.textContent));
    } catch (error) {
      throw new Error(`Could not parse JSON in "${selector}": ${error.message}`);
    }
  }
  return JSON_SOURCE_CACHE.get(source);
}

function dataForView(element, spec) {
  const binding = element.getAttribute('data');
  const key = element.getAttribute('data-key');
  const localSource = element.getAttribute('data-source') || spec.defaultDataSource;
  const directBinding = binding && (binding.startsWith('#') || binding.startsWith('[') || binding.startsWith('.'));

  if (directBinding) {
    const referencedData = readJsonSource(binding);
    if (key) {
      if (!Object.hasOwn(referencedData, key)) throw new Error(`Data tag "${binding}" has no key "${key}".`);
      return referencedData[key];
    }
    return referencedData;
  }

  if (localSource) {
    const sourceData = readJsonSource(localSource);
    const dataKey = key || binding;
    if (dataKey) {
      if (!Object.hasOwn(sourceData, dataKey)) throw new Error(`Data source "${localSource}" has no key "${dataKey}".`);
      return sourceData[dataKey];
    }
    return sourceData;
  }

  throw new Error(`<${element.localName}> needs data="#json-tag-id" or data-source="#json-tag-id" with an optional data-key.`);
}

function makeView(element, spec, colorMap) {
  const attribute = (name) => element.getAttribute(name);
  switch (element.localName) {
    case 'grid-view':
      return new GridView({
        color: attribute('color'),
        width: Number(attribute('width')) || undefined,
        horizontal: attribute('horizontal') !== 'false',
        vertical: attribute('vertical') !== 'false'
      });
    case 'pixels-view': {
      const data = dataForView(element, spec);
      return new PixelsView(data.values, { x: data.x, y: data.y, colorMap, interpolation: attribute('interpolation') || 'nearest' });
    }
    case 'contours-view': {
      const data = dataForView(element, spec);
      return new ContoursView(data.values, {
        x: data.x,
        y: data.y,
        colorMap,
        levelCount: Number(attribute('levels')) || 10,
        lineWidth: Number(attribute('line-width')) || undefined,
        interpolation: attribute('interpolation') || 'linear'
      });
    }
    case 'bars-view': {
      const data = dataForView(element, spec);
      return new BarsView(data.y, {
        x: data.x,
        color: attribute('color'),
        barWidth: Number(attribute('width')) || undefined,
        zero: Number(attribute('zero')) || 0
      });
    }
    case 'points-view': {
      const data = dataForView(element, spec);
      return new PointsView(data.x, data.y, {
        color: attribute('color'),
        lineWidth: Number(attribute('line-width')) || undefined,
        markerRadius: Number(attribute('marker-radius')) || 0,
        connect: attribute('connect') !== 'false'
      });
    }
    case 'interpretation-view':
      return new InterpretationView({
        id: element.id || attribute('id'),
        color: attribute('color'),
        opacity: attribute('opacity') ? Number(attribute('opacity')) : undefined,
        lineWidth: attribute('line-width') ? Number(attribute('line-width')) : undefined
      });
    default:
      throw new Error(`Unsupported Mosaic view tag: <${element.localName}>`);
  }
}

function createMosaic(rows, columns, spec = DECLARATION) {
  const mosaic = new Mosaic(rows, columns, spec.axes);
  const rasterDefinition = spec.tiles.flatMap((tile) => tile.views)
    .find((element) => element.localName === 'pixels-view' || element.localName === 'contours-view');
  const rasterData = rasterDefinition ? dataForView(rasterDefinition, spec) : null;
  const rasterValues = rasterData?.values || rasterData;
  const scalarRange = rasterValues ? numericRange(rasterValues) : [0, 1];
  mosaic.colorMap = new ColorMap('viridis', ...scalarRange);

  for (const tileDefinition of spec.tiles) {
    const tile = mosaic.getTile(tileDefinition.row, tileDefinition.column);
    if (!tile) continue;
    for (const element of tileDefinition.views) {
      const view = makeView(element, spec, mosaic.colorMap);
      tile.addTiledView(view);
      if (view instanceof InterpretationView) mosaic.interpretationViews.push(view);
    }
  }

  for (let column = 0; column < columns; column++) {
    const label = spec.tiles.find((tile) => tile.column === column && tile.xLabel)?.xLabel || '';
    mosaic.getTileAxisTop(column)?.setLabel(label);
    mosaic.getTileAxisBottom(column)?.setLabel(label);
  }
  for (let row = 0; row < rows; row++) {
    const label = spec.tiles.find((tile) => tile.row === row && tile.yLabel)?.yLabel || '';
    mosaic.getTileAxisLeft(row)?.setLabel(label);
    mosaic.getTileAxisRight(row)?.setLabel(label);
  }
  return mosaic;
}

function drawCanvas(canvas, draw) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw(context, width, height);
}

function AxisCanvas({ axis, version }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const paint = () => drawCanvas(canvas, (context, width, height) => axis.paint(context, width, height));
    const resetAxisView = (event) => {
      event.preventDefault();
      const tile = axis.getTile();
      const rectangle = tile.getViewRectangle();
      if (axis.isHorizontal()) tile.setViewRectangle({ ...rectangle, x: 0, width: 1 });
      else tile.setViewRectangle({ ...rectangle, y: 0, height: 1 });
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    canvas.addEventListener('contextmenu', resetAxisView);
    paint();
    return () => {
      observer.disconnect();
      canvas.removeEventListener('contextmenu', resetAxisView);
    };
  }, [axis, version]);
  return h('canvas', { className: `mosaic-axis mosaic-axis-${axis.placement}`, ref, 'aria-label': `${axis.placement} axis: ${axis.label}` });
}

function ColorBarCanvas({ colorMap, version }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const colorBar = new ColorBar(colorMap, { label: 'scalar value' });
    const paint = () => drawCanvas(canvas, (context, width, height) => colorBar.paint(context, width, height));
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [colorMap, version]);
  return h('canvas', { className: 'mosaic-colorbar', ref, 'aria-label': `Color scale from ${colorMap.min} to ${colorMap.max}` });
}

function TileCanvas({ tile, mosaic, version }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const paint = () => drawCanvas(canvas, (context, width, height) => {
      context.fillStyle = '#0a1119';
      context.fillRect(0, 0, width, height);
      tile.paint(context, width, height);
      context.strokeStyle = '#2c3c4d';
      context.lineWidth = 1;
      context.strokeRect(0.5, 0.5, width - 1, height - 1);
      if (selectionRef.current?.mode === 'zoom') {
        const selection = selectionRef.current;
        context.fillStyle = 'rgba(86, 214, 201, .12)';
        context.strokeStyle = 'rgba(86, 214, 201, .9)';
        context.setLineDash([5, 4]);
        context.fillRect(selection.x, selection.y, selection.width, selection.height);
        context.strokeRect(selection.x, selection.y, selection.width, selection.height);
        context.setLineDash([]);
      }
    });
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);

    paint();
    return () => observer.disconnect();
  }, [tile, version, selection]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const localPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
    };
    const onWheel = (event) => {
      event.preventDefault();
      const point = localPoint(event);
      if (event.ctrlKey || event.metaKey) {
        const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
        mosaic.zoomAt(tile, point.x / point.width, point.y / point.height, factor);
      } else if (event.shiftKey) {
        mosaic.pan(tile, event.deltaY / point.width * tile.viewRectangle.width * 0.8, 0);
      } else {
        mosaic.pan(tile, 0, event.deltaY / point.height * tile.viewRectangle.height * 0.8);
      }
    };
    const onContextMenu = (event) => {
      event.preventDefault();
      mosaic.setViewRectangle(tile, { x: 0, y: 0, width: 1, height: 1 });
    };
    const onPointerDown = (event) => {
      if (mosaic.interpretationMode) {
        if (event.button !== 0) return;
        const interpretation = tile.tiledViews.find((view) => view instanceof InterpretationView);
        if (!interpretation) return;
        mosaic.activeInterpretationView = interpretation;
        const point = localPoint(event);
        const transcaler = tile.getTranscaler(point.width, point.height);
        interpretation.addPoint(
          transcaler.pixelToWorldX(point.x, tile.horizontalProjector),
          transcaler.pixelToWorldY(point.y, tile.verticalProjector)
        );
        if (event.detail >= 2) interpretation.finishPick();
        event.preventDefault();
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;
      const point = localPoint(event);
      const mode = event.button === 1 || event.shiftKey ? 'pan' : 'zoom';
      dragRef.current = { ...point, mode, lastX: point.x, lastY: point.y };
      canvas.setPointerCapture(event.pointerId);
      if (mode === 'zoom') setSelection({ mode, x: point.x, y: point.y, width: 0, height: 0 });
      event.preventDefault();
    };
    const onPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = localPoint(event);
      if (drag.mode === 'pan') {
        mosaic.pan(tile,
          -(point.x - drag.lastX) / point.width * tile.viewRectangle.width,
          -(point.y - drag.lastY) / point.height * tile.viewRectangle.height
        );
        drag.lastX = point.x;
        drag.lastY = point.y;
      } else {
        setSelection({
          mode: 'zoom',
          x: Math.min(drag.x, point.x),
          y: Math.min(drag.y, point.y),
          width: Math.abs(point.x - drag.x),
          height: Math.abs(point.y - drag.y)
        });
      }
    };
    const onPointerUp = (event) => {
      if (mosaic.interpretationMode) return;
      const drag = dragRef.current;
      dragRef.current = null;
      setSelection(null);
      if (!drag || drag.mode !== 'zoom') return;
      const point = localPoint(event);
      if (Math.abs(point.x - drag.x) < 8 || Math.abs(point.y - drag.y) < 8) return;
      const view = tile.viewRectangle;
      const x0 = Math.min(drag.x, point.x) / point.width;
      const x1 = Math.max(drag.x, point.x) / point.width;
      const y0 = Math.min(drag.y, point.y) / point.height;
      const y1 = Math.max(drag.y, point.y) / point.height;
      mosaic.setViewRectangle(tile, {
        x: view.x + x0 * view.width,
        y: view.y + y0 * view.height,
        width: (x1 - x0) * view.width,
        height: (y1 - y0) * view.height
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [tile, mosaic]);

  const viewLabel = tile.tiledViews.map((view) => view.constructor.name.replace('View', '')).join(' + ');
  const interpretationView = tile.tiledViews.find((view) => view instanceof InterpretationView);
  const isActivePickTarget = Boolean(mosaic.interpretationMode && mosaic.activeInterpretationView === interpretationView);
  const interpretationHint = interpretationView
    ? (isActivePickTarget ? 'PICK MODE · CLICK TO TRACE' : mosaic.interpretationMode ? 'PICK MODE · USE CONTROLS' : 'PICKABLE · PRESS TAB')
    : null;
  return h('div', { className: 'mosaic-tile-wrap' },
    h('canvas', { className: 'mosaic-tile', ref: canvasRef, tabIndex: 0, 'data-tile-row': tile.rowIndex, 'data-tile-column': tile.columnIndex, title: 'Drag to zoom · Shift-drag to pan · Right-click to reset this tile’s row/column view', 'aria-label': `Tile row ${tile.rowIndex + 1}, column ${tile.columnIndex + 1}; drag to zoom, shift-drag to pan, right-click to reset` }),
    h('span', { className: 'tile-index' }, `${tile.rowIndex + 1}.${tile.columnIndex + 1}`),
    interpretationHint && h('span', {
      className: `interpretation-tile-badge${isActivePickTarget ? ' active' : ''}`,
      title: isActivePickTarget ? 'Click in this panel to create picks for this overlay' : mosaic.interpretationMode ? 'Choose Pick here in this panel’s control group before digitizing' : 'This panel has an interpretation overlay; press Tab to start picking',
      'aria-label': interpretationHint
    }, interpretationHint),
    h('span', { className: 'tile-view-label' }, viewLabel)
  );
}

function MosaicCanvas({ mosaic, version }) {
  const rows = mosaic.countRows();
  const columns = mosaic.countColumns();
  const hasTop = Boolean(mosaic.topAxes);
  const hasBottom = Boolean(mosaic.bottomAxes);
  const hasLeft = Boolean(mosaic.leftAxes);
  const hasRight = Boolean(mosaic.rightAxes);
  const horizontalScroll = Array.from({ length: columns }, (_, column) => mosaic.getTile(0, column).viewRectangle.width < 0.999);
  const verticalScroll = Array.from({ length: rows }, (_, row) => mosaic.getTile(row, 0).viewRectangle.height < 0.999);
  const hasHorizontalScroll = horizontalScroll.some(Boolean);
  const hasVerticalScroll = verticalScroll.some(Boolean);
  const columnTracks = [hasLeft ? '70px' : '0px', ...Array(columns).fill('minmax(0, 1fr)'), hasRight ? '48px' : '0px', hasVerticalScroll ? '14px' : '0px'];
  const rowTracks = [hasTop ? '34px' : '0px', ...Array(rows).fill('minmax(180px, 1fr)'), hasBottom ? '56px' : '0px', hasHorizontalScroll ? '14px' : '0px'];
  const children = [];
  const cell = (row, column, child, key) => children.push(h('div', { className: 'mosaic-grid-cell', style: { gridRow: row, gridColumn: column }, key }, child));

  if (hasTop) mosaic.topAxes.forEach((axis, column) => cell(1, column + 2, h(AxisCanvas, { axis, version }), `top-${column}`));
  for (let row = 0; row < rows; row++) {
    if (hasLeft) cell(row + 2, 1, h(AxisCanvas, { axis: mosaic.leftAxes[row], version }), `left-${row}`);
    for (let column = 0; column < columns; column++) {
      const tile = mosaic.getTile(row, column);
      cell(row + 2, column + 2, h(TileCanvas, { tile, mosaic, version }), `tile-${row}-${column}`);
    }
    if (hasRight) cell(row + 2, columns + 2, h(AxisCanvas, { axis: mosaic.rightAxes[row], version }), `right-${row}`);
    if (verticalScroll[row]) {
      const tile = mosaic.getTile(row, 0);
      const view = tile.viewRectangle;
      cell(row + 2, columns + 3, h('input', {
        className: 'mosaic-scrollbar mosaic-scrollbar-vertical',
        type: 'range', min: 0, max: Math.max(0, 1 - view.height), step: 0.001, value: view.y,
        onChange: (event) => tile.setViewRectangle({ ...tile.viewRectangle, y: Number(event.target.value) }),
        'aria-label': `Scroll row ${row + 1}`
      }), `vscroll-${row}`);
    }
  }
  if (hasBottom) mosaic.bottomAxes.forEach((axis, column) => cell(rows + 2, column + 2, h(AxisCanvas, { axis, version }), `bottom-${column}`));
  if (hasHorizontalScroll) {
    for (let column = 0; column < columns; column++) {
      if (!horizontalScroll[column]) continue;
      const tile = mosaic.getTile(0, column);
      const view = tile.viewRectangle;
      cell(rows + 3, column + 2, h('input', {
        className: 'mosaic-scrollbar mosaic-scrollbar-horizontal',
        type: 'range', min: 0, max: Math.max(0, 1 - view.width), step: 0.001, value: view.x,
        onChange: (event) => tile.setViewRectangle({ ...tile.viewRectangle, x: Number(event.target.value) }),
        'aria-label': `Scroll column ${column + 1}`
      }), `hscroll-${column}`);
    }
  }

  return h('div', {
    className: 'mosaic-grid',
    style: { gridTemplateColumns: columnTracks.join(' '), gridTemplateRows: rowTracks.join(' ') },
    role: 'group',
    'aria-label': `${rows} by ${columns} scientific plot mosaic`
  }, children);
}

function ScientificMosaicApp() {
  const [dimensions, setDimensions] = useState([DECLARATION.rows, DECLARATION.columns]);
  const [version, setVersion] = useState(0);
  const [palette, setPalette] = useState('viridis');
  const [interpretationMode, setInterpretationMode] = useState(false);
  const [notice, setNotice] = useState('Drag to zoom · Shift-drag to pan · Ctrl/⌘ + wheel to zoom · Right-click a tile to reset its row/column.');
  const [dataLabel, setDataLabel] = useState(DECLARATION.title);
  const mosaic = useMemo(() => createMosaic(dimensions[0], dimensions[1], DECLARATION), [dimensions]);
  const fileRef = useRef(null);
  const picksFileRefs = useRef(new Map());
  const interpretationViews = mosaic.interpretationViews;
  const activeInterpretation = mosaic.activeInterpretationView || interpretationViews[0] || null;

  useEffect(() => {
    mosaic.interpretationMode = interpretationMode;
    mosaic.setChangeHandler(() => setVersion((current) => current + 1));
    return () => mosaic.setChangeHandler(null);
  }, [mosaic, interpretationMode]);

  useEffect(() => {
    mosaic.colorMap.setPalette(palette);
    mosaic.requestRender();
  }, [mosaic, palette]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Tab') {
        if (!interpretationViews.length) return;
        const tag = document.activeElement?.tagName;
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
        event.preventDefault();
        const enabled = !mosaic.interpretationMode;
        if (!enabled) activeInterpretation?.finishPick();
        else if (!mosaic.activeInterpretationView) mosaic.activeInterpretationView = interpretationViews[0];
        mosaic.interpretationMode = enabled;
        setInterpretationMode(enabled);
        mosaic.requestRender();
        setNotice(enabled
          ? `Interpretation mode: click the ${activeInterpretation?.id || 'active'} overlay tile to pick; double-click or Enter finishes.`
          : 'View mode: drag to zoom, Shift-drag to pan, Ctrl/⌘ + wheel to zoom, right-click to reset.');
      } else if (event.key === 'Escape' && mosaic.interpretationMode) {
        activeInterpretation?.cancelDraft();
        mosaic.interpretationMode = false;
        setInterpretationMode(false);
        mosaic.requestRender();
        setNotice('Interpretation pick cancelled; view mode restored.');
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && mosaic.interpretationMode) {
        event.preventDefault();
        activeInterpretation?.undo();
      } else if (event.key === 'Enter' && mosaic.interpretationMode) {
        activeInterpretation?.finishPick();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mosaic, activeInterpretation, interpretationViews]);

  const setInterpretationEnabled = (enabled, target = activeInterpretation) => {
    if (target) mosaic.activeInterpretationView = target;
    if (!enabled) target?.finishPick();
    mosaic.interpretationMode = enabled;
    setInterpretationMode(enabled);
    mosaic.requestRender();
    setNotice(enabled
      ? `Interpretation mode: click the ${target?.id || 'active'} overlay tile to pick; double-click or Enter finishes.`
      : 'View mode: drag to zoom, Shift-drag to pan, Ctrl/⌘ + wheel to zoom, right-click to reset.');
    if (enabled && target?.tile) {
      const { rowIndex, columnIndex } = target.tile;
      requestAnimationFrame(() => document.querySelector(`[data-tile-row="${rowIndex}"][data-tile-column="${columnIndex}"]`)?.focus());
    }
  };

  const savePicks = (view) => {
    if (!view) return;
    view.finishPick();
    const blob = new Blob([JSON.stringify(view.serialize(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${view.id}-picks.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Saved ${view.picks.length} pick(s) from ${view.id}.`);
  };

  const loadPicks = async (file, view) => {
    if (!file || !view) return;
    try {
      view.load(JSON.parse(await file.text()));
      setNotice(`Loaded ${view.picks.length} pick(s) into ${view.id} from ${file.name}.`);
    } catch (error) {
      setNotice(`Could not load picks: ${error.message}`);
    }
  };

  const importCsv = (file) => {
    if (!file) return;
    if (!window.Papa) {
      setNotice('CSV parser did not load. Check the connection and reload.');
      return;
    }
    window.Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const records = result.data || [];
        const columns = result.meta?.fields || [];
        const numeric = columns.filter((name) => records.some((record) => Number.isFinite(record[name])));
        if (numeric.length < 2) {
          setNotice('CSV import needs at least two numeric columns.');
          return;
        }
        const xKey = numeric[0];
        const yKey = numeric[1];
        const valid = records.filter((record) => Number.isFinite(record[xKey]) && Number.isFinite(record[yKey]));
        if (!valid.length) {
          setNotice('No usable numeric rows were found in this CSV.');
          return;
        }
        const tile = mosaic.getTile(0, 0);
        tile.getTiledViews().forEach((view) => tile.removeTiledView(view));
        tile.addTiledView(new GridView());
        tile.addTiledView(new PointsView(valid.map((record) => record[xKey]), valid.map((record) => record[yKey]), { color: '#56d6c9', markerRadius: 1.5 }));
        mosaic.bottomAxes?.[0]?.setLabel(`${xKey} · ${file.name}`);
        mosaic.leftAxes?.[0]?.setLabel(yKey);
        setDataLabel(file.name);
        setNotice(`Loaded ${valid.length.toLocaleString()} numeric samples into tile 1.1; projector limits realigned across its row and column.`);
      },
      error: (error) => setNotice(`CSV import failed: ${error.message}`)
    });
  };

  return h('div', { className: `app-shell${interpretationMode ? ' interpretation-mode' : ''}` },
    h('header', { className: 'topbar' },
      h('div', { className: 'brand' },
        h('div', { className: 'brand-mark', 'aria-hidden': true }, 'M'),
        h('div', null,
          h('div', { className: 'brand-title' }, 'Mosaic · Scientific Graphics'),
          h('div', { className: 'brand-subtitle' }, 'React translation of the JTK tiled-view model')
        )
      ),
      h('div', { className: 'toolbar' },
        h('button', { className: 'button', onClick: () => setDimensions([1, 1]), 'aria-pressed': dimensions[0] === 1 && dimensions[1] === 1 }, '1 × 1'),
        h('button', { className: 'button', onClick: () => setDimensions([1, 2]), 'aria-pressed': dimensions[0] === 1 && dimensions[1] === 2 }, '1 × 2'),
        h('button', { className: 'button', onClick: () => setDimensions([2, 2]), 'aria-pressed': dimensions[0] === 2 && dimensions[1] === 2 }, '2 × 2'),
        h('span', { className: 'toolbar-divider' }),
        h('label', { className: 'palette-picker' },
          h('span', null, 'Color map'),
          h('select', { className: 'select-control', value: palette, onChange: (event) => setPalette(event.target.value), 'aria-label': 'Color map' },
            ColorMap.names().map((name) => h('option', { key: name, value: name }, name))
          )
        ),
        h('button', { className: 'button', onClick: () => mosaic.resetView() }, 'Reset view'),
        h('input', { ref: fileRef, className: 'file-input', type: 'file', accept: '.csv,text/csv', onChange: (event) => { importCsv(event.target.files[0]); event.target.value = ''; } }),
        h('button', { className: 'button primary', onClick: () => fileRef.current?.click() }, 'Import CSV')
      )
    ),
      h('section', { className: `interpretation-toolbar${interpretationMode ? ' active' : ''}`, 'aria-label': 'Interpretation pick tools' },
        interpretationViews.length
          ? interpretationViews.map((view) => {
            const isActive = mosaic.interpretationMode && mosaic.activeInterpretationView === view;
            const pickCount = view.picks.filter((pick) => pick.points.length >= 2).length;
            const tileNumber = `${view.tile.rowIndex + 1}.${view.tile.columnIndex + 1}`;
            return h('div', { className: `interpretation-control-group${isActive ? ' active' : ''}`, key: view.id },
              h('div', { className: 'interpretation-control-heading' },
                h('strong', null, view.id),
                h('span', null, `Tile ${tileNumber}`),
                h('button', {
                  className: `button interpretation-toggle${isActive ? ' active' : ''}`,
                  onClick: () => setInterpretationEnabled(!isActive, view),
                  'aria-pressed': isActive,
                  title: `Activate picks for ${view.id}; Tab toggles pick mode`
                }, isActive ? 'Picking here' : 'Pick here')
              ),
              h('label', { className: 'pick-control pick-color' },
                h('span', null, 'Color'),
                h('input', { type: 'color', value: view.color, onChange: (event) => view.setColor(event.target.value), 'aria-label': `${view.id} pick color` })
              ),
              h('label', { className: 'pick-control pick-slider' },
                h('span', null, `Opacity ${Math.round(view.opacity * 100)}%`),
                h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: view.opacity, onChange: (event) => view.setOpacity(Number(event.target.value)), 'aria-label': `${view.id} pick opacity` })
              ),
              h('label', { className: 'pick-control pick-slider' },
                h('span', null, `Width ${Number(view.lineWidth).toFixed(1)} px`),
                h('input', { type: 'range', min: 0.5, max: 10, step: 0.5, value: view.lineWidth, onChange: (event) => view.setLineWidth(Number(event.target.value)), 'aria-label': `${view.id} pick line width` })
              ),
              h('span', { className: 'pick-count' }, `${pickCount} pick${pickCount === 1 ? '' : 's'}`),
              h('button', { className: 'button', onClick: () => view.undo(), disabled: !view.picks.length, title: `Undo a point or pick in ${view.id}` }, 'Undo'),
              h('button', { className: 'button', onClick: () => view.finishPick(), disabled: !view.draftPickId, title: `Finish current ${view.id} pick (Enter)` }, 'Finish'),
              h('button', { className: 'button', onClick: () => view.clear(), disabled: !view.picks.length, title: `Clear ${view.id} picks` }, 'Clear'),
              h('button', { className: 'button', onClick: () => savePicks(view), disabled: !view.picks.length, title: `Save ${view.id} picks as JSON` }, 'Save picks'),
              h('input', {
                ref: (element) => { if (element) picksFileRefs.current.set(view.id, element); else picksFileRefs.current.delete(view.id); },
                className: 'file-input',
                type: 'file',
                accept: '.json,application/json',
                onChange: (event) => { loadPicks(event.target.files[0], view); event.target.value = ''; }
              }),
              h('button', { className: 'button', onClick: () => picksFileRefs.current.get(view.id)?.click(), title: `Load picks into ${view.id}` }, 'Load picks')
            );
          })
          : h('span', { className: 'interpretation-hint' }, 'Add an <interpretation-view> tag to a mosaic tile to enable independent pick controls.'),
        interpretationViews.length > 0 && h('span', { className: 'interpretation-hint' }, 'Tab toggles pick mode · click an active overlay tile · double-click or Enter finishes · Ctrl/⌘Z undoes')
      ),
    h('div', { className: 'statusline' },
      h('span', { className: 'status-dot', 'aria-hidden': true }),
      h('span', null, h('strong', null, dataLabel)),
      h('span', null, '·'),
      h('span', null, `${mosaic.countRows()} rows × ${mosaic.countColumns()} columns`),
      h('span', { className: 'status-message', title: notice }, notice),
      h('span', { className: 'right' }, 'SHARED PROJECTORS / NORMALIZED VIEW RECTANGLES')
    ),
    h('main', { className: 'workspace' },
      h('div', { className: 'workspace-heading' },
        h('div', null,
          h('h1', null, 'A mosaic of aligned tiles'),
            h('p', null, 'Define <mosaic-tile> and view tags in the HTML; bind each view with data="key" to the JSON data block.')
        ),
        h(ColorBarCanvas, { colorMap: mosaic.colorMap, version })
      ),
      h(MosaicCanvas, { mosaic, version })
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(ScientificMosaicApp));
