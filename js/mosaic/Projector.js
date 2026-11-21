/**
 * World ↔ normalized-coordinate projector, following the JTK Mosaic model.
 * Design reference: Dave Hale, Mines JTK Mosaic (Apache-2.0 Java package).
 */
import { AxisScale, scaleValue, unscaleValue } from './AxisScale.js';

export class Projector {
  constructor(v0, v1, u0 = 0, u1 = 1, scale = AxisScale.LINEAR) {
    if (![v0, v1, u0, u1].every(Number.isFinite) || v0 === v1) {
      throw new RangeError('Projector endpoints must be finite and distinct.');
    }
    if (!(0 <= u0 && u0 < u1 && u1 <= 1)) {
      throw new RangeError('Normalized projector bounds must satisfy 0 ≤ u0 < u1 ≤ 1.');
    }
    if (scale !== AxisScale.LINEAR && scale !== AxisScale.LOG10) {
      throw new TypeError(`Unsupported axis scale: ${scale}`);
    }
    if (scale === AxisScale.LOG10 && (!(v0 > 0) || !(v1 > 0))) {
      throw new RangeError('Log10 projector endpoints must be positive.');
    }
    this.v0 = v0;
    this.v1 = v1;
    this.u0 = u0;
    this.u1 = u1;
    this.scale = scale;
  }

  /** Map world coordinate to normalized coordinate. */
  u(world) {
    const a = scaleValue(this.v0, this.scale);
    const b = scaleValue(this.v1, this.scale);
    const value = scaleValue(world, this.scale);
    return this.u0 + (value - a) * (this.u1 - this.u0) / (b - a);
  }

  /** Map normalized coordinate to world coordinate. */
  v(normalized) {
    const a = scaleValue(this.v0, this.scale);
    const b = scaleValue(this.v1, this.scale);
    return unscaleValue(a + (normalized - this.u0) * (b - a) / (this.u1 - this.u0), this.scale);
  }

  copy() { return new Projector(this.v0, this.v1, this.u0, this.u1, this.scale); }

  /** Merge another view's bounds, preserving this projector's axis direction. */
  merge(other) {
    if (!other) return this;
    const scale = this.scale === other.scale ? this.scale : AxisScale.LINEAR;
    const endpoints = [this.v0, this.v1, other.v0, other.v1];
    const valid = scale === AxisScale.LOG10 ? endpoints.filter((value) => value > 0) : endpoints;
    if (!valid.length) return this;
    const low = Math.min(...valid);
    const high = Math.max(...valid);
    const descending = this.v1 < this.v0;
    this.v0 = descending ? high : low;
    this.v1 = descending ? low : high;
    this.u0 = Math.min(this.u0, other.u0);
    this.u1 = Math.max(this.u1, other.u1);
    this.scale = scale;
    return this;
  }

  static merge(projectors) {
    const usable = projectors.filter(Boolean);
    if (!usable.length) return null;
    const merged = usable[0].copy();
    for (const projector of usable.slice(1)) merged.merge(projector);
    return merged;
  }
}
