/**
 * GeoVista — Shapefile Loader
 * Handles file input, ZIP extraction, shapefile.js parsing,
 * and proj4 reprojection to WGS84.
 */

var GeoVista = window.GeoVista || {};

GeoVista.ShapefileLoader = (() => {

  /* -------------------------------------------------------
   * PUBLIC: Wire up all file input methods
   * ------------------------------------------------------- */
  function init() {
    const fileInput = document.getElementById('file-input');
    const mapContainer = document.getElementById('map-container');
    const dropOverlay = document.getElementById('drop-overlay');
    const emptyDropZone = document.getElementById('empty-drop-zone');
    const btnOpen = document.getElementById('btn-open-file');
    const btnAddLayer = document.getElementById('btn-add-layer');

    // Button → file input
    btnOpen.addEventListener('click', () => fileInput.click());
    btnAddLayer.addEventListener('click', () => fileInput.click());
    emptyDropZone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFiles(Array.from(e.target.files));
      fileInput.value = ''; // reset for re-upload of same file
    });

    // Map drag & drop
    mapContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropOverlay.classList.add('active');
    });
    mapContainer.addEventListener('dragleave', (e) => {
      if (!mapContainer.contains(e.relatedTarget)) {
        dropOverlay.classList.remove('active');
      }
    });
    mapContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('active');
      handleFiles(Array.from(e.dataTransfer.files));
    });

    // Sidebar empty-state drop zone
    emptyDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      emptyDropZone.classList.add('drag-over');
    });
    emptyDropZone.addEventListener('dragleave', () => {
      emptyDropZone.classList.remove('drag-over');
    });
    emptyDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      emptyDropZone.classList.remove('drag-over');
      handleFiles(Array.from(e.dataTransfer.files));
    });
  }

  /* -------------------------------------------------------
   * Handle a list of dropped/selected File objects
   * ------------------------------------------------------- */
  async function handleFiles(files) {
    // Group files by base name (to match .shp + .dbf + .prj)
    const groups = {};
    for (const f of files) {
      const ext  = f.name.split('.').pop().toLowerCase();
      const base = f.name.replace(/\.[^.]+$/, '');
      if (!groups[base]) groups[base] = {};
      groups[base][ext] = f;
    }

    for (const [base, parts] of Object.entries(groups)) {
      if (parts['zip']) {
        await loadZip(parts['zip']);
      } else if (parts['shp']) {
        await loadShpSet(base, parts);
      }
    }
  }

  /* -------------------------------------------------------
   * Load a .zip archive containing shapefile components
   * ------------------------------------------------------- */
  async function loadZip(zipFile) {
    showLoader(`Reading ${zipFile.name}…`);
    try {
      const zip = await JSZip.loadAsync(zipFile);
      // Find all .shp entries (there may be multiple shapefiles in one zip)
      const shpEntries = Object.keys(zip.files).filter(n => n.toLowerCase().endsWith('.shp'));

      if (shpEntries.length === 0) {
        hideLoader();
        GeoVista.Toast.show('No .shp file found in archive', 'error');
        return;
      }

      for (const shpPath of shpEntries) {
        const base = shpPath.replace(/\.[^.]+$/, '');
        const dbfPath = Object.keys(zip.files).find(n => n.toLowerCase() === base.toLowerCase() + '.dbf');
        const prjPath = Object.keys(zip.files).find(n => n.toLowerCase() === base.toLowerCase() + '.prj');

        const shpBuf = await zip.files[shpPath].async('arraybuffer');
        const dbfBuf = dbfPath ? await zip.files[dbfPath].async('arraybuffer') : null;
        const prjStr = prjPath ? await zip.files[prjPath].async('string') : null;

        const displayName = shpPath.split('/').pop() || shpPath;
        await parseAndAdd(shpBuf, dbfBuf, prjStr, displayName);
      }
    } catch (err) {
      console.error('[GeoVista] ZIP error:', err);
      GeoVista.Toast.show(`Failed to read ZIP: ${err.message}`, 'error');
    }
    hideLoader();
  }

  /* -------------------------------------------------------
   * Load from a set of separately selected files
   * ------------------------------------------------------- */
  async function loadShpSet(base, parts) {
    showLoader(`Reading ${base}.shp…`);
    try {
      const shpBuf = await parts['shp'].arrayBuffer();
      const dbfBuf = parts['dbf'] ? await parts['dbf'].arrayBuffer() : null;
      const prjStr = parts['prj'] ? await parts['prj'].text()         : null;
      await parseAndAdd(shpBuf, dbfBuf, prjStr, base + '.shp');
    } catch (err) {
      console.error('[GeoVista] ShpSet error:', err);
      GeoVista.Toast.show(`Failed to read shapefile: ${err.message}`, 'error');
    }
    hideLoader();
  }

  /* -------------------------------------------------------
   * Core: parse shapefile buffers → GeoJSON → add layers
   * ------------------------------------------------------- */
  async function parseAndAdd(shpBuf, dbfBuf, prjStr, displayName) {
    showLoader(`Parsing ${displayName}…`);
    try {
      // --- Parse shapefile to GeoJSON features ---
      const features = [];
      const source = await shapefile.open(shpBuf, dbfBuf, { encoding: 'UTF-8' });

      let result = await source.read();
      while (!result.done) {
        if (result.value && result.value.geometry) {
          features.push(result.value);
        }
        result = await source.read();
      }

      if (features.length === 0) {
        GeoVista.Toast.show(`${displayName}: no features found`, 'warning');
        return;
      }

      // --- Detect & reproject from .prj CRS to WGS84 ---
      const needsReproject = prjStr && !_isWgs84(prjStr);
      let proj = null;
      if (needsReproject) {
        try {
          proj = proj4(prjStr, 'WGS84');
          showLoader(`Reprojecting ${displayName}…`);
        } catch (e) {
          console.warn('[GeoVista] proj4 failed, assuming WGS84:', e);
        }
      }

      if (proj) {
        for (const feature of features) {
          _reprojectFeature(feature, proj);
        }
        GeoVista.Toast.show(`Reprojected ${displayName} → WGS84`, 'success');
      }

      // --- Group features by geometry category ---
      const byType = { Polygon: [], Line: [], Point: [] };
      for (const f of features) {
        const cat = GeoVista.Symbology.classify(f.geometry?.type);
        if (cat in byType) byType[cat].push(f);
        else byType['Polygon'].push(f); // fallback
      }

      const color = GeoVista.Symbology.nextColor();
      GeoVista.LayerManager.addGroup(displayName, byType, color);

      const total = features.length;
      GeoVista.Toast.show(`Loaded ${displayName} — ${total} features`, 'success');

    } catch (err) {
      console.error('[GeoVista] Parse error:', err);
      GeoVista.Toast.show(`Parse error: ${err.message}`, 'error');
    }
  }

  /* -------------------------------------------------------
   * Check if a PRJ string represents WGS84
   * ------------------------------------------------------- */
  function _isWgs84(prj) {
    if (!prj) return true;
    const p = prj.toUpperCase();
    return (
      (p.includes('GEOGCS') && p.includes('WGS84')) ||
      p.includes('WGS_1984') ||
      p.includes('EPSG:4326')
    );
  }

  /* -------------------------------------------------------
   * Reproject feature coordinates in-place
   * ------------------------------------------------------- */
  function _reprojectFeature(feature, proj) {
    if (!feature.geometry?.coordinates) return;
    feature.geometry.coordinates = _reprojectCoords(feature.geometry.coordinates, feature.geometry.type, proj);
  }

  function _reprojectCoords(coords, type, proj) {
    if (typeof coords[0] === 'number') {
      // Single coordinate pair [x, y]
      const [lng, lat] = proj.forward(coords);
      return [lng, lat];
    }
    return coords.map(c => _reprojectCoords(c, type, proj));
  }

  /* -------------------------------------------------------
   * Loader overlay helpers
   * ------------------------------------------------------- */
  function showLoader(msg) {
    document.getElementById('loader-text').textContent = msg || 'Loading…';
    document.getElementById('loader-overlay').style.display = 'flex';
  }

  function hideLoader() {
    document.getElementById('loader-overlay').style.display = 'none';
  }

  return { init, handleFiles };

})();

window.GeoVista = GeoVista;
