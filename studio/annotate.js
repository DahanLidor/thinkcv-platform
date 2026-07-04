// ===== studio/annotate.js =====
// כלי התיוג — קנבס בלבד + API ציבורי. סרגל הקטגוריות והניווט נבנים ע"י הדף (מסך מלא).
// Canvas-only annotator. The page owns the top bar (categories, nav) and filmstrip and
// drives this via public methods; `onChange` fires whenever state changes so the page
// refreshes. Boxes stored NORMALIZED (0..1) in the auto-persisting store.

const HANDLE = 9;

export class Annotator {
  constructor(store, mount, { onChange } = {}) {
    this.store = store;
    this.mount = typeof mount === 'string' ? document.querySelector(mount) : mount;
    this.onChange = onChange || (() => {});
    this.frameId = null; this.activeCls = 0; this.sel = -1;
    this._drag = null; this._preview = null;
    this._img = new Image();
    this._img.onload = () => this._redraw();
    this.mount.innerHTML = '<canvas data-canvas></canvas>';
    this.canvas = this.mount.querySelector('[data-canvas]');
    const c = this.canvas;
    c.onpointerdown = e => this._down(e);
    c.onpointermove = e => this._move(e);
    c.onpointerup = e => this._up(e);
    c.onpointerleave = e => this._up(e);
    this._onKeyBound = e => this._onKey(e);
    document.addEventListener('keydown', this._onKeyBound);
    window.addEventListener('resize', () => this._redraw());
  }

  // ---- public API (page drives these) ----
  open(frameId) {
    this.frameId = frameId; this.sel = -1;
    const f = this._frame(); if (!f) return;
    if (this._img.src !== f.url) this._img.src = f.url; else this._redraw();
    this.onChange();
  }
  next() { const i = this._idx(); if (i < this.store.frames.length - 1) this.open(this.store.frames[i + 1].id); }
  prev() { const i = this._idx(); if (i > 0) this.open(this.store.frames[i - 1].id); }
  nextUntagged() {
    const i = this._idx();
    for (let k = i + 1; k < this.store.frames.length; k++) if (!this.store.frames[k].done) return this.open(this.store.frames[k].id);
    for (let k = 0; k < i; k++) if (!this.store.frames[k].done) return this.open(this.store.frames[k].id);
  }
  setActiveCls(i) { this.activeCls = i; this.onChange(); }
  markBackground() { if (!this.frameId) return; this.store.markBackground(this.frameId); this.sel = -1; this._redraw(); this.onChange(); }
  deleteSel() { if (this.sel >= 0) { this.store.deleteBox(this.frameId, this.sel); this.sel = -1; this._redraw(); this.onChange(); } }
  position() { return { i: this._idx() + 1, n: this.store.frames.length }; }

  _frame() { return this.store.frames.find(f => f.id === this.frameId); }
  _idx() { return this.store.frames.findIndex(f => f.id === this.frameId); }

  // ---- drawing (fit whole frame inside the stage: no scroll) ----
  _redraw() {
    const f = this._frame(); if (!f || !this._img.naturalWidth) return;
    const stage = this.mount;
    const W = stage.clientWidth || 640, H = stage.clientHeight || 480;
    const ar = this._img.naturalHeight / this._img.naturalWidth;
    let cw = W, ch = W * ar;
    if (ch > H) { ch = H; cw = H / ar; }
    const c = this.canvas, ctx = c.getContext('2d');
    c.width = Math.round(cw); c.height = Math.round(ch);
    ctx.drawImage(this._img, 0, 0, c.width, c.height);

    f.boxes.forEach((b, i) => {
      const x = b.x * c.width, y = b.y * c.height, w = b.w * c.width, h = b.h * c.height;
      const col = this.store.colorOf(b.cls);
      ctx.lineWidth = i === this.sel ? 3 : 2; ctx.strokeStyle = col; ctx.strokeRect(x, y, w, h);
      const tag = this.store.nameOf(b.cls);
      ctx.font = '600 13px Rubik, sans-serif'; ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(tag).width + 10;
      ctx.fillStyle = col; ctx.fillRect(x, y - 18, tw, 18);
      ctx.fillStyle = '#03121B'; ctx.fillText(tag, x + 5, y - 4);
      if (i === this.sel) { ctx.fillStyle = '#fff'; for (const [hx, hy] of [[x, y],[x+w,y],[x,y+h],[x+w,y+h]]) ctx.fillRect(hx - HANDLE/2, hy - HANDLE/2, HANDLE, HANDLE); }
    });
    if (f.background) {
      ctx.fillStyle = 'rgba(52,211,153,.14)'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#34D399'; ctx.font = '700 15px Rubik'; ctx.textBaseline = 'top'; ctx.fillText('רקע — ללא אובייקט', 10, 10);
    }
    if (this._preview) this._drawPreview();
  }

  _pt(e) { const r = this.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
  _hitCorner(f, p) {
    const c = this.canvas, tol = HANDLE / Math.min(c.width, c.height) + 0.006;
    for (let i = f.boxes.length - 1; i >= 0; i--) { const b = f.boxes[i];
      for (const [corner, cx, cy] of [['nw',b.x,b.y],['ne',b.x+b.w,b.y],['sw',b.x,b.y+b.h],['se',b.x+b.w,b.y+b.h]])
        if (Math.abs(p.x - cx) < tol && Math.abs(p.y - cy) < tol) return { i, corner };
    } return null;
  }
  _hitBody(f, p) { for (let i = f.boxes.length - 1; i >= 0; i--) { const b = f.boxes[i]; if (p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h) return i; } return -1; }

  _down(e) {
    const f = this._frame(); if (!f) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this._pt(e);
    const corner = this._hitCorner(f, p);
    if (corner) { this.sel = corner.i; this._drag = { mode: 'resize', i: corner.i, corner: corner.corner }; this._redraw(); this.onChange(); return; }
    const bodyI = this._hitBody(f, p);
    if (bodyI >= 0) { this.sel = bodyI; this._drag = { mode: 'move', i: bodyI, startX: p.x, startY: p.y, orig: { ...f.boxes[bodyI] } }; this._redraw(); this.onChange(); return; }
    if (!this.store.categories.length) return;
    this._drag = { mode: 'create', startX: p.x, startY: p.y }; this.sel = -1;
  }
  _move(e) {
    if (!this._drag) return;
    const f = this._frame(); const p = this._pt(e);
    if (this._drag.mode === 'create') {
      this._preview = { x: Math.min(p.x, this._drag.startX), y: Math.min(p.y, this._drag.startY), w: Math.abs(p.x - this._drag.startX), h: Math.abs(p.y - this._drag.startY), cls: this.activeCls };
      this._redraw();
    } else if (this._drag.mode === 'move') {
      const b = f.boxes[this._drag.i], o = this._drag.orig;
      b.x = Math.max(0, Math.min(1 - o.w, o.x + (p.x - this._drag.startX)));
      b.y = Math.max(0, Math.min(1 - o.h, o.y + (p.y - this._drag.startY)));
      this._redraw();
    } else if (this._drag.mode === 'resize') {
      const b = f.boxes[this._drag.i], cn = this._drag.corner;
      let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
      if (cn.includes('w')) x1 = p.x; if (cn.includes('e')) x2 = p.x;
      if (cn.includes('n')) y1 = p.y; if (cn.includes('s')) y2 = p.y;
      b.x = Math.min(x1, x2); b.y = Math.min(y1, y2); b.w = Math.abs(x2 - x1); b.h = Math.abs(y2 - y1);
      this._redraw();
    }
  }
  _up() {
    if (!this._drag) return;
    const f = this._frame();
    if (this._drag.mode === 'create' && this._preview && this._preview.w > 0.01 && this._preview.h > 0.01) {
      this.store.addBox(this.frameId, { ...this._preview }); this.sel = f.boxes.length - 1;
    } else if ((this._drag.mode === 'move' || this._drag.mode === 'resize')) {
      this.store.updateBox(this.frameId, this._drag.i, f.boxes[this._drag.i]);
    }
    this._drag = null; this._preview = null; this._redraw(); this.onChange();
  }
  _drawPreview() {
    const c = this.canvas, ctx = c.getContext('2d'), p = this._preview;
    ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = this.store.colorOf(p.cls);
    ctx.strokeRect(p.x * c.width, p.y * c.height, p.w * c.width, p.h * c.height); ctx.setLineDash([]);
  }
  _onKey(e) {
    if (!this.frameId || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSel(); }
    else if (e.key === 'ArrowRight') this.prev();
    else if (e.key === 'ArrowLeft') this.next();
    else if (e.key === ' ') { e.preventDefault(); this.nextUntagged(); }
    else if (/^[1-9]$/.test(e.key)) { const i = +e.key - 1; if (i < this.store.categories.length) this.setActiveCls(i); }
  }
}
