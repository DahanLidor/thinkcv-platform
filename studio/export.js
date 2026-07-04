// ===== studio/export.js =====
// ייצוא דאטהסט בפורמט YOLO: תמונות + תיוגים + data.yaml (עם שמות הקטגוריות).
// Packs everything the Colab notebook needs to train. Converts our top-left normalized
// boxes to YOLO's center-normalized format, includes background frames (empty label
// file — teaches the model what NOT to detect), and SKIPS untagged frames.
// The class names go into data.yaml so YoloEngine reads them back automatically.

const JSZIP_CDN = 'https://esm.sh/jszip@3.10.1';

export async function buildYoloZip(store, { onProgress } = {}) {
  const names = store.categories.map(c => c.name);
  if (!names.length) throw new Error('אין קטגוריות — הוסיפו לפחות אחת לפני ייצוא');
  const tagged = store.frames.filter(f => f.done && f.included !== false); // done + not excluded
  if (!tagged.length) throw new Error('אין פריימים מתויגים לייצוא');

  const { default: JSZip } = await import(/* @vite-ignore */ JSZIP_CDN);
  const zip = new JSZip();
  const imgDir = zip.folder('images');
  const lblDir = zip.folder('labels');

  let n = 0, boxCount = 0;
  for (const f of tagged) {
    const base = 'frame_' + String(n).padStart(4, '0');
    const blob = await (await fetch(f.url)).blob();      // dataURL → JPEG blob
    imgDir.file(base + '.jpg', blob);
    // YOLO line: class cx cy w h  (center-normalized)
    const lines = f.boxes.map(b => {
      boxCount++;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      return `${b.cls} ${cx.toFixed(6)} ${cy.toFixed(6)} ${b.w.toFixed(6)} ${b.h.toFixed(6)}`;
    });
    lblDir.file(base + '.txt', lines.join('\n')); // background → empty file
    n++;
    onProgress?.(`אורז ${n}/${tagged.length}…`);
  }

  // Ultralytics data.yaml — names on one line so the round-trip regex reads them back
  const yaml =
    `path: .\n` +
    `train: images\n` +
    `val: images\n` +
    `nc: ${names.length}\n` +
    `names: [${names.map(x => `'${x.replace(/'/g, "")}'`).join(', ')}]\n`;
  zip.file('data.yaml', yaml);

  const stats = { images: n, boxes: boxCount, classes: names.length };
  onProgress?.(`מכין קובץ…`);
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob: zipBlob, stats };
}

// browser download helper
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
