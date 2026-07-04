// ===== engine/onnx.js =====
// טעינת best.onnx ישירות בדפדפן (onnxruntime-web / WASM) והרצה על מצלמה חיה.
// The Colab notebook exports best.onnx reliably (the tfjs chain via onnx2tf is flaky).
// This runs that ONNX file directly — no conversion. Output tensor is the SAME
// [1, 6, 8400] YOLOv8 layout, so the decode (letterbox + NMS) is identical to YoloEngine.
// Same detect() contract → rules / analytics / dashboard / hardware unchanged.
//
// Class names aren't embedded in a bare .onnx, so pass them in the UI (comma list).

import { DetectionEngine } from './engine.js';
import { EV } from './events.js';

const ORT_CDN = 'https://esm.sh/onnxruntime-web@1.19.2';
const WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';

export class OnnxEngine extends DetectionEngine {
  constructor(bus, { onnxFile, names = [], minScore = 0.05, iou = 0.45, size = 640 } = {}) {
    super();
    this.bus = bus;
    this.onnxFile = onnxFile;
    this._names = names.slice();
    this.minScore = minScore;
    this.iou = iou;
    this._size = size;
    this._sess = null;
    this._cnv = null;
    this._ctx = null;
  }

  get labels() { return this._names; }

  async load() {
    if (!this.onnxFile) throw new Error('לא נבחר קובץ best.onnx');
    this.bus?.emit(EV.LOG, { level: 'low', msg: 'טוען מודל ONNX…', ts: Date.now() });
    let ort;
    try { ort = await import(/* @vite-ignore */ ORT_CDN); }
    catch (e) { throw new Error('טעינת onnxruntime-web נכשלה (CDN/WASM). ראו README.'); }
    ort.env.wasm.wasmPaths = WASM_PATHS;
    this._ort = ort;

    const buf = await this.onnxFile.arrayBuffer();
    this._sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    this._inName = this._sess.inputNames[0];
    this._outName = this._sess.outputNames[0];

    // offscreen canvas for letterbox preprocessing
    this._cnv = document.createElement('canvas'); this._cnv.width = this._size; this._cnv.height = this._size;
    this._ctx = this._cnv.getContext('2d', { willReadFrequently: true });

    this.bus?.emit(EV.MODEL_READY, { name: 'onnx' });
    this.bus?.emit(EV.LOG, { level: 'low', msg: `מודל ONNX מוכן ✓${this._names.length ? ' · ' + this._names.join(', ') : ''}`, ts: Date.now() });
    return this;
  }

  async detect(frame) {
    if (!this._sess) return [];
    const iw = frame.videoWidth || frame.naturalWidth || frame.width;
    const ih = frame.videoHeight || frame.naturalHeight || frame.height;
    if (!iw || !ih) return [];
    const S = this._size;
    const scale = Math.min(S / iw, S / ih);
    const nw = Math.round(iw * scale), nh = Math.round(ih * scale);
    const padX = Math.floor((S - nw) / 2), padY = Math.floor((S - nh) / 2);

    // ---- letterbox → NCHW float32 (RGB, /255) ----
    const ctx = this._ctx;
    ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(frame, padX, padY, nw, nh);
    const px = ctx.getImageData(0, 0, S, S).data;
    const f = new Float32Array(3 * S * S), area = S * S;
    for (let i = 0; i < area; i++) {
      f[i] = px[i * 4] / 255;              // R plane
      f[area + i] = px[i * 4 + 1] / 255;   // G plane
      f[2 * area + i] = px[i * 4 + 2] / 255; // B plane
    }
    const tensor = new this._ort.Tensor('float32', f, [1, 3, S, S]);

    const out = await this._sess.run({ [this._inName]: tensor });
    const o = out[this._outName];
    const data = o.data, dims = o.dims; // e.g. [1, 6, 8400]

    // ---- decode (handles channel-first [1,C,N] and [1,N,C]) ----
    const d1 = dims[1], d2 = dims[2];
    const chFirst = d1 < d2;
    const nAnchors = chFirst ? d2 : d1;
    const nAttrs = chFirst ? d1 : d2;
    const nc = nAttrs - 4;
    const at = (attr, a) => chFirst ? data[attr * nAnchors + a] : data[a * nAttrs + attr];

    const conf = this.minScore;
    const mapB = (cx, cy, w, h, c, s) => ({
      x: ((cx - w / 2) - padX) / scale / iw,
      y: ((cy - h / 2) - padY) / scale / ih,
      w: (w / scale) / iw, h: (h / scale) / ih,
      cls: c, label: this._names[c] || ('class ' + c), score: s,
    });

    let boxes = [];
    for (let a = 0; a < nAnchors; a++) {
      let best = 0, bestC = 0;
      for (let c = 0; c < nc; c++) { const s = at(4 + c, a); if (s > best) { best = s; bestC = c; } }
      if (best >= conf) boxes.push(mapB(at(0, a), at(1, a), at(2, a), at(3, a), bestC, best));
    }
    return this._nms(boxes, this.iou);
  }

  _iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  }
  _nms(boxes, thr) {
    boxes.sort((a, b) => b.score - a.score);
    const keep = [];
    while (boxes.length) { const b = boxes.shift(); keep.push(b); boxes = boxes.filter(o => this._iou(b, o) < thr); }
    return keep;
  }
}
