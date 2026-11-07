const level = document.getElementById("level");
const showSubs = document.getElementById("showSubs");
const pausePick = document.getElementById("pausePick");
const list = document.getElementById("movies");

async function render() {
  const all = await chrome.storage.local.get(null);
  level.value = all.level || "all";
  showSubs.checked = !!all.showSubs;
  pausePick.checked = all.pausePick !== false;
  document.getElementById("folderName").textContent = all.pdfFolder || "Downloads / Glossa";

  const sessions = Object.keys(all)
    .filter((k) => k.startsWith("s:"))
    .map((k) => all[k])
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  list.textContent = "";
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Play a movie on Netflix. Words are collected automatically.";
    list.append(empty);
    return;
  }

  for (const s of sessions) {
    const row = document.createElement("div");
    row.className = "movie";

    // Editable, in case Netflix did not give the movie's name.
    const name = document.createElement("input");
    name.className = "name";
    name.title = "PDF ki headline";
    name.value = all[`name:${s.id}`] || s.title || `Netflix Movie ${s.id}`;
    name.addEventListener("change", () => chrome.storage.local.set({ [`name:${s.id}`]: name.value.trim() }));
    const built = all[`built:${s.id}`];

    const pct = s.duration ? Math.min(100, Math.round(((s.maxPosition || 0) / s.duration) * 100)) : 0;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${pct}% watched | ${s.lines.length} subtitle lines` + (built ? ` | PDF ready: ${built.words} words` : "");

    const button = document.createElement("button");
    button.textContent = "Create PDF now";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Creating PDF...";
      const res = await chrome.runtime.sendMessage({ type: "build", id: s.id });
      if (res && res.ok) {
        render();
      } else {
        button.disabled = false;
        button.textContent = (res && res.error) || "Could not create the PDF. Try again.";
      }
    });

    row.append(name, meta, button);
    list.append(row);
  }
}

level.addEventListener("change", () => chrome.storage.local.set({ level: level.value }));
showSubs.addEventListener("change", () => chrome.storage.local.set({ showSubs: showSubs.checked }));
pausePick.addEventListener("change", () => chrome.storage.local.set({ pausePick: pausePick.checked }));
// Picking a folder needs a full page: the popup would close as soon as the folder picker opens.
document.getElementById("folderBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("folder.html") }));
render();
