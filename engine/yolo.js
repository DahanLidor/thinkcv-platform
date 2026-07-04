// ===== engine/yolo.js =====
// טעינת המודל שאומן ב-Colab (yolo_tfjs_model.zip) והרצתו מקומית בדפדפן.
// Loads the exact artifact your existing platform produces: a TF.js YOLOv8 model
// zipped as model.json + weight shards. Same detect() contract as the other engines,
// so rules / analytics / dashboard / hardware never change.
//
// The decode (letterbox preprocess, channel-order auto-detect, NMS) is ported from
// the proven detectOnDataURL() in the old thinkcv-hakaton app — battle-tested logic.
//
// Class names: tries to read them from a data.yaml packed in the zip; if absent,
// falls back to names you pass in (comma list in the UI). Model outputs indices;
// names just label them.

import { DetectionEngine } from './engine.js';
import { EV } from './events.js';

const JSZIP_CDN = 'https://esm.sh/jszip@3.10.1';

export class YoloEngine extends DetectionEngine {
  constructor(bus, { zipFile, names = [], minScore = 0.25, iou = 0.45 } = {}) {
    super();
    this.bus = bus;
    this.zipFile = zipFile;      // a File/Blob (the yolo_tfjs_model.zip)
    this._names = names.slice();  // manual fallback names
    this.minScore = minScore;
    this.iou = iou;
    this._model = null;
    this._inputSize = 640;
  }

  get labels() { return this._names; }

  async load() {
    if (typeof tf === 'undefined') throw new Error('TF.js לא נטען — בדקו את תגית ה-CDN');
    if (!this.zipFile) throw new Error('לא נבחר קובץ מודל (yolo_tfjs_model.zip)');
    this.bus?.emit(EV.LOG, { level: 'low', msg: 'טוען מודל YOLO מ-ZIP…', ts: Date.now() });

    const { default: JSZip } = await import(/* @vite-ignore */ JSZIP_CDN);
    const zip = await JSZip.loadAsync(this.zipFile);
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);

    // build object-URLs for every file so tf can fetch weights by relative path
    const fileMap = {};
    for (const n of names) {
      const base = n.split('/').pop();
      fileMap[base] = URL.createObjectURL(await zip.files[n].async('blob'));
    }
    const modelJsonName = names.find(n => n.endsWith('model.json'));
    if (!modelJsonName) throw new Error('לא נמצא model.json ב-ZIP');
    const artifacts = JSON.parse(await zip.files[modelJsonName].async('text'));

    // try to auto-read class names from a packed data.yaml (fallback: manual)
    const yamlName = names.find(n => n.endsWith('data.yaml') || n.endsWith('data.yml'));
    if (yamlName && !this._names.length) {
      const y = await zip.files[yamlName].async('text');
      const m = y.match(/names:\s*\[([^\]]*)\]/);
      if (m) this._names = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }

    this._model = await tf.loadGraphModel(this._loader(artifacts, fileMap));
    const inShape = this._model.inputs[0].shape;
    this._inputSize = inShape[1] === 3 ? inShape[2] : inShape[1];

    this.bus?.emit(EV.MODEL_READY, { name: 'yolo-tfjs' });
    this.bus?.emit(EV.LOG, { level: 'low', msg: `מודל YOLO מוכן ✓${this._names.length ? ' · ' + this._names.join(', ') : ''}`, ts: Date.now() });
    return this;
  }

  async detect(frame) {
    if (!this._model) return [];
    const iw = frame.videoWidth || frame.naturalWidth || frame.width;
    const ih = frame.videoHeight || frame.naturalHeight || frame.height;
    if (!iw || !ih) return [];
    const S = this._inputSize;
    const scale = Math.min(S / iw, S / ih);
    const nw = Math.round(iw * scale), nh = Math.round(ih * scale);
    const padX = Math.floor((S - nw) / 2), padY = Math.floor((S - nh) / 2);

    const input = tf.tidy(() => {
      let t = tf.browser.fromPixels(frame).toFloat();
      t = tf.image.resizeBilinear(t, [nh, nw]);
      t = t.pad([[padY, S - nh - padY], [padX, S - nw - padX], [0, 0]], 114);
      return t.div(255).expandDims(0);
    });

    let out = this._model.execute(input);
    if (Array.isArray(out)) out = out[0];
    const sq = out.squeeze();
    const chFirst = sq.shape[0] < sq.shape[1];          // [84,8400] vs [8400,84]
    const data = tf.tidy(() => chFirst ? sq.transpose() : sq.clone());
    const arr = await data.array();
    input.dispose(); out.dispose(); sq.dispose(); data.dispose();

    const nc = Math.max(0, (arr[0] ? arr[0].length : 4) - 4); // classes from the model itself
    const conf = this.minScore;
    const mapB = (cx, cy, w, h, c, s) => ({
      x: ((cx - w / 2) - padX) / scale / iw,
      y: ((cy - h / 2) - padY) / scale / ih,
      w: (w / scale) / iw,
      h: (h / scale) / ih,
      cls: c, label: this._names[c] || ('class ' + c), score: s,
    });

    let boxes = [];
    for (const row of arr) {
      let best = 0, bestC = 0;
      for (let c = 0; c < nc; c++) if (row[4 + c] > best) { best = row[4 + c]; bestC = c; }
      if (best >= conf) boxes.push(mapB(row[0], row[1], row[2], row[3], bestC, best));
    }
    return this._nms(boxes, this.iou);
  }

  // ---- helpers (ported) ----
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
    while (boxes.length) {
      const b = boxes.shift(); keep.push(b);
      boxes = boxes.filter(o => this._iou(b, o) < thr);
    }
    return keep;
  }
  _loader(artifacts, fileMap) {
    return {
      load: async () => {
        const weightSpecs = [], weightUrls = [];
        for (const g of artifacts.weightsManifest) {
          for (const w of g.weights) weightSpecs.push(w);
          for (const p of g.paths) weightUrls.push(fileMap[p.split('/').pop()]);
        }
        const buffers = await Promise.all(weightUrls.map(u => fetch(u).then(r => r.arrayBuffer())));
        const total = buffers.reduce((s, b) => s + b.byteLength, 0);
        const weightData = new Uint8Array(total);
        let off = 0; buffers.forEach(b => { weightData.set(new Uint8Array(b), off); off += b.byteLength; });
        return {
          modelTopology: artifacts.modelTopology,
          weightSpecs, weightData: weightData.buffer,
          format: artifacts.format, generatedBy: artifacts.generatedBy, convertedBy: artifacts.convertedBy,
        };
      },
    };
  }
}
