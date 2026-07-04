// ===== engine/roboflow.js =====
// טעינת מודל מ-Roboflow והרצתו מקומית בדפדפן (on-device, מעל TF.js) על וידאו/מצלמה חיה.
// Same detect() contract as CocoEngine — so rules, analytics, dashboard, hardware
// are untouched. The only difference is WHERE the model comes from: instead of a
// local file, inferencejs downloads YOUR Roboflow model into the browser once, then
// runs every frame locally (no per-frame server calls).
//
// Roboflow does NOT hand you a raw weights file to download. It hands you three IDs:
//   publishableKey  — client-safe key, Project → Settings (starts "rf_...")
//   model           — the project URL slug (e.g. "urban-hazards")
//   version         — the trained version number (e.g. 3)
//
// inferencejs is authored for bundlers. In this buildless repo we import it from an
// ESM CDN. If the background worker fails to load that way (a known buildless risk),
// this single module is the one place that may need a Vite build — nothing else does.

import { DetectionEngine } from './engine.js';
import { EV } from './events.js';

const CDN = 'https://esm.sh/inferencejs@1.0.20';

export class RoboflowEngine extends DetectionEngine {
  constructor(bus, { publishableKey, model, version, minScore = 0.4 } = {}) {
    super();
    this.bus = bus;
    this.publishableKey = publishableKey;
    this.model = model;
    this.version = Number(version);
    this.minScore = minScore;
    this._engine = null;
    this._workerId = null;
    this._CVImage = null;
    this._labels = []; // index -> class name, discovered from results
  }

  async load() {
    if (!this.publishableKey || !this.model || !this.version) {
      throw new Error('חסר מזהה: publishable key, שם מודל, ומספר גרסה');
    }
    this.bus?.emit(EV.LOG, { level: 'low', msg: `טוען מודל Roboflow "${this.model}" v${this.version}…`, ts: Date.now() });

    let InferenceEngine, CVImage;
    try {
      ({ InferenceEngine, CVImage } = await import(/* @vite-ignore */ CDN));
    } catch (e) {
      throw new Error('טעינת inferencejs נכשלה (CDN/worker). ראו README — ייתכן שנדרש build למודול הזה בלבד.');
    }
    this._CVImage = CVImage;
    this._engine = new InferenceEngine();
    this._workerId = await this._engine.startWorker(
      this.model, this.version, this.publishableKey,
      [{ scoreThreshold: this.minScore }],
    );
    this.bus?.emit(EV.MODEL_READY, { name: `roboflow:${this.model}/${this.version}` });
    this.bus?.emit(EV.LOG, { level: 'low', msg: 'מודל Roboflow מוכן ✓', ts: Date.now() });
    return this;
  }

  get labels() { return this._labels; }

  async detect(frame) {
    if (!this._engine || this._workerId == null) return [];
    const W = frame.videoWidth || frame.naturalWidth || frame.width;
    const H = frame.videoHeight || frame.naturalHeight || frame.height;
    if (!W || !H) return [];

    const preds = await this._engine.infer(this._workerId, new this._CVImage(frame));
    // Roboflow bbox: x,y = CENTER in pixels; width,height in pixels. Convert to our
    // canonical top-left NORMALIZED shape.
    return (preds || []).map(p => {
      const b = p.bbox || {};
      const label = p.class ?? 'obj';
      let cls = this._labels.indexOf(label);
      if (cls === -1) { cls = this._labels.length; this._labels.push(label); }
      return {
        cls, label,
        score: p.confidence ?? 0,
        x: (b.x - b.width / 2) / W,
        y: (b.y - b.height / 2) / H,
        w: b.width / W,
        h: b.height / H,
      };
    });
  }
}
