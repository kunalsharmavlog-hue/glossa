// End-to-end test of the real Glossa extension in headless Chrome, on a mock Netflix watch page.
// Usage: node run.mjs <extension dir>
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const EXT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".work");
const DL = path.join(HERE, "dl");
fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL);
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok, info }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Mock Netflix watch page ----------
const CUES = [];
const LINES = ["I'm reluctant to trust him, he's too charming.", "Breaking in? It was a piece of cake.", "Don't be so naive. The evidence is ambiguous.",
  "You'd never betray the team.", "That alibi is flimsy at best.", "The silence felt ominous.", "We cannot give up now.", "His testimony was meticulous."];
for (let t = 4, i = 0; t < 352; t += 14, i++) CUES.push([t, t + 9, LINES[i % LINES.length]]);
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>The Heist - Netflix</title>
<style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%}
.player-timedtext{position:fixed;left:0;right:0;bottom:12vh;text-align:center;pointer-events:none}
.player-timedtext-text-container span{font:600 30px Arial;color:#fff}</style></head><body>
<div class="watch-video" id="app" style="position:fixed;inset:0"><video id="v" src="/movie.mp4" muted playsinline></video></div>
<div class="player-timedtext"><div class="player-timedtext-text-container"><span id="cue"></span></div></div>
<div data-uia="video-title"><h4>The Heist</h4><span>E3</span><span>The Vault</span></div>
<script>
const CUES=${JSON.stringify(CUES)};const v=document.getElementById('v'),cue=document.getElementById('cue');
document.getElementById('app').addEventListener('click',()=>v.paused?v.play():v.pause());
setInterval(()=>{const c=CUES.find(([a,b])=>v.currentTime>=a&&v.currentTime<b);cue.textContent=c?c[2]:'';},80);
</script></body></html>`;
const movie = fs.readFileSync(path.join(HERE, "movie.mp4"));
const server = https.createServer({ key: fs.readFileSync(path.join(HERE, "key.pem")), cert: fs.readFileSync(path.join(HERE, "cert.pem")) }, (req, res) => {
  if (req.url.startsWith("/movie.mp4")) {
    const range = req.headers.range;
    if (range) {
      const [a, b] = range.replace("bytes=", "").split("-");
      const start = +a, end = b ? +b : movie.length - 1;
      res.writeHead(206, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${movie.length}`, "Content-Length": end - start + 1 });
      return res.end(movie.subarray(start, end + 1));
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": movie.length });
    return res.end(movie);
  }
  res.writeHead(200, { "Content-Type": "text/html" }); res.end(PAGE);
}).listen(8443);

// ---------- Chrome over a CDP pipe ----------
const PROF = path.join(HERE, "profile");
fs.mkdirSync(path.join(PROF, "Default"), { recursive: true });
fs.writeFileSync(path.join(PROF, "Default", "Preferences"), JSON.stringify({ download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true } }));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${path.join(HERE, "profile")}`, "--host-resolver-rules=MAP www.netflix.com 127.0.0.1:8443", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800", "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
const out = chrome.stdio[3], inp = chrome.stdio[4];
let buf = "", id = 0; const pending = new Map(), listeners = [];
inp.on("data", (d) => { buf += d.toString(); let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach((f) => f(m)); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); out.write(JSON.stringify({ id: i, method, params, sessionId }) + "\0"); });
const errors = [];
listeners.push((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split("\n")[0]);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
});

try {
  const load = await send("Extensions.loadUnpacked", { path: EXT });
  if (load.error) { check("Extension loads", false, load.error.message); throw new Error("stop"); }
  const extId = load.result.id;
  check("Extension loads", true, extId);
  await send("Target.setDiscoverTargets", { discover: true });
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await sleep(1500);
  // Attach to the service worker to catch its errors.
  const { result: { targetInfos } } = await send("Target.getTargets");
  const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(extId));
  let swS = null;
  if (sw) { swS = (await send("Target.attachToTarget", { targetId: sw.targetId, flatten: true })).result.sessionId; await send("Runtime.enable", {}, swS); }
  check("Background service worker starts", !!sw);

  const { result: { targetId } } = await send("Target.createTarget", { url: "https://www.netflix.com/watch/81234" });
  const s = (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await send("Runtime.enable", {}, s); await send("Page.enable", {}, s);
  await sleep(3000);
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s); return r.result?.result?.value; };
  const evSW = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, swS); return r.result?.result?.value; };

  await ev("v.play(); v.playbackRate = 1; true");
  await sleep(4000);
  // 1. Pause & Pick
  await ev("v.pause(); true");
  await sleep(900);
  const bar = await ev("(()=>{const t=document.querySelector('.glossa-text');return t?t.textContent:null})()");
  check("Pausing shows the selectable subtitle", !!bar, bar || "no bar");
  if (bar) {
    const pt = await ev(`(()=>{const t=document.querySelector('.glossa-text').firstChild;const i=t.data.indexOf('reluctant');if(i<0)return null;const r=document.createRange();r.setStart(t,i);r.setEnd(t,i+9);const b=r.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
    if (pt) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt[0], y: pt[1], button: "left", clickCount: 1 }, s);
      let card = null;
      for (let i = 0; i < 30 && !(card && !card.includes("Looking up")); i++) { await sleep(500); card = await ev("document.querySelector('.glossa-card')?.innerText || null"); }
      check("Clicking a word shows its meaning", !!card && /reluctant/i.test(card) && /English/i.test(card), (card || "no card").replace(/\s+/g, " ").slice(0, 140));
      check("Video stays paused after the click", await ev("v.paused"));
      const saved = await ev(`(async()=>{const b=[...document.querySelectorAll('.glossa-btn')].find(x=>/Save/.test(x.textContent));if(!b)return 'no button';b.click();await new Promise(r=>setTimeout(r,800));return b.textContent})()`);
      check("Save to PDF works", /Saved/.test(saved || ""), saved);
    } else check("Clicking a word shows its meaning", false, "word not on screen");
  }
  // 2. Phrase pick through the background directly
  const phrase = await ev(`chrome.runtime ? 'n/a' : 'n/a'`);
  const ph = swS ? await evSW(`explain("give up").then(r=>JSON.stringify(r))`) : null;
  check("Phrases get an idiom meaning", !!ph && /"ok":true/.test(ph), (ph || "").slice(0, 140));
  const line = swS ? await evSW(`explain("Don't be so naive. The evidence is ambiguous.").then(r=>JSON.stringify(r))`) : null;
  check("Whole lines get a Hindi translation", !!line && /"hindi":"[^"]+"/.test(line), (line || "").slice(0, 140));

  // 2b. When MyMemory's daily limit is used up, Hindi must still come from the backup service.
  const quota = swS ? await evSW(`(async()=>{const real=fetch;globalThis.fetch=(u,o)=>String(u).includes('mymemory')?Promise.resolve(new Response(JSON.stringify({responseData:{translatedText:'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY'},responseStatus:429,matches:[]}),{status:200})):real(u,o);try{return JSON.stringify(await hindiFor('meticulous'))}finally{globalThis.fetch=real}})()`) : null;
  check("Hindi still works when the free limit runs out", !!quota && /[\u0900-\u097F]/.test(quota), quota || "");
  // 3. Play to the end fast and expect a PDF
  await ev("v.play(); v.playbackRate = 16; true");
  let lines = 0;
  for (let i = 0; i < 60; i++) { await sleep(1000); if (await ev("v.ended || v.currentTime > 351")) break; }
  await sleep(1500);
  lines = swS ? await evSW(`chrome.storage.local.get('s:81234').then(r=>r['s:81234']?.lines.length||0)`) : 0;
  check("Subtitle lines are recorded while playing", lines >= 8, `${lines} lines`);
  const title = swS ? await evSW(`chrome.storage.local.get('s:81234').then(r=>r['s:81234']?.title||'')`) : "";
  check("Film title is read", /Heist/.test(title), title);
  let pdf = null;
  for (let i = 0; i < 90 && !pdf; i++) { await sleep(1000); const f = fs.readdirSync(DL, { recursive: true }).find((x) => String(x).endsWith(".pdf")); if (f) pdf = String(f); }
  check("PDF downloads by itself at the end", !!pdf, pdf || "no PDF after 90s");
  const note = await ev("document.getElementById('glossa-saved')?.innerText || null");
  check("A small note at the top says the PDF was saved", !!note && /PDF saved/.test(note), (note || "no note").replace(/\s+/g, " "));
  if (pdf) {
    const bytes = fs.readFileSync(path.join(DL, pdf));
    const text = bytes.toString("latin1");
    check("PDF is valid and lists the picked word first", text.startsWith("%PDF") && /reluctant/.test(text) && /your pick/.test(text), `${bytes.length} bytes`);
  }
  // 4. Popup
  const { result: { targetId: pid } } = await send("Target.createTarget", { url: `chrome-extension://${extId}/popup.html` });
  const ps = (await send("Target.attachToTarget", { targetId: pid, flatten: true })).result.sessionId;
  await send("Runtime.enable", {}, ps); await sleep(1500);
  const pop = (await send("Runtime.evaluate", { expression: "document.body.innerText + ' ' + [...document.querySelectorAll('input.name')].map(i => i.value).join(' ')", returnByValue: true }, ps)).result?.result?.value || "";
  check("Popup lists the film", /Heist/.test(pop) && /PDF ready/.test(pop), pop.replace(/\s+/g, " ").slice(-200));
  const dls = swS ? await evSW(`new Promise(r=>chrome.downloads.search({},x=>r(JSON.stringify(x.map(d=>[d.filename,d.state,d.error])))))`) : "";
  check("PDF gets the film name and Glossa folder", /Glossa\/The Heist/.test(dls || ""), dls);
  check("No errors in the extension", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  if (e.message !== "stop") check("Test run", false, e.stack.split("\n").slice(0, 3).join(" "));
} finally {
  chrome.kill(); server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
