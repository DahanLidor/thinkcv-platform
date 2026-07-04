// ===== engine/events.js =====
// לב המערכת: זרם אירועים אחד. כל מודול הוא מנוי — דשבורד, חוקים, ובעתיד גם הבקר.
// A tiny pub/sub bus. The whole architecture ("one engine, many subscribers")
// lives on this: detections flow in, subscribers (dashboard, rules, later the
// ESP32 adapter) react. Swapping a source or a sink never touches this file.

export class EventBus {
  constructor() { this._subs = new Map(); }

  on(type, fn) {
    if (!this._subs.has(type)) this._subs.set(type, new Set());
    this._subs.get(type).add(fn);
    return () => this.off(type, fn); // returns an unsubscribe handle
  }

  off(type, fn) {
    const set = this._subs.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this._subs.get(type);
    if (!set) return;
    // copy so a subscriber that unsubscribes mid-emit can't corrupt iteration
    for (const fn of [...set]) {
      try { fn(payload); }
      catch (e) { console.error(`[bus] subscriber for "${type}" threw:`, e); }
    }
  }
}

// Canonical event names — one place so modules never disagree on strings.
export const EV = {
  MODEL_READY: 'model-ready',   // engine finished loading a model
  FRAME:       'frame',         // {ts, detections:[...], source}
  ANALYTICS:   'analytics',     // computed summary for the current frame
  FIRED:       'fired',         // rules that fired this frame
  LOG:         'log',           // {level, msg, ts} — feeds the dashboard log
  SOURCE:      'source',        // source lifecycle: {state:'started'|'stopped'|'error'}
};
