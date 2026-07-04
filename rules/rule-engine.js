// ===== rules/rule-engine.js =====
// מנוי עצמאי לזרם: מקבל זיהויים, מחשב אנליטיקות והחלטות חוקים, ומשדר אותן הלאה.
// This is the spine we kept describing: rules live on the STREAM, not inside any one
// surface. It consumes EV.FRAME and emits EV.ANALYTICS + EV.FIRED (+ rising-edge LOG).
// The dashboard renders those. Tomorrow the ESP32 adapter subscribes to the SAME
// EV.FIRED / EV.FRAME — no rule logic duplicated anywhere.

import { EV } from '../engine/events.js';
import { computeAnalytics, evalRule } from './rules.js';

export class RuleEngine {
  constructor(bus, { rules = [], weightOf = () => 1 } = {}) {
    this.bus = bus;
    this.rules = rules;
    this.weightOf = weightOf;
    this._was = new WeakMap(); // rule -> last fired state, for rising-edge logging
    bus.on(EV.FRAME, ({ detections }) => this._process(detections));
  }

  setRules(rules) { this.rules = rules; }
  setWeightOf(fn) { this.weightOf = fn; }

  _process(dets) {
    // analytics (includes the confidence-weighted hazard index)
    this.bus.emit(EV.ANALYTICS, computeAnalytics(dets, { weightOf: this.weightOf }));

    // rules: evaluate, log only on rising edge (so the log doesn't flood every frame)
    const fired = [];
    for (const r of this.rules) {
      const now = evalRule(dets, r);
      const was = this._was.get(r) || false;
      if (now && !was) this.bus.emit(EV.LOG, { level: r.level, msg: r.msg || r.name, ts: Date.now() });
      this._was.set(r, now);
      if (now) fired.push(r);
    }
    this.bus.emit(EV.FIRED, { fired, detections: dets });
  }
}
