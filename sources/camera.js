// ===== sources/camera.js =====
// שכבת מקורות: מזרים פריימים למנוע בקצב מווסת. מצלמה עכשיו; קובץ/טלפון בהמשך — אותו ממשק.
// A frame source. Every source (webcam, file, phone camera, stream) implements the
// same tiny contract so the pipeline never cares which one is active:
//
//   start(onFrame)  — begin delivering frames; onFrame(videoEl) called ~fps times/sec
//   stop()          — release everything
//   el              — the <video> element (dashboard draws it + overlay)
//
// Throttled to ~fps (default 8) — plenty for detection, and kind to a Chromebook.

import { EV } from '../engine/events.js';

export class CameraSource {
  constructor(bus, { fps = 8, facingMode = 'environment' } = {}) {
    this.bus = bus;
    this.interval = 1000 / fps;
    this.facingMode = facingMode;
    this.el = document.createElement('video');
    this.el.muted = true;
    this.el.playsInline = true;
    this.el.autoplay = true;
    this._stream = null;
    this._raf = null;
    this._last = 0;
    this._busy = false;
  }

  async start(onFrame) {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode, width: { ideal: 640 } },
        audio: false,
      });
    } catch (e) {
      // getUserMedia fails on http (needs https) or when permission is denied
      this.bus?.emit(EV.SOURCE, { state: 'error', error: e });
      this.bus?.emit(EV.LOG, {
        level: 'high',
        msg: 'אין גישה למצלמה — צריך https והרשאה. פתחו את הדף ב-https ואשרו את הבקשה.',
        ts: Date.now(),
      });
      throw e;
    }

    this.el.srcObject = this._stream;
    await this.el.play().catch(() => {});
    await new Promise(res => {
      if (this.el.readyState >= 2) return res();
      this.el.onloadeddata = () => res();
    });

    this.bus?.emit(EV.SOURCE, { state: 'started', kind: 'camera' });

    const loop = async (t) => {
      this._raf = requestAnimationFrame(loop);
      if (this._busy || t - this._last < this.interval) return; // throttle
      this._last = t;
      this._busy = true;
      try { await onFrame(this.el); }
      finally { this._busy = false; }
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._stream) this._stream.getTracks().forEach(tr => tr.stop());
    this._stream = null;
    this.el.srcObject = null;
    this.bus?.emit(EV.SOURCE, { state: 'stopped' });
  }
}
