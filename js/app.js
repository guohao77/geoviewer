/**
 * GeoVista — Main Application
 * Initializes the map, basemaps, toolbar, dropdowns, measure tool,
 * and coordinates all modules.
 */

/* ======================================================
   BASEMAP DEFINITIONS
   ====================================================== */
const BASEMAPS = {
  dark: {
    url:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CartoDB</a>',
    maxZ: 20
  },
  light: {
    url:  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CartoDB</a>',
    maxZ: 20
  },
  osm: {
    url:  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
    maxZ: 19
  },
  satellite: {
    url:  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZ: 20,
    subdomains: []
  },
  topo: {
    url:  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attr: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
    maxZ: 20,
    subdomains: []
  }
};

/* ======================================================
   GLOBAL NAMESPACE
   ====================================================== */
var GeoVista = window.GeoVista || {};

/* ======================================================
   TOAST NOTIFICATION MODULE
   ====================================================== */
GeoVista.Toast = {
  show(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = {
      success: '✓',
      error:   '✕',
      warning: '⚠',
      info:    'ℹ'
    }[type] || 'ℹ';

    const iconElement = document.createElement('span');
    iconElement.style.fontWeight = '700';
    iconElement.textContent = icon;
    toast.append(iconElement, document.createTextNode(` ${message}`));
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }
};

/* ======================================================
   APP INIT
   ====================================================== */
document.addEventListener('DOMContentLoaded', () => {

  // ---- Initialize Map ----
  const map = L.map('map', {
    center: [20, 0],
    zoom: 3,
    zoomControl: false,
    attributionControl: true,
  });

  // Attribution styling
  map.attributionControl.setPrefix(
    '<a href="https://leafletjs.com" target="_blank">Leaflet</a>'
  );

  // ---- Default Basemap ----
  let currentBaseTile = null;
  let currentBasemapKey = 'dark';
  function setBasemap(key) {
    if (currentBaseTile) map.removeLayer(currentBaseTile);
    const cfg = BASEMAPS[key];
    if (!cfg) return;
    const opts = { maxZoom: cfg.maxZ, attribution: cfg.attr };
    if (cfg.subdomains !== undefined) opts.subdomains = cfg.subdomains;
    currentBaseTile = L.tileLayer(cfg.url, opts).addTo(map);
    currentBasemapKey = key;
    document.querySelectorAll('#basemap-menu [data-basemap]').forEach((item) => {
      item.classList.toggle('active', item.dataset.basemap === key);
    });
  }
  setBasemap('dark');

  // ---- Scale Control ----
  L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(map);

  // ---- Init Modules ----
  GeoVista.Inspector.init();
  GeoVista.LayerManager.init(map);
  GeoVista.ShapefileLoader.init();

  // ---- Save and load GeoVista projects ----
  const projectFileInput = document.getElementById('project-file-input');
  document.getElementById('btn-save-project').addEventListener('click', () => {
    const center = map.getCenter();
    const project = {
      format: 'GeoVista',
      version: 1,
      savedAt: new Date().toISOString(),
      basemap: currentBasemapKey,
      mapView: { center: [center.lat, center.lng], zoom: map.getZoom() },
      layers: GeoVista.LayerManager.exportState()
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'geovista-project.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    GeoVista.Toast.show('Project saved', 'success');
  });

  document.getElementById('btn-load-project').addEventListener('click', () => projectFileInput.click());
  projectFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const project = JSON.parse(await file.text());
      if (project?.format !== 'GeoVista' || project.version !== 1 || !Array.isArray(project.layers)) {
        throw new Error('This is not a supported GeoVista project file.');
      }
      if (Object.keys(GeoVista.LayerManager.getGroups()).length &&
          !window.confirm('Loading this project will replace the layers currently open. Continue?')) {
        return;
      }

      GeoVista.LayerManager.restoreState(project.layers);
      if (BASEMAPS[project.basemap]) setBasemap(project.basemap);
      const view = project.mapView;
      if (Array.isArray(view?.center) && view.center.length === 2 &&
          view.center.every(Number.isFinite) && Math.abs(view.center[0]) <= 90 &&
          Math.abs(view.center[1]) <= 180 && Number.isFinite(view.zoom)) {
        map.setView(view.center, Math.min(22, Math.max(0, view.zoom)));
      }
      GeoVista.Toast.show(`Loaded project: ${file.name}`, 'success');
    } catch (error) {
      console.error('[GeoVista] Project load error:', error);
      GeoVista.Toast.show(`Could not load project: ${error.message}`, 'error');
    } finally {
      projectFileInput.value = '';
    }
  });

  // ---- Status Bar: Mouse Coordinates ----
  const statusCoords = document.getElementById('status-coords');
  const statusZoom   = document.getElementById('status-zoom');

  map.on('mousemove', (e) => {
    const { lat, lng } = e.latlng;
    statusCoords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  });
  map.on('zoom', () => {
    statusZoom.textContent = map.getZoom();
  });
  statusZoom.textContent = map.getZoom();

  // ---- Map Click: Clear highlight if clicking empty space ----
  map.on('click', () => {
    document.dispatchEvent(new CustomEvent('gv:clear-highlight'));
  });

  // ---- Basemap Switcher Dropdown ----
  const basemapBtn  = document.getElementById('btn-basemap');
  const basemapMenu = document.getElementById('basemap-menu');

  basemapBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    basemapMenu.classList.toggle('open');
    document.getElementById('tools-menu').classList.remove('open');
  });

  basemapMenu.querySelectorAll('.dropdown-item[data-basemap]').forEach(item => {
    item.addEventListener('click', () => {
      basemapMenu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      setBasemap(item.dataset.basemap);
      basemapMenu.classList.remove('open');
    });
  });

  // ---- Tools Dropdown ----
  const toolsBtn  = document.getElementById('btn-tools');
  const toolsMenu = document.getElementById('tools-menu');

  toolsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toolsMenu.classList.toggle('open');
    basemapMenu.classList.remove('open');
  });

  document.addEventListener('click', () => {
    basemapMenu.classList.remove('open');
    toolsMenu.classList.remove('open');
  });

  // ---- Map Toolbar: Zoom buttons ----
  document.getElementById('btn-zoom-in').addEventListener('click', () => map.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => map.zoomOut());
  document.getElementById('btn-zoom-extent').addEventListener('click', () => {
    map.setView([20, 0], 3);
  });
  document.getElementById('btn-zoom-all').addEventListener('click', () => {
    GeoVista.LayerManager.zoomToAll();
  });

  // ---- Clear All Layers ----
  document.getElementById('tool-clear-all').addEventListener('click', () => {
    GeoVista.LayerManager.clearAll();
    GeoVista.Inspector.close();
    toolsMenu.classList.remove('open');
    GeoVista.Toast.show('All layers cleared', 'info');
  });

  // ---- Measure Tool ----
  let measureMode = null;   // 'distance' | 'area' | null
  let measurePoints = [];
  let measurePolyline = null;
  let measurePolygon  = null;
  const measureResult = document.getElementById('measure-result');
  const measureValue  = document.getElementById('measure-value');

  function startMeasure(mode) {
    clearMeasure();
    measureMode = mode;
    map.getContainer().style.cursor = 'crosshair';
    document.getElementById('tool-measure-distance').classList.toggle('active', mode === 'distance');
    document.getElementById('tool-measure-area').classList.toggle('active', mode === 'area');
    GeoVista.Toast.show(`Click on the map to measure ${mode}. Double-click to finish.`, 'info', 4000);
    toolsMenu.classList.remove('open');
  }

  function clearMeasure() {
    if (measurePolyline) { map.removeLayer(measurePolyline); measurePolyline = null; }
    if (measurePolygon)  { map.removeLayer(measurePolygon); measurePolygon = null; }
    measurePoints = [];
    measureMode   = null;
    measureResult.style.display = 'none';
    map.getContainer().style.cursor = '';
  }

  map.on('click', (e) => {
    if (!measureMode) return;
    measurePoints.push(e.latlng);

    if (measureMode === 'distance') {
      if (measurePolyline) map.removeLayer(measurePolyline);
      measurePolyline = L.polyline(measurePoints, {
        color: '#facc15', weight: 2.5, dashArray: '6 4'
      }).addTo(map);
      const dist = _totalDistance(measurePoints);
      measureValue.textContent = _formatDistance(dist);
      measureResult.style.display = 'flex';
    } else if (measureMode === 'area' && measurePoints.length >= 3) {
      if (measurePolygon) map.removeLayer(measurePolygon);
      measurePolygon = L.polygon(measurePoints, {
        color: '#facc15', fillColor: '#facc15', fillOpacity: 0.15, weight: 2
      }).addTo(map);
      const area = _polygonArea(measurePoints);
      measureValue.textContent = _formatArea(area);
      measureResult.style.display = 'flex';
    }
  });

  map.on('dblclick', () => {
    if (measureMode) {
      map.getContainer().style.cursor = '';
      GeoVista.Toast.show('Measurement complete', 'success');
    }
  });

  document.getElementById('tool-measure-distance').addEventListener('click', () => startMeasure('distance'));
  document.getElementById('tool-measure-area').addEventListener('click', () => startMeasure('area'));
  document.getElementById('measure-close').addEventListener('click', clearMeasure);

  function _totalDistance(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += pts[i-1].distanceTo(pts[i]);
    return d; // meters
  }

  function _formatDistance(m) {
    if (m < 1000) return `${m.toFixed(1)} m`;
    return `${(m / 1000).toFixed(3)} km`;
  }

  // Shoelace formula on latlng (approximate)
  function _polygonArea(pts) {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].lng * pts[j].lat;
      area -= pts[j].lng * pts[i].lat;
    }
    // Convert from degree² to m² at approx center lat
    const centerLat = pts.reduce((s, p) => s + p.lat, 0) / n;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);
    return Math.abs(area / 2) * metersPerDegLat * metersPerDegLng;
  }

  function _formatArea(m2) {
    if (m2 < 10000) return `${m2.toFixed(1)} m²`;
    if (m2 < 1e6)   return `${(m2 / 10000).toFixed(2)} ha`;
    return `${(m2 / 1e6).toFixed(4)} km²`;
  }

  // ---- Welcome Toast ----
  setTimeout(() => {
    GeoVista.Toast.show('Welcome to GeoVista! Drop a shapefile to get started.', 'info', 4000);
  }, 800);

});

window.GeoVista = GeoVista;
