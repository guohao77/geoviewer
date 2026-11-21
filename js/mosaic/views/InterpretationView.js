/** Transparent pick/interpretation overlay that shares its tile's projectors. */
import { TiledView } from '../TiledView.js';

const DEFAULT_COLOR = '#ff5d73';

export class InterpretationView extends TiledView {
  constructor(options = {}) {
    super();
    this.id = options.id || 'interpretation';
    this.color = options.color || DEFAULT_COLOR;
    this.opacity = clamp(Number(options.opacity ?? 0.9), 0, 1);
    this.lineWidth = clamp(Number(options.lineWidth ?? 2.5), 0.5, 20);
    this.picks = [];
    this.draftPickId = null;
    this._pickSequence = 0;
  }

  setColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError('Pick color must be a six-digit hex color.');
    this.color = color;
    const draft = this._draft();
    if (draft) draft.color = color;
    this.tile?.mosaic.requestRender();
  }

  setOpacity(opacity) {
    this.opacity = clamp(Number(opacity), 0, 1);
    const draft = this._draft();
    if (draft) draft.opacity = this.opacity;
    this.tile?.mosaic.requestRender();
  }

  setLineWidth(width) {
    this.lineWidth = clamp(Number(width), 0.5, 20);
    const draft = this._draft();
    if (draft) draft.lineWidth = this.lineWidth;
    this.tile?.mosaic.requestRender();
  }

  _draft() { return this.picks.find((pick) => pick.id === this.draftPickId); }

  addPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    let pick = this.picks.find((candidate) => candidate.id === this.draftPickId);
    if (!pick) {
      pick = {
        id: `${this.id}-${Date.now()}-${++this._pickSequence}`,
        color: this.color,
        opacity: this.opacity,
        lineWidth: this.lineWidth,
        points: []
      };
      this.picks.push(pick);
      this.draftPickId = pick.id;
    }
    const previous = pick.points.at(-1);
    if (!previous || previous.x !== x || previous.y !== y) pick.points.push({ x, y });
    this.tile?.mosaic.requestRender();
    return true;
  }

  finishPick() {
    const pick = this.picks.find((candidate) => candidate.id === this.draftPickId);
    if (pick && pick.points.length < 2) this.picks = this.picks.filter((candidate) => candidate.id !== pick.id);
    this.draftPickId = null;
    this.tile?.mosaic.requestRender();
  }

  cancelDraft() {
    if (!this.draftPickId) return;
    const id = this.draftPickId;
    this.picks = this.picks.filter((pick) => pick.id !== id);
    this.draftPickId = null;
    this.tile?.mosaic.requestRender();
  }

  undo() {
    const draft = this.picks.find((pick) => pick.id === this.draftPickId);
    if (draft) {
      draft.points.pop();
      if (!draft.points.length) {
        this.picks = this.picks.filter((pick) => pick.id !== draft.id);
        this.draftPickId = null;
      }
    } else {
      this.picks.pop();
    }
    this.tile?.mosaic.requestRender();
  }

  clear() {
    this.picks = [];
    this.draftPickId = null;
    this.tile?.mosaic.requestRender();
  }

  serialize() {
    return {
      format: 'MosaicInterpretationPicks',
      version: 1,
      viewId: this.id,
      savedAt: new Date().toISOString(),
      picks: this.picks.filter((pick) => pick.points.length >= 2).map((pick) => ({
        id: pick.id,
        color: pick.color,
        opacity: pick.opacity,
        lineWidth: pick.lineWidth,
        points: pick.points.map(({ x, y }) => ({ x, y }))
      }))
    };
  }

  load(payload) {
    if (payload?.format !== 'MosaicInterpretationPicks' || payload.version !== 1 || !Array.isArray(payload.picks)) {
      throw new Error('Unsupported interpretation-picks file.');
    }
    const picks = payload.picks.map((pick, index) => {
      if (!pick || !Array.isArray(pick.points) || pick.points.length < 2 ||
          pick.points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
        throw new Error(`Pick ${index + 1} has invalid coordinates.`);
      }
      return {
        id: typeof pick.id === 'string' ? pick.id : `${this.id}-loaded-${index + 1}`,
        color: /^#[0-9a-f]{6}$/i.test(pick.color) ? pick.color : this.color,
        opacity: Number.isFinite(pick.opacity) ? clamp(pick.opacity, 0, 1) : this.opacity,
        lineWidth: Number.isFinite(pick.lineWidth) ? clamp(pick.lineWidth, 0.5, 20) : this.lineWidth,
        points: pick.points.map(({ x, y }) => ({ x, y }))
      };
    });
    this.picks = picks;
    this.draftPickId = null;
    this.tile?.mosaic.requestRender();
  }

  paint(context, { tile, transcaler }) {
    context.save();
    context.beginPath();
    context.rect(0, 0, transcaler.width, transcaler.height);
    context.clip();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const pick of this.picks) {
      if (!pick.points.length) continue;
      context.beginPath();
      context.strokeStyle = pick.color;
      context.globalAlpha = pick.opacity;
      context.lineWidth = pick.lineWidth;
      const first = pick.points[0];
      context.moveTo(transcaler.worldToPixelX(first.x, tile.horizontalProjector), transcaler.worldToPixelY(first.y, tile.verticalProjector));
      for (const point of pick.points.slice(1)) {
        context.lineTo(transcaler.worldToPixelX(point.x, tile.horizontalProjector), transcaler.worldToPixelY(point.y, tile.verticalProjector));
      }
      if (pick.points.length === 1) {
        const x = transcaler.worldToPixelX(first.x, tile.horizontalProjector);
        const y = transcaler.worldToPixelY(first.y, tile.verticalProjector);
        context.fillStyle = pick.color;
        context.arc(x, y, Math.max(2, pick.lineWidth), 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.stroke();
    }
    context.restore();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
