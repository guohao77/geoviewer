/**
 * GeoVista — Layer Manager
 * Manages layer state, layer tree DOM, visibility toggles,
 * opacity sliders, color pickers, and z-ordering.
 */

var GeoVista = window.GeoVista || {};

GeoVista.LayerManager = (() => {

  // Map of groupId → { name, leafletGroups: { type: { leafletLayer, visible, opacity, color, features[] } } }
  const _groups = {};
  let _groupCounter = 0;
  let _map = null;

  const layerList    = () => document.getElementById('layer-list');
  const emptyState   = () => document.getElementById('layer-empty-state');
  const statusLayers = () => document.getElementById('status-layers');

  function init(map) {
    _map = map;
  }

  /* -------------------------------------------------------
   * PUBLIC: Add a new layer group (one per loaded file)
   * -------------------------------------------------------
   * @param {string} name     - File/layer name
   * @param {Object} byType   - { Polygon: featureCollection, Line: ..., Point: ... }
   * @param {string} color    - Primary hex color
   * @returns {string}        - Group ID
   */
  function addGroup(name, byType, color) {
    const gid = `grp_${++_groupCounter}`;
    const leafletGroups = {};

    for (const [type, features] of Object.entries(byType)) {
      if (features.length === 0) continue;

      const style = GeoVista.Symbology.buildStyle(type === 'Point' ? 'Point' : type === 'Line' ? 'LineString' : 'Polygon', color);
      const pane  = _ensurePane(type);

      // Build the Leaflet layer
      const leafletLayer = L.geoJSON(
        { type: 'FeatureCollection', features },
        {
          pane,
          style: (feature) => {
            const gt = feature.geometry?.type || '';
            return GeoVista.Symbology.buildStyle(gt, color);
          },
          pointToLayer: (feature, latlng) => {
            const s = GeoVista.Symbology.buildStyle('Point', color);
            return L.circleMarker(latlng, { ...s, pane });
          },
          onEachFeature: (feature, layer) => {
            _attachInteraction(feature, layer, name, type, style, color, gid);
          }
        }
      ).addTo(_map);

      leafletGroups[type] = {
        leafletLayer,
        visible:  true,
        opacity:  1,
        color,
        features,
        pane
      };
    }

    _groups[gid] = { name, leafletGroups };
    _renderGroup(gid);
    _syncEmptyState();
    _syncStatusBar();
    _syncLayerOrder();
    return gid;
  }

  /* -------------------------------------------------------
   * Remove a whole group
   * ------------------------------------------------------- */
  function removeGroup(gid) {
    const group = _groups[gid];
    if (!group) return;
    for (const lt of Object.values(group.leafletGroups)) {
      _map.removeLayer(lt.leafletLayer);
    }
    delete _groups[gid];
    document.getElementById(`grp-${gid}`)?.remove();
    _syncEmptyState();
    _syncStatusBar();
  }

  /* -------------------------------------------------------
   * Remove all groups
   * ------------------------------------------------------- */
  function clearAll() {
    for (const gid of Object.keys(_groups)) removeGroup(gid);
  }

  /* -------------------------------------------------------
   * Zoom to fit all layers
   * ------------------------------------------------------- */
  function zoomToAll() {
    const bounds = [];
    for (const group of Object.values(_groups)) {
      for (const lt of Object.values(group.leafletGroups)) {
        try {
          const b = lt.leafletLayer.getBounds();
          if (b.isValid()) bounds.push(b);
        } catch (e) { /* empty layer */ }
      }
    }
    if (bounds.length === 0) return;
    const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0]);
    _map.fitBounds(combined, { padding: [30, 30] });
  }

  /* -------------------------------------------------------
   * Zoom to a single group
   * ------------------------------------------------------- */
  function zoomToGroup(gid) {
    const group = _groups[gid];
    if (!group) return;
    const bounds = [];
    for (const lt of Object.values(group.leafletGroups)) {
      try {
        const b = lt.leafletLayer.getBounds();
        if (b.isValid()) bounds.push(b);
      } catch (e) { /* empty */ }
    }
    if (bounds.length === 0) return;
    const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0]);
    _map.fitBounds(combined, { padding: [40, 40] });
  }

  /* -------------------------------------------------------
   * Get all groups (for status info)
   * ------------------------------------------------------- */
  function getGroups() { return _groups; }

  function exportState() {
    return Array.from(layerList().children).map((element) => {
      const gid = element.id.replace(/^grp-/, '');
      const group = _groups[gid];
      return {
        name: group.name,
        layers: Object.entries(group.leafletGroups).map(([type, layer]) => ({
          type,
          features: layer.features,
          color: layer.color,
          visible: layer.visible,
          opacity: layer.opacity
        }))
      };
    });
  }

  function restoreState(savedGroups) {
    if (!Array.isArray(savedGroups)) throw new Error('Project layers must be an array.');

    const allowedTypes = new Set(['Polygon', 'Line', 'Point']);
    const groups = savedGroups.map((group) => {
      if (!group || typeof group.name !== 'string' || !Array.isArray(group.layers)) {
        throw new Error('Project contains an invalid layer group.');
      }
      return {
        name: group.name,
        layers: group.layers.map((layer) => {
          if (!layer || !allowedTypes.has(layer.type) || !Array.isArray(layer.features)) {
            throw new Error(`Project contains an invalid ${layer?.type || 'unknown'} layer.`);
          }
          if (layer.features.some((feature) => feature?.type !== 'Feature' || !feature.geometry || typeof feature.geometry.type !== 'string' || !Array.isArray(feature.geometry.coordinates))) {
            throw new Error(`Layer "${group.name}" contains invalid GeoJSON features.`);
          }
          const color = /^#[0-9a-f]{6}$/i.test(layer.color) ? layer.color : '#3b82f6';
          const opacity = Number.isFinite(layer.opacity) ? Math.min(1, Math.max(0, layer.opacity)) : 1;
          return {
            type: layer.type,
            features: layer.features,
            color,
            visible: layer.visible !== false,
            opacity
          };
        })
      };
    });

    clearAll();
    for (const group of groups) {
      const byType = { Polygon: [], Line: [], Point: [] };
      for (const layer of group.layers) byType[layer.type].push(...layer.features);
      const firstLayer = group.layers.find((layer) => layer.features.length > 0);
      if (!firstLayer) continue;

      const gid = addGroup(group.name, byType, firstLayer.color);
      for (const layer of group.layers) {
        const layerState = _groups[gid].leafletGroups[layer.type];
        if (!layerState) continue;
        const item = document.getElementById(`item-${gid}-${layer.type}`);
        _changeColor(gid, layer.type, layer.color, item);
        item.querySelector('input[type="color"]').value = layer.color;
        if (!layer.visible) _toggleVisibility(gid, layer.type, item);
        const opacityRow = item.nextElementSibling;
        const opacitySlider = opacityRow?.querySelector('.layer-opacity-slider');
        if (opacitySlider) {
          opacitySlider.value = Math.round(layer.opacity * 100);
          opacityRow.querySelector('.layer-opacity-label').textContent = `${Math.round(layer.opacity * 100)}%`;
        }
        _changeOpacity(gid, layer.type, layer.opacity);
      }
    }
    _syncLayerOrder();
  }

  /* -------------------------------------------------------
   * PRIVATE HELPERS
   * ------------------------------------------------------- */

  function _ensurePane(type) {
    const panes = {
      'Polygon': { name: 'polygonPane', z: 350 },
      'Line':    { name: 'linePane',    z: 400 },
      'Point':   { name: 'pointPane',   z: 450 },
    };
    const cfg = panes[type] || { name: 'defaultPane', z: 300 };
    if (!_map.getPane(cfg.name)) {
      _map.createPane(cfg.name).style.zIndex = cfg.z;
    }
    return cfg.name;
  }

  function _attachInteraction(feature, layer, groupName, type, style, color, gid) {
    const geomType = feature.geometry?.type || type;
    let _highlighted = false;

    // Hover effects
    layer.on('mouseover', (e) => {
      if (!_highlighted) {
        const hs = GeoVista.Symbology.buildHighlightStyle(geomType);
        if (layer.setStyle)   layer.setStyle(hs);
        if (layer.setRadius)  layer.setRadius(hs.radius || 9);
        layer.getElement?.()?.classList.add('gv-hover');
      }
      layer.bringToFront?.();
    });

    layer.on('mouseout', (e) => {
      if (!_highlighted) {
        const s = GeoVista.Symbology.buildStyle(geomType, color);
        if (layer.setStyle)  layer.setStyle(s);
        if (layer.setRadius) layer.setRadius(s.radius || 6);
      }
    });

    // Click: open inspector
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      _highlighted = true;

      // Clear previous highlight
      document.dispatchEvent(new CustomEvent('gv:clear-highlight'));

      const hs = GeoVista.Symbology.buildHighlightStyle(geomType);
      if (layer.setStyle)  layer.setStyle(hs);
      if (layer.setRadius) layer.setRadius(hs.radius || 9);

      // Track this layer for de-highlight
      layer._gvHighlighted = true;
      layer._gvOrigColor   = color;
      layer._gvGeomType    = geomType;

      GeoVista.Inspector.open(feature, groupName, geomType);

      // Dispatch event so app can clear others
      document.dispatchEvent(new CustomEvent('gv:feature-selected', {
        detail: { layer }
      }));
    });

    // Listen for de-highlight
    document.addEventListener('gv:clear-highlight', () => {
      if (layer._gvHighlighted) {
        const s = GeoVista.Symbology.buildStyle(layer._gvGeomType, layer._gvOrigColor);
        if (layer.setStyle)  layer.setStyle(s);
        if (layer.setRadius) layer.setRadius(s.radius || 6);
        layer._gvHighlighted = false;
        _highlighted = false;
      }
    });

    document.addEventListener('gv:inspector-closed', () => {
      if (layer._gvHighlighted) {
        const s = GeoVista.Symbology.buildStyle(layer._gvGeomType, layer._gvOrigColor);
        if (layer.setStyle)  layer.setStyle(s);
        if (layer.setRadius) layer.setRadius(s.radius || 6);
        layer._gvHighlighted = false;
        _highlighted = false;
      }
    });
  }

  /* -------------------------------------------------------
   * Render a group row in the sidebar layer tree
   * ------------------------------------------------------- */
  function _renderGroup(gid) {
    const group = _groups[gid];
    const safeName = _escapeHtml(group.name);
    const totalFeatures = Object.values(group.leafletGroups)
      .reduce((sum, lt) => sum + lt.features.length, 0);

    const li = document.createElement('li');
    li.className = 'layer-group';
    li.id = `grp-${gid}`;
    li.draggable = true;

    li.innerHTML = `
      <div class="layer-group-header" data-gid="${gid}" title="Drag to reorder; click to collapse">
        <svg class="layer-group-toggle" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
        <svg class="layer-group-icon" viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
        </svg>
        <span class="layer-group-name" title="${safeName}">${_escapeHtml(_shortName(group.name))}</span>
        <span class="layer-group-count">${totalFeatures}</span>
        <div class="layer-group-actions">
          <button class="layer-action-btn zoom" title="Zoom to layer" data-action="zoom" data-gid="${gid}">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 8a1 1 0 011-1h1V6a1 1 0 012 0v1h1a1 1 0 110 2H9v1a1 1 0 11-2 0V9H6a1 1 0 01-1-1z"/><path fill-rule="evenodd" d="M2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8zm6-4a4 4 0 100 8 4 4 0 000-8z" clip-rule="evenodd"/></svg>
          </button>
          <button class="layer-action-btn danger" title="Remove layer" data-action="remove" data-gid="${gid}">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </div>
      </div>
      <ul class="layer-sub-list" id="sublist-${gid}"></ul>
    `;

    li.addEventListener('dragstart', (e) => {
      if (e.target.closest('button, input')) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', gid);
      li.classList.add('dragging');
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', (e) => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const dragged = document.getElementById(`grp-${e.dataTransfer.getData('text/plain')}`);
      if (!dragged || dragged === li) return;
      const insertAfter = e.clientY > li.getBoundingClientRect().top + li.getBoundingClientRect().height / 2;
      layerList().insertBefore(dragged, insertAfter ? li.nextSibling : li);
      _syncLayerOrder();
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      layerList().querySelectorAll('.drag-over').forEach((row) => row.classList.remove('drag-over'));
    });

    // Render sub-items for each type
    const subList = li.querySelector(`#sublist-${gid}`);
    for (const [type, lt] of Object.entries(group.leafletGroups)) {
      subList.appendChild(_renderSubItem(gid, type, lt));
    }

    // Wire collapse toggle
    li.querySelector('.layer-group-header').addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      li.classList.toggle('collapsed');
    });

    // Wire group action buttons
    li.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const gid2   = btn.dataset.gid;
        if (action === 'zoom')   zoomToGroup(gid2);
        if (action === 'remove') removeGroup(gid2);
      });
    });

    layerList().appendChild(li);
  }

  function _renderSubItem(gid, type, lt) {
    const li = document.createElement('li');
    li.className = 'layer-item';
    li.id = `item-${gid}-${type}`;

    const color = lt.color;
    const count = lt.features.length;
    const dotClass = `type-dot-${type.toLowerCase()}`;

    li.innerHTML = `
      <button class="layer-eye-toggle" title="Toggle visibility" data-gid="${gid}" data-type="${type}">
        <svg viewBox="0 0 20 20" fill="currentColor" class="eye-icon-visible">
          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
          <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
        </svg>
        <svg viewBox="0 0 20 20" fill="currentColor" class="eye-icon-hidden" style="display:none;">
          <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.449l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/>
          <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/>
        </svg>
      </button>
      <span class="layer-type-dot ${dotClass}" style="background:${color}"></span>
      <span class="layer-item-label">${type}s</span>
      <span class="feature-count">${count}</span>
      <div class="layer-color-swatch" style="background:${color};" title="Change color">
        <input type="color" value="${color}" data-gid="${gid}" data-type="${type}" />
      </div>
      <div class="layer-item-actions">
        <button class="layer-action-btn zoom" title="Zoom to" data-action="zoom-sub" data-gid="${gid}" data-type="${type}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    `;

    // Append opacity row
    const opRow = document.createElement('div');
    opRow.className = 'layer-opacity-row';
    opRow.innerHTML = `
      <span class="layer-opacity-label">100%</span>
      <input type="range" class="layer-opacity-slider" min="0" max="100" value="100"
             data-gid="${gid}" data-type="${type}" />
    `;

    // Insert after the li (as sibling)
    const fragment = document.createDocumentFragment();
    fragment.appendChild(li);
    fragment.appendChild(opRow);

    // Wire eye toggle
    li.querySelector('.layer-eye-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleVisibility(gid, type, li);
    });

    // Wire color picker
    li.querySelector('input[type="color"]').addEventListener('input', (e) => {
      _changeColor(gid, type, e.target.value, li);
    });

    // Wire opacity slider
    opRow.querySelector('.layer-opacity-slider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      opRow.querySelector('.layer-opacity-label').textContent = `${val}%`;
      _changeOpacity(gid, type, val / 100);
    });

    // Wire zoom sub-layer
    li.querySelector('[data-action="zoom-sub"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const lGroup = _groups[gid]?.leafletGroups[type];
      if (lGroup) {
        try {
          const b = lGroup.leafletLayer.getBounds();
          if (b.isValid()) _map.fitBounds(b, { padding: [30, 30] });
        } catch (err) {}
      }
    });

    return fragment;
  }

  function _toggleVisibility(gid, type, liEl) {
    const lt = _groups[gid]?.leafletGroups[type];
    if (!lt) return;
    lt.visible = !lt.visible;
    if (lt.visible) {
      _map.addLayer(lt.leafletLayer);
      liEl.classList.remove('hidden-layer');
      liEl.querySelector('.eye-icon-visible').style.display = '';
      liEl.querySelector('.eye-icon-hidden').style.display  = 'none';
      liEl.querySelector('.layer-eye-toggle').classList.remove('hidden');
    } else {
      _map.removeLayer(lt.leafletLayer);
      liEl.classList.add('hidden-layer');
      liEl.querySelector('.eye-icon-visible').style.display = 'none';
      liEl.querySelector('.eye-icon-hidden').style.display  = '';
      liEl.querySelector('.layer-eye-toggle').classList.add('hidden');
    }
  }

  function _changeColor(gid, type, newColor, liEl) {
    const lt = _groups[gid]?.leafletGroups[type];
    if (!lt) return;
    lt.color = newColor;
    // Update swatch background
    const swatch = liEl.querySelector('.layer-color-swatch');
    if (swatch) swatch.style.background = newColor;
    // Update type dot
    const dot = liEl.querySelector('.layer-type-dot');
    if (dot) dot.style.background = newColor;
    // Re-style all features
    lt.leafletLayer.setStyle((feature) => {
      const gt = feature.geometry?.type || (type === 'Point' ? 'Point' : type === 'Line' ? 'LineString' : 'Polygon');
      return GeoVista.Symbology.buildStyle(gt, newColor);
    });
    // Update stored orig colors
    lt.leafletLayer.eachLayer(layer => {
      layer._gvOrigColor = newColor;
    });
  }

  function _changeOpacity(gid, type, opacity) {
    const lt = _groups[gid]?.leafletGroups[type];
    if (!lt) return;
    lt.opacity = opacity;
    lt.leafletLayer.setStyle({ opacity, fillOpacity: type === 'Polygon' ? opacity * 0.4 : opacity });
  }

  function _syncEmptyState() {
    const hasLayers = Object.keys(_groups).length > 0;
    emptyState().style.display = hasLayers ? 'none' : 'flex';
  }

  function _syncStatusBar() {
    const count = Object.keys(_groups).length;
    statusLayers().textContent = `${count} layer${count !== 1 ? 's' : ''}`;
  }

  function _syncLayerOrder() {
    const groupsInTreeOrder = Array.from(layerList().children)
      .map((element) => _groups[element.id.replace(/^grp-/, '')])
      .filter(Boolean);

    // The top tree row is drawn last (above lower rows) within each geometry pane.
    for (const group of groupsInTreeOrder.slice().reverse()) {
      for (const layerGroup of Object.values(group.leafletGroups)) {
        layerGroup.leafletLayer.eachLayer((layer) => layer.bringToFront?.());
      }
    }
  }

  function _shortName(name) {
    // Remove extension, truncate
    return name.replace(/\.[^.]+$/, '').substring(0, 28);
  }

  function _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  return { init, addGroup, removeGroup, clearAll, zoomToAll, getGroups, exportState, restoreState };

})();

window.GeoVista = GeoVista;
