/**
 * GeoVista — Symbology Module
 * Default styles, color generation, and geometry-type classification
 */
;(function() {
  'use strict';
  const GV = window.GeoVista = window.GeoVista || {};

  // ----- Geometry type color palette -----
  const PALETTE = {
    Polygon:        { fillOpacity: 0.35, weight: 1.5 },
    MultiPolygon:   { fillOpacity: 0.35, weight: 1.5 },
    LineString:     { fillOpacity: 0,    weight: 2.5 },
    MultiLineString:{ fillOpacity: 0,    weight: 2.5 },
    Point:          { fillOpacity: 0.9,  weight: 1.5, radius: 6 },
    MultiPoint:     { fillOpacity: 0.9,  weight: 1.5, radius: 6 },
  };

  // A pool of distinct accent colors for sequential layer assignment
  const COLOR_POOL = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
    '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a3e635'
  ];
  let colorIndex = 0;

  function nextColor() {
    const c = COLOR_POOL[colorIndex % COLOR_POOL.length];
    colorIndex++;
    return c;
  }

  function shiftColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function classify(geometryType) {
    if (!geometryType) return 'Unknown';
    if (geometryType.includes('Polygon')) return 'Polygon';
    if (geometryType.includes('Line'))    return 'Line';
    if (geometryType.includes('Point'))   return 'Point';
    return 'Unknown';
  }

  function buildStyle(geometryType, primaryColor) {
    const cat = classify(geometryType);
    switch (cat) {
      case 'Polygon':
        return {
          fillColor:   primaryColor,
          color:       shiftColor(primaryColor, -40),
          fillOpacity: PALETTE.Polygon.fillOpacity,
          weight:      PALETTE.Polygon.weight,
          opacity:     1
        };
      case 'Line':
        return {
          color:       primaryColor,
          weight:      PALETTE.LineString.weight,
          opacity:     1,
          fillOpacity: 0,
        };
      case 'Point':
        return {
          fillColor:   primaryColor,
          color:       shiftColor(primaryColor, -40),
          fillOpacity: PALETTE.Point.fillOpacity,
          weight:      PALETTE.Point.weight,
          radius:      PALETTE.Point.radius,
          opacity:     1
        };
      default:
        return { color: '#8b949e', weight: 1 };
    }
  }

  function buildHighlightStyle(geometryType) {
    const cat = classify(geometryType);
    switch (cat) {
      case 'Polygon':
        return { fillColor: '#facc15', color: '#eab308', fillOpacity: 0.5, weight: 2.5 };
      case 'Line':
        return { color: '#facc15', weight: 4 };
      case 'Point':
        return { fillColor: '#facc15', color: '#d97706', weight: 2.5, radius: 9 };
      default:
        return { color: '#facc15' };
    }
  }

  function typeColor(category) {
    switch (category) {
      case 'Polygon': return 'var(--color-polygon)';
      case 'Line':    return 'var(--color-line)';
      case 'Point':   return 'var(--color-point)';
      default:        return 'var(--color-surface)';
    }
  }

  GV.Symbology = { nextColor, buildStyle, buildHighlightStyle, classify, typeColor, shiftColor };

})();
