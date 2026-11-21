/** Canvas-rendered legend for a shared scientific ColorMap. */
import { AxisTics } from './AxisTics.js';

export class ColorBar {
  constructor(colorMap, options = {}) {
    this.colorMap = colorMap;
    this.label = options.label || 'value';
  }

  paint(context, width, height) {
    context.clearRect(0, 0, width, height);
    const left = 8;
    const right = width - 8;
    const top = 5;
    const barHeight = Math.max(12, Math.min(20, height * 0.34));
    const barWidth = Math.max(1, right - left);
    const gradient = context.createLinearGradient(left, 0, right, 0);
    for (let index = 0; index <= 32; index++) gradient.addColorStop(index / 32, this.colorMap.colorAt(index / 32));
    context.fillStyle = gradient;
    context.fillRect(left, top, barWidth, barHeight);
    context.strokeStyle = '#405267';
    context.strokeRect(left + 0.5, top + 0.5, barWidth - 1, barHeight - 1);

    const ticks = new AxisTics(this.colorMap.min, this.colorMap.max, 5).majorValues();
    context.font = '9px "DM Mono", monospace';
    context.fillStyle = '#91a1b3';
    context.strokeStyle = '#667a90';
    context.lineWidth = 1;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (const tick of ticks) {
      const x = left + this.colorMap.normalize(tick) * barWidth;
      context.beginPath();
      context.moveTo(x, top + barHeight);
      context.lineTo(x, top + barHeight + 4);
      context.stroke();
      context.fillText(AxisTics.format(tick), x, top + barHeight + 5);
    }
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillStyle = '#bdc9d6';
    context.fillText(this.label, right, height - 7);
  }
}
