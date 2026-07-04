// ===== sync/supabase.js =====
// מאגר משותף בענן: כולם כותבים וקוראים מאותו מקום. מקור אמת יחיד.
// Talks to Supabase directly over REST + Storage (no SDK — keeps us buildless).
// Images → Storage bucket "frames"; metadata+boxes → table "frames"; shared categories.
//
// No auth ("without passwords"): the anon key is public and the tables are open (RLS
// policy `using(true)`). Fine for a closed classroom; anyone with the link can read/
// write. That's the deliberate trade-off of "no passwords".

const URL = 'https://chtqsudcdlsgbjjutyha.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNodHFzdWRjZGxzZ2JqanV0eWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTIxOTEsImV4cCI6MjA5ODc2ODE5MX0.RTuo11Ma-f7clqHHSE4KruS5rwoSUdMv0vMje3rN1CY';
const BUCKET = 'frames';
const H = { apikey: ANON, Authorization: 'Bearer ' + ANON };

// dataURL → Blob (for uploading a captured/extracted frame image)
function dataURLtoBlob(dataURL) {
  const [head, b64] = dataURL.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export const Cloud = {
  // ---- images → Storage ----
  async uploadImage(id, dataURL) {
    const blob = dataURLtoBlob(dataURL);
    const path = `${id}.jpg`;
    const res = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': blob.type, 'x-upsert': 'true' },
      body: blob,
    });
    if (!res.ok && res.status !== 409) throw new Error('העלאת תמונה נכשלה: ' + res.status);
    return `${URL}/storage/v1/object/public/${BUCKET}/${path}`;
  },

  // ---- frames table ----
  async putFrame(row) {
    const res = await fetch(`${URL}/rest/v1/frames`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error('שמירת פריים נכשלה: ' + res.status);
  },
  async patchFrame(id, patch) {
    const res = await fetch(`${URL}/rest/v1/frames?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('עדכון פריים נכשל: ' + res.status);
  },
  async deleteFrame(id) {
    await fetch(`${URL}/rest/v1/frames?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: H });
    await fetch(`${URL}/storage/v1/object/${BUCKET}/${id}.jpg`, { method: 'DELETE', headers: H });
  },
  async listFrames() {
    const res = await fetch(`${URL}/rest/v1/frames?select=*&order=created_at.asc`, { headers: H });
    if (!res.ok) throw new Error('קריאת פריימים נכשלה: ' + res.status);
    return res.json();
  },

  // ---- shared categories ----
  async listCategories() {
    const res = await fetch(`${URL}/rest/v1/categories?select=*&order=created_at.asc`, { headers: H });
    if (!res.ok) throw new Error('קריאת קטגוריות נכשלה: ' + res.status);
    return res.json();
  },
  async putCategory(name, color) {
    await fetch(`${URL}/rest/v1/categories`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ name, color }),
    });
  },
};
