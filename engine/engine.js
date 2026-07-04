// ===== engine/engine.js =====
// המנוע: מקבל פריים, מחזיר זיהויים. אגנוסטי למקור ולמנוי.
// The detection engine. It knows nothing about cameras, dashboards, or hardware —
// it takes a frame (a <video>/<canvas>/<img>) and returns detections in ONE
// canonical shape. Every downstream module depends on this shape and nothing else:
//
//   detection = { cls, label, score, x, y, w, h }
//   x,y,w,h are NORMALIZED (0..1), origin top-left. score is 0..1.
//
// Stage 1 ships CocoEngine (generic, loads instantly, proves the pipeline).
// A YoloEngine (custom model.json from the training flow) drops in later behind
// the same detect() contract — nothing else changes.

import { EV } from './events.js';

// ---- base contract ----
export class DetectionEngine {
  async load() { throw new Error('not implemented'); }
  /** @returns {Promise<Array<{cls,label,score,x,y,w,h}>>} */
  async detect(_frame) { throw new Error('not implemented'); }
  get labels() { return []; }          // index -> name map (sent to hardware on connect)
}

// ---- COCO-SSD: generic 80-class detector via TF.js (CDN globals: tf, cocoSsd) ----
export class CocoEngine extends DetectionEngine {
  constructor(bus, { minScore = 0.35 } = {}) {
    super();
    this.bus = bus;
    this.minScore = minScore;
    this._model = null;
    this._labels = []; // filled lazily from results (COCO's own class list)
  }

  async load() {
    if (typeof cocoSsd === 'undefined' || typeof tf === 'undefined') {
      throw new Error('TF.js / coco-ssd not loaded — check the CDN <script> tags');
    }
    this.bus?.emit(EV.LOG, { level: 'low', msg: 'טוען מודל זיהוי (COCO)…', ts: Date.now() });
    this._model = await cocoSsd.load({ base: 'lite_mobilenet_v2' }); // small & fast
    this.bus?.emit(EV.MODEL_READY, { name: 'coco-ssd' });
    this.bus?.emit(EV.LOG, { level: 'low', msg: 'המודל מוכן ✓', ts: Date.now() });
    return this;
  }

  get labels() { return this._labels; }

  async detect(frame) {
    if (!this._model) return [];
    const W = frame.videoWidth || frame.naturalWidth || frame.width;
    const H = frame.videoHeight || frame.naturalHeight || frame.height;
    if (!W || !H) return [];

    const raw = await this._model.detect(frame, 20, this.minScore);
    return raw.map(r => {
      const [bx, by, bw, bh] = r.bbox; // pixels
      const label = r.class;
      let cls = this._labels.indexOf(label);
      if (cls === -1) { cls = this._labels.length; this._labels.push(label); }
      return {
        cls, label,
        score: r.score,
        x: bx / W, y: by / H, w: bw / W, h: bh / H, // normalize
      };
    });
  }
}
