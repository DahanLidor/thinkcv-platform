// ===== dashboard/dashboard.js =====
// המשטח של הלקוח (ראש העיר): וידאו עם תיוגים + אנליטיקה חיה + לוג התראות. read-only.
// A pure renderer. It subscribes to the bus and draws — it never decides anything.
// Give it a mount element and the source's <video>; it wires the rest itself.

import { EV } from '../engine/events.js';

const PALETTE = ['#22D3EE','#F472B6','#A78BFA','#34D399','#FBBF24','#F87171','#5aa9e6','#e6c45a'];
const colorOf = i => PALETTE[i % PALETTE.length];

export class Dashboard {
  constructor(bus, mount, { title = 'ניטור עירוני — תצוגה חיה' } = {}) {
    this.bus = bus;
    this.mount = typeof mount === 'string' ? document.querySelector(mount) : mount;
    this.title = title;
    this._log = [];
    this._render();
    this._wire();
  }

  attachVideo(videoEl) {
    this._videoWrap.innerHTML = '';
    videoEl.classList.add('dash-video');
    this._videoWrap.appendChild(videoEl);
    this._videoWrap.appendChild(this._overlay);
    this._video = videoEl;
  }

  _wire() {
    // pure renderer: draw boxes from FRAME, stats from ANALYTICS, entries from LOG
    this.bus.on(EV.FRAME, ({ detections }) => this._drawBoxes(detections));
    this.bus.on(EV.ANALYTICS, (a) => this._renderAnalytics(a));
    this.bus.on(EV.LOG, (entry) => this._pushLog(entry));
  }

  _drawBoxes(dets) {
    const v = this._video, cv = this._overlay;
    if (!v) return;
    const w = v.clientWidth, h = v.clientHeight;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 13px Rubik, sans-serif';
    ctx.textBaseline = 'bottom';
    for (const d of dets) {
      const c = colorOf(d.cls);
      const x = d.x * w, y = d.y * h, bw = d.w * w, bh = d.h * h;
      ctx.lineWidth = 2.5; ctx.strokeStyle = c;
      ctx.strokeRect(x, y, bw, bh);
      const tag = `${d.label} ${Math.round(d.score * 100)}%`;
      const tw = ctx.measureText(tag).width + 10;
      ctx.fillStyle = c;
      ctx.fillRect(x, y - 18, tw, 18);
      ctx.fillStyle = '#03121B';
      ctx.fillText(tag, x + 5, y - 3);
    }
  }

  _renderAnalytics(a) {
    this._haz.textContent = a.hazard;
    this._hazBar.style.width = a.hazard + '%';
    this._mObj.textContent = a.total;
    this._mCls.textContent = a.classes;
    this._mAvg.textContent = Math.round(a.avgConf * 100) + '%';
    const maxCount = Math.max(1, ...a.perClass.map(e => e.count));
    this._classStats.innerHTML = a.perClass.map(e => `
      <div class="abar">
        <div class="top"><span class="sw" style="background:${colorOf(e.cls)}"></span>${e.label}
          <span class="c">×${e.count} · ${Math.round(e.avgConf * 100)}%</span></div>
        <div class="b"><i style="width:${e.count / maxCount * 100}%;background:${colorOf(e.cls)}"></i></div>
      </div>`).join('') || '<div class="empty">אין זיהויים כרגע</div>';
  }

  _pushLog({ level = 'low', msg, ts }) {
    this._log.unshift({ level, msg, ts: ts || Date.now() });
    this._log = this._log.slice(0, 40);
    const col = l => l === 'high' ? 'var(--danger)' : l === 'med' ? 'var(--warn)' : 'var(--ok)';
    this._logEl.innerHTML = this._log.map(e => {
      const time = new Date(e.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="logrow"><span class="dot" style="background:${col(e.level)}"></span>
        <span class="t">${time}</span><span class="m">${e.msg}</span></div>`;
    }).join('') || '<div class="empty">אין אירועים עדיין</div>';
  }

  _render() {
    this.mount.innerHTML = `
      <div class="dash-head">
        <div class="dash-title">${this.title}</div>
        <span class="live"><i></i> חי</span>
      </div>
      <div class="dash-grid">
        <div class="dash-stage" data-video></div>
        <div class="dash-side">
          <div class="card">
            <div class="gauge"><div class="num" data-haz>0</div><div class="lbl">מדד סיכון</div>
              <div class="track"><i data-hazbar style="width:0%"></i></div></div>
            <div class="mini">
              <div class="b"><div class="v" data-obj>0</div><div class="l">אובייקטים</div></div>
              <div class="b"><div class="v" data-cls>0</div><div class="l">קטגוריות</div></div>
              <div class="b"><div class="v" data-avg>0%</div><div class="l">ביטחון</div></div>
            </div>
            <div class="sec">לפי קטגוריה</div>
            <div data-classstats></div>
          </div>
          <div class="card">
            <div class="sec">🔔 יומן אירועים</div>
            <div class="log" data-log></div>
          </div>
        </div>
      </div>`;
    const q = s => this.mount.querySelector(s);
    this._videoWrap = q('[data-video]');
    this._overlay = document.createElement('canvas');
    this._overlay.className = 'dash-overlay';
    this._haz = q('[data-haz]'); this._hazBar = q('[data-hazbar]');
    this._mObj = q('[data-obj]'); this._mCls = q('[data-cls]'); this._mAvg = q('[data-avg]');
    this._classStats = q('[data-classstats]');
    this._logEl = q('[data-log]');
  }
}
