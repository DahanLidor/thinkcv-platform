// ===== studio/capture.js =====
// צילום תמונות מהמצלמה החיה בתוך הסטודיו — תצוגה חיה + "צלם" שתופס פריים.
// Self-contained (no bus/engine) — just getUserMedia into a <video>, and snap()
// grabs the current frame as a JPEG dataURL, ready to hand to the store like any
// uploaded frame. Needs https or localhost (getUserMedia requirement).

export class CameraCapture {
  constructor({ facingMode = 'environment', maxW = 640 } = {}) {
    this.facingMode = facingMode;
    this.maxW = maxW;
    this._stream = null;
    this.video = null;
  }

  async start(videoEl) {
    this.video = videoEl;
    this._stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facingMode, width: { ideal: 1280 } },
      audio: false,
    });
    videoEl.srcObject = this._stream;
    videoEl.muted = true; videoEl.playsInline = true;
    await videoEl.play().catch(() => {});
    await new Promise(res => { if (videoEl.readyState >= 2) res(); else videoEl.onloadeddata = () => res(); });
  }

  // grab the current frame → { url, score }
  snap() {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    const w = Math.min(v.videoWidth, this.maxW);
    const h = Math.round(v.videoHeight * w / v.videoWidth);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return { url: c.toDataURL('image/jpeg', 0.9), score: 1 };
  }

  stop() {
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    this._stream = null;
    if (this.video) this.video.srcObject = null;
  }
}
