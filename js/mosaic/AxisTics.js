/** JTK-style readable linear tic intervals (multiples of 2, 5, or 10). */
export class AxisTics {
  constructor(min, max, maxMajor = 7) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new RangeError('Axis bounds must be finite.');
    if (min > max) [min, max] = [max, min];
    if (min === max) {
      const padding = Math.max(1, Math.abs(min) * 0.05);
      min -= padding;
      max += padding;
    }
    this.min = min;
    this.max = max;
    this.interval = AxisTics.niceInterval((max - min) / Math.max(1, maxMajor - 1));
    this.first = Math.ceil(min / this.interval - 1e-12) * this.interval;
  }

  static niceInterval(raw) {
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const exponent = Math.floor(Math.log10(raw));
    const decade = 10 ** exponent;
    const fraction = raw / decade;
    const multiple = fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return multiple * decade;
  }

  majorValues() {
    const values = [];
    const count = Math.min(1000, Math.floor((this.max - this.first) / this.interval) + 1);
    for (let i = 0; i < count; i++) values.push(this.first + i * this.interval);
    return values;
  }

  minorValues(subdivisions = 5) {
    const step = this.interval / subdivisions;
    const first = Math.ceil(this.min / step - 1e-12) * step;
    const count = Math.min(5000, Math.floor((this.max - first) / step) + 1);
    return Array.from({ length: count }, (_, index) => first + index * step);
  }

  static format(value) {
    if (Math.abs(value) < 1e-12) return '0';
    return Number(value.toPrecision(5)).toString();
  }
}
