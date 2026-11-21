/**
 * Mosaic-style axis scale primitives.
 * Design reference: Mines JTK Mosaic, Dave Hale, Colorado School of Mines.
 * https://github.com/dhale/jtk/tree/master/core/src/main/java/edu/mines/jtk/mosaic
 * The referenced Java implementation is Apache-2.0 licensed; this is a fresh JS adaptation.
 */
export const AxisScale = Object.freeze({ LINEAR: 'linear', LOG10: 'log10' });

export function scaleValue(value, scale) {
  if (scale === AxisScale.LOG10) {
    if (!(value > 0)) throw new RangeError('Log10 axes require positive coordinates.');
    return Math.log10(value);
  }
  return value;
}

export function unscaleValue(value, scale) {
  return scale === AxisScale.LOG10 ? 10 ** value : value;
}
