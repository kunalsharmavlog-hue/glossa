// Saving PDFs into a chosen folder, and Glossa reloading itself when its files change.
// Usage: node extras.mjs <extension dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SRC = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".work");
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A copy of the extension, so the self-update check can change a file without touching the real one.
const EXT = path.join(HERE, "ext-copy");
fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(EXT, { recursive: true });
for (const f of fs.readdirSync(SRC)) {
  if (/\.(js|json|html)$/.test(f)) fs.copyFileSync(path.join(SRC, f), path.join(EXT, f));
}
fs.cpSync(path.join(SRC, "icons"), path.join(EXT, "icons"), { recursive: true });

const PROF = path.join(HERE, "profile-extras");
fs.rmSync(PROF, { recursive: true, force: true });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${PROF}`, "--window-size=1280,800", "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
const out = chrome.stdio[3], inp = chrome.stdio[4];
let buf = "", id = 0; const pending = new Map();
inp.on("data", (d) => { buf += d.toString(); let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); out.write(JSON.stringify({ id: i, method, params, sessionId }) + "\0"); });
const evalIn = async (s, expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;

async function worker(extId) {
  for (let i = 0; i < 20; i++) {
    const { result: { targetInfos } } = await send("Target.getTargets");
    const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(extId));
    if (sw) { const s = (await send("Target.attachToTarget", { targetId: sw.targetId, flatten: true })).result.sessionId; await send("Runtime.enable", {}, s); return s; }
    await sleep(500);
  }
  return null;
}

try {
  const load = await send("Extensions.loadUnpacked", { path: EXT });
  const extId = load.result?.id;
  check("Extension loads", !!extId, load.error?.message || extId);
  await sleep(1500);
  let sw = await worker(extId);

  // 1. A chosen folder. The private file system stands in for a real folder: it is the same kind of handle.
  const { result: { targetId } } = await send("Target.createTarget", { url: `chrome-extension://${extId}/folder.html` });
  const page = (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await send("Runtime.enable", {}, page);
  await sleep(1200);
  await evalIn(page, `(async()=>{const d=await navigator.storage.getDirectory();const sub=await d.getDirectoryHandle('My Vocab',{create:true});await FolderStore.set(sub);await chrome.storage.local.set({pdfFolder:'My Vocab'});return true})()`);
  const shown = await evalIn(page, `(async()=>{location.reload();await new Promise(r=>setTimeout(r,1000));return document.getElementById('current').textContent})()`);
  await sleep(1200);
  const label = await evalIn(page, `document.getElementById('current').textContent`);
  check("Folder page shows the chosen folder", label === "My Vocab", label || shown);

  await evalIn(sw, `chrome.storage.local.set({"s:777":{id:"777",title:"Test Film",lines:[{t:5,text:"The evidence is ambiguous."},{t:9,text:"I'm reluctant to trust him."},{t:14,text:"That alibi is flimsy."},{t:20,text:"You'd never betray us."},{t:25,text:"It felt ominous."}],duration:600,maxPosition:590,updatedAt:Date.now()}})`);
  const res = await evalIn(sw, `buildPdf("777").then(r=>JSON.stringify(r))`);
  check("PDF is saved into the chosen folder", /"where":"folder"/.test(res || ""), (res || "").slice(0, 160));
  const files = await evalIn(page, `(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('My Vocab');const out=[];for await (const [n,h] of d.entries()){const f=await h.getFile();out.push(n+' '+f.size+' '+(await f.slice(0,5).text()))}return out})()`);
  check("The folder holds a real PDF with the film's name", (files || []).some((f) => /^Test Film - Vocabulary\.pdf \d+ %PDF-/.test(f)), JSON.stringify(files));
  const again = await evalIn(sw, `chrome.storage.local.remove("built:777").then(()=>buildPdf("777")).then(r=>r.file)`);
  check("A second PDF for the same film gets a new name", /\(2\)\.pdf$/.test(again || ""), again);

  // 2. Without a folder, PDFs go to Downloads/Glossa as before.
  await evalIn(page, `(async()=>{await FolderStore.clear();await chrome.storage.local.remove('pdfFolder');return true})()`);
  const dl = await evalIn(sw, `chrome.storage.local.remove("built:777").then(()=>buildPdf("777")).then(r=>r.where)`);
  check("Without a folder, PDFs go to Downloads", dl === "downloads", dl);

  // 3. Self-update: change a file on disk and Glossa reloads itself within about half a minute.
  const before = await evalIn(sw, `chrome.storage.session.get("codeHash").then(r=>r.codeHash||"")`);
  check("Glossa remembers the code it started with", !!before, (before || "").slice(0, 12));
  fs.appendFileSync(path.join(EXT, "learn.js"), "\n// changed by the self-update test\n");
  let after = before;
  for (let i = 0; i < 50 && (!after || after === before); i++) {
    await sleep(1500);
    sw = await worker(extId);
    after = sw ? await evalIn(sw, `chrome.storage.session.get("codeHash").then(r=>r.codeHash||"")`) : "";
  }
  check("Changing a file makes Glossa reload itself", !!after && after !== before, `${(before || "").slice(0, 8)} → ${(after || "").slice(0, 8)}`);
} finally {
  chrome.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
