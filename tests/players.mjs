// Pause & Pick on sites other than Netflix: a YouTube-style player and a plain page with built-in captions.
// Usage: node players.mjs <extension dir>   (run.sh prepares .work/ first)
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const EXT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".work");
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LINE = "Don't be so naive. The evidence is ambiguous.";
const YT = `<!doctype html><html><head><meta charset="utf-8"><title>Clip - YouTube</title>
<style>body{margin:0;background:#000}#movie_player{position:relative;width:960px;height:540px}video{width:100%;height:100%}
.ytp-caption-window-container{position:absolute;left:0;right:0;bottom:40px;text-align:center}
.ytp-caption-segment{font:24px Arial;color:#fff;background:rgba(0,0,0,.7)}</style></head><body>
<div id="movie_player"><video id="v" src="/movie.mp4" muted playsinline></video>
<div class="ytp-caption-window-container"><div class="caption-window"><span class="caption-visual-line"><span class="ytp-caption-segment" id="seg"></span></span></div></div></div>
<script>const v=document.getElementById('v');document.getElementById('movie_player').addEventListener('click',()=>v.paused?v.play():v.pause());
setInterval(()=>{document.getElementById('seg').textContent=v.currentTime>1?${JSON.stringify(LINE)}:'';},80);</script></body></html>`;
const PLAIN = `<!doctype html><html><head><meta charset="utf-8"><title>Lecture</title></head><body style="margin:0;background:#111">
<video id="v" src="/movie.mp4" muted playsinline style="width:960px;height:540px"><track kind="subtitles" srclang="en" src="/subs.vtt" default></video></body></html>`;
const VTT = `WEBVTT\n\n00:00.500 --> 05:00.000\n${LINE}\n`;

const movie = fs.readFileSync(path.join(HERE, "movie.mp4"));
const server = https.createServer({ key: fs.readFileSync(path.join(HERE, "key.pem")), cert: fs.readFileSync(path.join(HERE, "cert.pem")) }, (req, res) => {
  if (req.url.startsWith("/movie.mp4")) {
    const range = req.headers.range;
    const [a, b] = (range || "bytes=0-").replace("bytes=", "").split("-");
    const start = +a, end = b ? +b : movie.length - 1;
    res.writeHead(range ? 206 : 200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${movie.length}`, "Content-Length": end - start + 1 });
    return res.end(movie.subarray(start, end + 1));
  }
  if (req.url.startsWith("/subs.vtt")) { res.writeHead(200, { "Content-Type": "text/vtt" }); return res.end(VTT); }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(req.headers.host.includes("youtube") ? YT : PLAIN);
}).listen(8444);

const PROF = path.join(HERE, "profile-players");
fs.rmSync(PROF, { recursive: true, force: true });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${PROF}`, "--host-resolver-rules=MAP www.youtube.com 127.0.0.1:8444, MAP lectures.example.org 127.0.0.1:8444", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800", "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
const out = chrome.stdio[3], inp = chrome.stdio[4];
let buf = "", id = 0; const pending = new Map();
inp.on("data", (d) => { buf += d.toString(); let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); out.write(JSON.stringify({ id: i, method, params, sessionId }) + "\0"); });

async function trySite(label, url) {
  const { result: { targetId } } = await send("Target.createTarget", { url });
  const s = (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await send("Runtime.enable", {}, s);
  await sleep(2500);
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
  await ev("v.play(); true");
  await sleep(2500);
  await ev("v.pause(); true");
  await sleep(900);
  const bar = await ev("document.querySelector('.glossa-text')?.textContent || null");
  check(`${label}: pausing shows the selectable subtitle`, !!bar && /ambiguous/.test(bar), bar || "no bar");
  if (!bar) return;
  const pt = await ev(`(()=>{const t=document.querySelector('.glossa-text').firstChild;const i=t.data.indexOf('ambiguous');const r=document.createRange();r.setStart(t,i);r.setEnd(t,i+9);const b=r.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt[0], y: pt[1], button: "left", clickCount: 1 }, s);
  let card = null;
  for (let i = 0; i < 30 && !(card && !card.includes("Looking up")); i++) { await sleep(500); card = await ev("document.querySelector('.glossa-card')?.innerText || null"); }
  check(`${label}: clicking a word shows its meaning`, !!card && /english/i.test(card), (card || "no card").replace(/\s+/g, " ").slice(0, 120));
  check(`${label}: video stays paused`, await ev("v.paused"));
  check(`${label}: card has a Copy button`, await ev("[...document.querySelectorAll('.glossa-btn')].some(b=>b.textContent==='Copy')"));
  await ev("v.play(); true");
  await sleep(600);
  check(`${label}: playing again closes the bar`, await ev("!document.querySelector('.glossa-bar')"));
}

try {
  const load = await send("Extensions.loadUnpacked", { path: EXT });
  check("Extension loads", !load.error, load.error?.message || load.result.id);
  await sleep(1500);
  await trySite("YouTube-style player", "https://www.youtube.com/watch?v=test");
  await trySite("Built-in captions on any site", "https://lectures.example.org/talk");
} finally {
  chrome.kill(); server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
