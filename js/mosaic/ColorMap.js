/** Sampleable scientific color maps and value-to-RGBA normalization. */
const PALETTES = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  inferno: [[0, 0, 4], [87, 15, 109], [188, 55, 84], [249, 142, 8], [252, 255, 164]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  coolwarm: [[59, 76, 192], [141, 176, 219], [221, 221, 221], [244, 152, 122], [180, 4, 38]],
  gray: [[12, 16, 22], [247, 249, 252]],
  turbo: [[48, 18, 59], [50, 103, 226], [35, 205, 190], [163, 252, 60], [249, 152, 41], [122, 4, 3]]
};

export class ColorMap {
  static names() { return Object.keys(PALETTES); }

  constructor(name = 'viridis', min = 0, max = 1) {
    this.setPalette(name);
    this.setRange(min, max);
  }

  setPalette(name) {
    if (!PALETTES[name]) throw new RangeError(`Unknown color map: ${name}`);
    this.name = name;
    this.stops = PALETTES[name];
    return this;
  }

  setRange(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new RangeError('Color-map range must be finite.');
    if (min > max) [min, max] = [max, min];
    if (min === max) {
      const padding = Math.max(1, Math.abs(min) * 0.01);
      min -= padding;
      max += padding;
    }
    this.min = min;
    this.max = max;
    return this;
  }

  normalize(value) {
    return Math.max(0, Math.min(1, (value - this.min) / (this.max - this.min)));
  }

  rgba(value, alpha = 255) {
    if (!Number.isFinite(value)) return [0, 0, 0, 0];
    const t = this.normalize(value) * (this.stops.length - 1);
    const index = Math.min(this.stops.length - 2, Math.floor(t));
    const fraction = t - index;
    const a = this.stops[index];
    const b = this.stops[index + 1];
    return [0, 1, 2].map((channel) => Math.round(a[channel] + (b[channel] - a[channel]) * fraction)).concat(alpha);
  }

  css(value, alpha = 1) {
    const [red, green, blue] = this.rgba(value);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  colorAt(t) {
    return this.css(this.min + Math.max(0, Math.min(1, t)) * (this.max - this.min));
  }

  createLUT(size = 256) {
    const lut = new Uint8ClampedArray(size * 4);
    for (let index = 0; index < size; index++) lut.set(this.rgba(this.min + index / (size - 1) * (this.max - this.min)), index * 4);
    return lut;
  }
}
