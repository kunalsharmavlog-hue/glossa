// Lets the user pick the folder where vocabulary PDFs are saved.
const current = document.getElementById("current");
const chooseBtn = document.getElementById("choose");
const allowBtn = document.getElementById("allow");
const resetBtn = document.getElementById("reset");
const msg = document.getElementById("msg");

function say(text, kind = "") { msg.textContent = text; msg.className = "msg " + kind; }

async function render() {
  const dir = await FolderStore.get().catch(() => null);
  if (!dir) {
    current.textContent = "Downloads / Glossa";
    allowBtn.hidden = true; resetBtn.hidden = true;
    chooseBtn.textContent = "Choose folder";
    return;
  }
  current.textContent = dir.name;
  resetBtn.hidden = false;
  chooseBtn.textContent = "Choose a different folder";
  const state = await dir.queryPermission({ mode: "readwrite" });
  allowBtn.hidden = state === "granted";
  if (state !== "granted") say("Chrome needs your OK again to save into this folder.", "err");
}

chooseBtn.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) { say("This browser cannot pick folders. PDFs will keep going to Downloads / Glossa.", "err"); return; }
  try {
    const dir = await showDirectoryPicker({ id: "glossa-pdfs", mode: "readwrite", startIn: "documents" });
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") { say("Glossa was not allowed to save there.", "err"); return; }
    await FolderStore.set(dir);
    await chrome.storage.local.set({ pdfFolder: dir.name });
    say(`Done. PDFs will be saved in "${dir.name}".`, "ok");
    render();
  } catch (err) {
    if (err && err.name === "AbortError") return; // The user closed the picker.
    say(String(err && err.message || err), "err");
  }
});

allowBtn.addEventListener("click", async () => {
  const dir = await FolderStore.get();
  if (dir && (await dir.requestPermission({ mode: "readwrite" })) === "granted") {
    say(`Access is back. PDFs will be saved in "${dir.name}".`, "ok");
    render();
  }
});

resetBtn.addEventListener("click", async () => {
  await FolderStore.clear();
  await chrome.storage.local.remove("pdfFolder");
  say("PDFs will be saved in Downloads / Glossa.", "ok");
  render();
});

render();
