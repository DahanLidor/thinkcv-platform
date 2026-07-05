// ===== sync/cloud-store.js =====
// מצב הסטודיו המשותף: פריימים, תיוגים וקטגוריות חיים ב-Supabase (משותף לכולם).
// בחירת "כלול בייצוא" נשארת אישית (localStorage) — כל משתמש בוחר לעצמו מה לאמן.
// Same public API as the old StudioStore, so annotate.js / studio.html work unchanged.
// Local state updates are synchronous (snappy UI); cloud writes happen in background.

import { Cloud } from './supabase.js';

const PALETTE = ['#22D3EE','#F472B6','#A78BFA','#34D399','#FBBF24','#F87171','#5aa9e6','#e6c45a','#7dd3fc','#fca5a5'];
const EXCL_KEY = 'thinkcv_excluded';

export class CloudStore {
  constructor() {
    this.frames = [];
    this.categories = [];
    this.owner = 'אנונימי';
    this._subs = new Set();
    this._dirty = new Map();   // frameId -> patch, debounced to cloud
    this._timer = null;
    this._excluded = new Set(JSON.parse(localStorage.getItem(EXCL_KEY) || '[]'));
  }

  onChange(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const fn of this._subs) fn(); }

  colorOf(cls) { return this.categories[cls]?.color || '#8CA1BC'; }
  nameOf(cls) { return this.categories[cls]?.name || ('class ' + cls); }
  _incl(f) { return !this._excluded.has(f.id); }

  // ---- categories (shared) ----
  async addCategory(name) {
    name = (name || '').trim();
    if (!name || this.categories.some(c => c.name === name)) return;
    const color = PALETTE[this.categories.length % PALETTE.length];
    this.categories.push({ name, color });
    this._emit();
    try { await Cloud.putCategory(name, color); } catch (e) { console.warn(e); }
  }
  removeCategory() { /* shared — removal disabled to protect others' labels */ }

  // ---- frames ----
  async addFrames(list) {
    for (const f of list) {
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const frame = { id, url: f.url, owner: this.owner, boxes: [], done: false, background: false, included: true, _pending: true };
      this.frames.push(frame);
      this._emit();
      try {
        const publicUrl = await Cloud.uploadImage(id, f.url);
        frame.url = publicUrl; frame._pending = false;
        await Cloud.putFrame({ id, owner: this.owner, url: publicUrl, boxes: [], done: false, background: false });
      } catch (e) { console.warn('upload failed', e); frame._error = true; }
      this._emit();
    }
  }
  async removeFrame(id) {
    this.frames = this.frames.filter(f => f.id !== id); this._emit();
    try { await Cloud.deleteFrame(id); } catch (e) { console.warn(e); }
  }
  markBackground(id) { const f = this._get(id); if (f) { f.boxes = []; f.done = true; f.background = true; this._push(id, { boxes: [], done: true, background: true }); } this._emit(); }
  clearBoxes(id) { const f = this._get(id); if (f) { f.boxes = []; f.done = false; f.background = false; this._push(id, { boxes: [], done: false, background: false }); } this._emit(); }

  // per-user, local only (each user picks their own training set)
  toggleInclude(id) {
    if (this._excluded.has(id)) this._excluded.delete(id); else this._excluded.add(id);
    const f = this._get(id); if (f) f.included = this._incl(f);
    localStorage.setItem(EXCL_KEY, JSON.stringify([...this._excluded]));
    this._emit();
  }

  // ---- boxes ----
  addBox(frameId, box) { const f = this._get(frameId); if (!f) return; f.boxes.push(box); f.done = true; f.background = false; this._push(frameId, { boxes: f.boxes, done: true, background: false }); this._emit(); }
  updateBox(frameId, i, box) { const f = this._get(frameId); if (f && f.boxes[i]) { f.boxes[i] = { ...f.boxes[i], ...box }; this._push(frameId, { boxes: f.boxes }); this._emit(); } }
  deleteBox(frameId, i) { const f = this._get(frameId); if (f) { f.boxes.splice(i, 1); f.done = f.boxes.length > 0 || f.background; this._push(frameId, { boxes: f.boxes, done: f.done }); this._emit(); } }

  _get(id) { return this.frames.find(f => f.id === id); }
  stats() {
    const labeled = this.frames.filter(f => f.done).length;
    const boxes = this.frames.reduce((s, f) => s + f.boxes.length, 0);
    return { frames: this.frames.length, labeled, boxes, categories: this.categories.length };
  }

  // stats over an arbitrary subset (for live filter counts)
  statsOf(list) {
    const labeled = list.filter(f => f.done && !f.background).length;
    const bg = list.filter(f => f.background).length;
    const untagged = list.filter(f => !f.done).length;
    const boxes = list.reduce((s, f) => s + f.boxes.length, 0);
    const included = list.filter(f => f.done && f.included !== false).length;
    return { total: list.length, labeled, bg, untagged, boxes, included };
  }

  // per-owner folders: [{owner, count, labeled, thumb}]
  folders() {
    const map = new Map();
    for (const f of this.frames) {
      if (!map.has(f.owner)) map.set(f.owner, { owner: f.owner, count: 0, labeled: 0, thumb: f.url });
      const e = map.get(f.owner);
      e.count++; if (f.done) e.labeled++;
      if (!e.thumb) e.thumb = f.url;
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  // ---- cloud write (debounced) ----
  _push(id, patch) {
    this._dirty.set(id, { ...(this._dirty.get(id) || {}), ...patch });
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._flush(), 500);
  }
  async _flush() {
    const pending = [...this._dirty.entries()]; this._dirty.clear();
    for (const [id, patch] of pending) { try { await Cloud.patchFrame(id, patch); } catch (e) { console.warn('patch failed', id, e); } }
  }

  // ---- load everyone's shared data ----
  async load() {
    try {
      const [rows, cats] = await Promise.all([Cloud.listFrames(), Cloud.listCategories()]);
      this.categories = cats.map(c => ({ name: c.name, color: c.color }));
      this.frames = rows.map(r => ({
        id: r.id, url: r.url, owner: r.owner || 'אנונימי',
        boxes: r.boxes || [], done: !!r.done, background: !!r.background,
        included: !this._excluded.has(r.id),
      }));
    } catch (e) { console.warn('cloud load failed', e); }
    this._emit();
    return this;
  }

  // list of distinct owners (for "filter by who")
  owners() { return [...new Set(this.frames.map(f => f.owner))]; }
}
