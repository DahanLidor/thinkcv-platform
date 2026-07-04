// ===== studio/frames.js =====
// קלט הסטודיו: העלאת וידאו/תמונות → פריימים חדים לתיוג.
// UI-agnostic. Extracts the sharpest frames from a video (variance-of-Laplacian),
// with the iPhone/HEVC black-frame guards proven in the old platform. Also accepts
// images directly. Returns [{url, score}] — the annotator consumes these next.

export class FrameExtractor {
  constructor({ maxW = 640 } = {}) { this.maxW = maxW; }

  // ---- images: just normalize to dataURLs ----
  async fromImages(fileList, onProgress) {
    const out = [];
    const files = [...fileList];
    for (let i = 0; i < files.length; i++) {
      const url = await this._fileToDataURL(files[i]);
      out.push({ url, score: 1 });
      onProgress?.(`תמונות: ${i + 1}/${files.length}`);
    }
    return out;
  }

  // ---- video: sample, score sharpness, keep the `want` sharpest ----
  async fromVideo(file, { want = 12, onProgress } = {}) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;

    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error('הדפדפן לא מפענח את הווידאו (קודק לא נתמך — נפוץ ב-HEVC מאייפון). נסו הגדרות מצלמה → "Most Compatible", או העלו תמונות.'));
      });
      const dur = v.duration || 0;
      if (!v.videoWidth || !v.videoHeight) {
        throw new Error('הדפדפן לא מפענח את הווידאו (קודק לא נתמך). נסו "Most Compatible" או העלו תמונות.');
      }

      const cw = Math.min(v.videoWidth, this.maxW);
      const ch = Math.round(v.videoHeight * cw / v.videoWidth);
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d', { willReadFrequently: true });

      // PRIME the decoder — phone videos paint BLACK to canvas until playback has
      // actually run once. Play muted briefly, then pause.
      try { await v.play(); await new Promise(r => setTimeout(r, 150)); v.pause(); } catch (e) {}

      const t0 = Math.min(0.3, dur * 0.05), t1 = dur - Math.min(0.3, dur * 0.05);
      const span = Math.max(t1 - t0, 0.1);

      const seek = t => new Promise(res => {
        let done = false;
        const settle = () => {
          if (done) return; done = true; clearTimeout(to);
          if ('requestVideoFrameCallback' in v) {
            let fired = false;
            const t2 = setTimeout(() => { if (!fired) { fired = true; res(); } }, 400);
            v.requestVideoFrameCallback(() => { if (!fired) { fired = true; clearTimeout(t2); res(); } });
          } else setTimeout(res, 60);
        };
        const to = setTimeout(settle, 2500);
        v.onseeked = settle;
        try { v.currentTime = t; } catch (e) { settle(); }
      });

      const looksBlack = () => {
        const d = ctx.getImageData(0, 0, Math.min(cw, 32), Math.min(ch, 24)).data;
        let s = 0, n = 0; for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; n++; }
        return (s / n / 3) < 4;
      };

      const tries = Math.min(want * 2, want + 80); // oversample, then keep sharpest
      const cands = [];
      for (let i = 0; i < tries; i++) {
        await seek(Math.min(t0 + span * (i / (tries - 1 || 1)), t1));
        ctx.drawImage(v, 0, 0, cw, ch);
        if (looksBlack()) {
          await new Promise(r => setTimeout(r, 200));
          ctx.drawImage(v, 0, 0, cw, ch);
          if (looksBlack()) continue; // still black → drop
        }
        cands.push({ url: cv.toDataURL('image/jpeg', 0.85), score: this._blurScore(ctx, cw, ch), i });
        onProgress?.(`סורק פריימים… ${i + 1}/${tries}`);
        await new Promise(r => setTimeout(r, 0)); // yield to UI
      }
      if (!cands.length) {
        throw new Error('כל הפריימים יצאו שחורים — הדפדפן לא מפענח את הסרטון. באייפון: הגדרות → מצלמה → Formats → Most Compatible, וצלמו שוב. או העלו תמונות.');
      }
      // keep the `want` sharpest, restored to time order
      return cands.slice().sort((a, b) => b.score - a.score).slice(0, want).sort((a, b) => a.i - b.i)
        .map(({ url, score }) => ({ url, score }));
    } finally {
      URL.revokeObjectURL(url); v.removeAttribute('src');
    }
  }

  // variance-of-Laplacian sharpness (higher = sharper). Ported, unchanged.
  _blurScore(srcCtx, W, H) {
    const sw = Math.min(W, 256), sh = Math.max(1, Math.round(H * sw / W));
    const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(srcCtx.canvas, 0, 0, sw, sh);
    const d = tctx.getImageData(0, 0, sw, sh).data;
    const g = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - sw] - g[i + sw];
      sum += lap; sum2 += lap * lap; n++;
    }
    return sum2 / n - (sum / n) * (sum / n);
  }

  _fileToDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('קריאת קובץ נכשלה'));
      r.readAsDataURL(file);
    });
  }
}
