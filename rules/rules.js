// ===== rules/rules.js =====
// מנוע החוקים והאנליטיקות. פונקציות טהורות מעל מבנה הזיהוי הקנוני.
// Pure logic over detections — no DOM, no bus. Two exports the whole platform reuses:
//   evalRules(dets, rules)  -> [{rule, fired}]
//   computeAnalytics(dets)  -> summary for the dashboard + hazard index
// Same functions will feed the ESP32 payload later (existence + confidence per class).

const OPS = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => Math.abs(a - b) < 1e-9,
};

// A condition tests one metric over the detections of one subject class (or any).
function evalCond(dets, c) {
  const sub = (c.subj === -1 || c.subj == null) ? dets : dets.filter(d => d.cls === c.subj);
  const op = OPS[c.op] || OPS['>='];
  switch (c.metric) {
    case 'count':      return op(sub.length, c.val);
    case 'confidence': return sub.some(d => op(d.score, c.val));
    case 'size':       return sub.some(d => op(d.w * d.h, c.val));
    case 'position': { // c.val in {top,bottom,left,right}
      return sub.some(d => {
        const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
        return c.val === 'top' ? cy < 0.5
             : c.val === 'bottom' ? cy >= 0.5
             : c.val === 'left' ? cx >= 0.5   // RTL: "right side" = larger x
             : cx < 0.5;
      });
    }
    default: return false;
  }
}

export function evalRule(dets, rule) {
  if (!rule.conds || !rule.conds.length) return false;
  return rule.match === 'any'
    ? rule.conds.some(c => evalCond(dets, c))
    : rule.conds.every(c => evalCond(dets, c));
}

export function evalRules(dets, rules) {
  return rules.map(rule => ({ rule, fired: evalRule(dets, rule) }));
}

// Weighted-by-confidence hazard index (0..100) — the "algorithm on top of detections".
// weightOf(cls) lets the caller pass class weights; defaults to 1 for every class.
export function hazardIndex(dets, weightOf = () => 1) {
  const raw = dets.reduce((s, d) => s + d.score * weightOf(d.cls), 0);
  return Math.min(100, Math.round(raw * 45));
}

export function computeAnalytics(dets, { weightOf } = {}) {
  const byClass = new Map();
  for (const d of dets) {
    const e = byClass.get(d.cls) || { cls: d.cls, label: d.label, count: 0, sumConf: 0, maxConf: 0 };
    e.count++; e.sumConf += d.score; e.maxConf = Math.max(e.maxConf, d.score);
    byClass.set(d.cls, e);
  }
  const perClass = [...byClass.values()]
    .map(e => ({ ...e, avgConf: e.count ? e.sumConf / e.count : 0 }))
    .sort((a, b) => b.count - a.count);
  const avgConf = dets.length ? dets.reduce((s, d) => s + d.score, 0) / dets.length : 0;
  return {
    total: dets.length,
    classes: perClass.length,
    avgConf,
    perClass,
    hazard: hazardIndex(dets, weightOf),
  };
}

// Existence + confidence vector per class — exactly the ESP32 payload we agreed on.
// Returns c[i] = highest confidence of class i this frame (0 if absent).
export function confidenceVector(dets, numClasses) {
  const v = new Array(numClasses).fill(0);
  for (const d of dets) if (d.cls < numClasses) v[d.cls] = Math.max(v[d.cls], d.score);
  return v;
}
