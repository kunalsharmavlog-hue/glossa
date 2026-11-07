// Remembers the folder the user chose for PDFs. A folder handle cannot go into chrome.storage,
// so it is kept in IndexedDB, which every Glossa page (folder page, popup, offscreen page) shares.
(function (root) {
  const DB = "glossa", STORE = "kv", KEY = "pdfFolder";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req && req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  root.FolderStore = {
    get: () => run("readonly", (s) => s.get(KEY)),
    set: (handle) => run("readwrite", (s) => s.put(handle, KEY)),
    clear: () => run("readwrite", (s) => s.delete(KEY)),
  };
})(typeof self !== "undefined" ? self : globalThis);
