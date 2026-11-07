// A hidden Glossa page that writes PDFs into the folder the user chose.
// The background script cannot hold a folder open itself, so it asks this page to do the writing.

async function freeName(dir, name) {
  // "Film - Vocabulary.pdf" becomes "Film - Vocabulary (2).pdf" when a file with that name is already there.
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; n < 500; n++) {
    const candidate = n === 1 ? name : `${base} (${n})${ext}`;
    try { await dir.getFileHandle(candidate); } catch { return candidate; }
  }
  return `${base} ${Date.now()}${ext}`;
}

async function save({ name, base64 }) {
  const dir = await FolderStore.get();
  if (!dir) return { ok: false, reason: "none" };
  const state = await dir.queryPermission({ mode: "readwrite" });
  if (state !== "granted") return { ok: false, reason: "permission", folder: dir.name };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const finalName = await freeName(dir, name);
  const file = await dir.getFileHandle(finalName, { create: true });
  const out = await file.createWritable();
  await out.write(new Blob([bytes], { type: "application/pdf" }));
  await out.close();
  return { ok: true, folder: dir.name, name: finalName };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== "offscreen" || msg.type !== "save") return;
  save(msg).then(reply, (err) => reply({ ok: false, reason: "error", error: String(err && err.message || err) }));
  return true;
});
