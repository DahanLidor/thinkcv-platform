// ===== studio/store.js =====
// מצב הסטודיו: פריימים, קטגוריות, תיוגים — עם שמירה אוטומטית ל-IndexedDB.
// The single source of truth for a studio session. Everything (frames, categories,
// boxes) auto-persists to IndexedDB, so a refresh / closed tab / navigating away
// never loses a child's labeling work. Ported principle from the old per-student state.

const DB = 'thinkcv-studio', STORE = 'session', KEY = 'current';
const PALETTE = ['#22D3EE','#F472B6','#A78BFA','#34D399','#FBBF24','#F87171','#5aa9e6','#e6c45a','#7dd3fc','#fca5a5'];

export class StudioStore {
  constructor() {
    this.frames = [];       // [{ id, url, score, boxes:[{x,y,w,h,cls}], done }]
    this.categories = [];   // [{ name, color }]
    this._db = null;
    this._saveTimer = null;
    this._subs = new Set();
  }

  onChange(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const fn of this._subs) fn(); this._scheduleSave(); }

  // ---- categories ----
  addCategory(name) {
    name = (name || '').trim();
    if (!name || this.categories.some(c => c.name === name)) return;
    this.categories.push({ name, color: PALETTE[this.categories.length % PALETTE.length] });
    this._emit();
  }
  removeCategory(idx) {
    this.categories.splice(idx, 1);
    // drop boxes of a deleted class; reindex the rest
    for (const f of this.frames) {
      f.boxes = f.boxes.filter(b => b.cls !== idx).map(b => ({ ...b, cls: b.cls > idx ? b.cls - 1 : b.cls }));
    }
    this._emit();
  }
  colorOf(cls) { return this.categories[cls]?.color || '#8CA1BC'; }
  nameOf(cls) { return this.categories[cls]?.name || ('class ' + cls); }

  // ---- frames ----
  addFrames(list) {
    for (const f of list) this.frames.push({ id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: f.url, score: f.score ?? 1, boxes: [], done: false });
    this._emit();
  }
  removeFrame(id) { this.frames = this.frames.filter(f => f.id !== id); this._emit(); }
  markBackground(id) { const f = this.frames.find(x => x.id === id); if (f) { f.boxes = []; f.done = true; f.background = true; } this._emit(); }

  // ---- boxes ----
  addBox(frameId, box) {
    const f = this.frames.find(x => x.id === frameId); if (!f) return;
    f.boxes.push(box); f.done = true; f.background = false; this._emit();
  }
  updateBox(frameId, i, box) { const f = this.frames.find(x => x.id === frameId); if (f && f.boxes[i]) { f.boxes[i] = { ...f.boxes[i], ...box }; this._emit(); } }
  deleteBox(frameId, i) { const f = this.frames.find(x => x.id === frameId); if (f) { f.boxes.splice(i, 1); f.done = f.boxes.length > 0 || f.background; this._emit(); } }

  stats() {
    const labeled = this.frames.filter(f => f.done).length;
    const boxes = this.frames.reduce((s, f) => s + f.boxes.length, 0);
    return { frames: this.frames.length, labeled, boxes, categories: this.categories.length };
  }

  // ---- persistence (IndexedDB) ----
  async _open() {
    if (this._db) return this._db;
    this._db = await new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return this._db;
  }
  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 400); // debounce
  }
  async save() {
    try {
      const db = await this._open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ frames: this.frames, categories: this.categories }, KEY);
    } catch (e) { console.warn('save failed', e); }
  }
  async load() {
    try {
      const db = await this._open();
      const data = await new Promise((res, rej) => {
        const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      if (data) { this.frames = data.frames || []; this.categories = data.categories || []; }
    } catch (e) { console.warn('load failed', e); }
    return this;
  }
  async clear() { this.frames = []; this.categories = []; try { const db = await this._open(); db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY); } catch (e) {} this._emit(); }
}
