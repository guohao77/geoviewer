/**
 * GeoVista — Attribute Inspector Panel
 * Shows feature properties when a feature is clicked.
 */
;(function() {
  'use strict';
  const GV = window.GeoVista = window.GeoVista || {};

  let _currentLayer = null;
  let _currentFeature = null;

  const panel    = () => document.getElementById('inspector-panel');
  const badge    = () => document.getElementById('inspector-layer-badge');
  const tbody    = () => document.getElementById('attr-tbody');
  const closeBtn = () => document.getElementById('inspector-close');

  function init() {
    closeBtn().addEventListener('click', close);
  }

  function open(feature, layerName, geomType) {
    _currentFeature = feature;
    _currentLayer   = layerName;

    const badgeEl  = badge();
    const category = GV.Symbology.classify(geomType);
    const color    = GV.Symbology.typeColor(category);
    const safeLayerName = _escapeHtml(layerName);
    const safeGeomType = _escapeHtml(geomType);
    badgeEl.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:50%;flex-shrink:0;"></span>
      <span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeLayerName}</span>
      <span style="color:var(--text-muted);font-size:10px;">${safeGeomType}</span>
    `;

    renderTable(feature.properties || {});
    panel().classList.add('open');
  }

  function close() {
    panel().classList.remove('open');
    _currentFeature = null;
    _currentLayer   = null;
    document.dispatchEvent(new CustomEvent('gv:inspector-closed'));
  }

  function renderTable(props) {
    const tb = tbody();
    tb.innerHTML = '';
    const entries = Object.entries(props);
    if (entries.length === 0) {
      tb.innerHTML = `<tr><td colspan="2" style="color:var(--text-muted);text-align:center;padding:16px;">No attributes</td></tr>`;
      return;
    }
    for (const [key, val] of entries) {
      const tr = document.createElement('tr');
      const displayVal = val === null || val === undefined ? '—' : String(val);
      const safeKey = _escapeHtml(key);
      const safeValue = _escapeHtml(displayVal);
      tr.innerHTML = `<td title="${safeKey}">${safeKey}</td><td title="${safeValue}">${safeValue}</td>`;
      tb.appendChild(tr);
    }
  }

  function _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  GV.Inspector = { init, open, close };

})();
