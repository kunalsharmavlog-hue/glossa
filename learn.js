// Pause & Pick: when a video is paused, the subtitle on screen turns into text you can select.
// Click a word, or drag across a phrase or the whole line, and its meaning appears on screen.
// Works on Netflix and on any other site that plays video with subtitles (YouTube, Prime Video, Hotstar, ...).
(function () {
  if (window.__glossaPick) return; // Already running in this page.
  window.__glossaPick = true;
  // A copy left over from before an extension reload may still have its bar on screen; this copy takes over.
  document.querySelectorAll(".glossa-bar, .glossa-card").forEach((n) => n.remove());

  const POLL_MS = 250, KEEP_LAST_CUE_S = 12, SHOW_DELAY_MS = 180;
  const P = "glossa-"; // Class prefix, so that the site's styles and ours never mix.
  const IS_NETFLIX = /(^|\.)netflix\.com$/.test(location.hostname);

  // Where each player draws its subtitles. Each entry is one line or one box of lines.
  const SUB_SELECTORS = [
    ".player-timedtext-text-container",                  // Netflix
    ".ytp-caption-window-container .caption-visual-line", // YouTube
    ".atvwebplayersdk-captions-text",                     // Prime Video
    ".dss-subtitle-renderer-line",                        // Disney+, Hotstar
    ".shaka-text-container > *",                          // Shaka Player (JioCinema, many Indian sites)
    ".vjs-text-track-display .vjs-text-track-cue",        // Video.js
    ".jw-text-track-cue",                                 // JW Player
    ".plyr__caption",                                     // Plyr
    ".bmpui-ui-subtitle-label",                           // Bitmovin
    "[data-testid*='subtitle' i] span, [class*='subtitle-text' i], [class*='caption-text' i]",
  ];
  const SUB_BOXES = ".player-timedtext, .ytp-caption-window-container, .atvwebplayersdk-captions-overlay, .dss-subtitle-renderer, .shaka-text-container, .vjs-text-track-display, .jw-captions, .plyr__captions, .bmpui-ui-subtitle-overlay";

  let enabled = true, dead = false, video = null, bar = null, textEl = null, card = null, request = 0;
  let lastCue = "", lastCueAt = -1, showTimer = null;

  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const netflixId = () => (location.pathname.match(/^\/watch\/(\d+)/) || [])[1] || null;
  const onPlayerPage = () => !IS_NETFLIX || !!netflixId();

  chrome.storage.local.get("pausePick").then((r) => { enabled = r.pausePick !== false; }).catch(() => {});
  chrome.storage.onChanged.addListener((c) => {
    if (!c.pausePick) return;
    enabled = c.pausePick.newValue !== false;
    if (!enabled) close();
  });

  const css = document.createElement("style");
  css.textContent = `
    .${P}bar, .${P}card { all: initial; position: fixed; z-index: 2147483646; box-sizing: border-box;
      display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff; }
    .${P}bar { left: 50%; bottom: 13vh; transform: translateX(-50%); max-width: min(86vw, 1100px);
      padding: 14px 22px 16px; border-radius: 16px; background: rgba(14,17,23,.82);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 10px 40px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.08);
      animation: ${P}in .22s ease-out; cursor: auto; pointer-events: auto; }
    .${P}hint { display: block; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #B8F26B; margin: 0 0 6px;
      text-align: center; user-select: none; -webkit-user-select: none; }
    .${P}text { display: block; font-size: clamp(20px, 2.5vw, 42px); line-height: 1.35; font-weight: 600;
      text-align: center; white-space: pre-line; cursor: text; user-select: text !important; -webkit-user-select: text !important;
      text-shadow: 0 1px 2px rgba(0,0,0,.6); }
    .${P}text::selection { background: #2F6FED; color: #fff; text-shadow: none; }
    .${P}card { width: min(420px, 90vw); padding: 18px 20px 16px; border-radius: 16px; background: #12151B;
      box-shadow: 0 24px 70px rgba(0,0,0,.55), inset 0 0 0 1px rgba(237,232,220,.12);
      font-size: 14px; line-height: 1.45; animation: ${P}in .18s ease-out; pointer-events: auto; }
    .${P}card * { box-sizing: border-box; font-family: inherit; }
    .${P}head { display: flex; align-items: baseline; gap: 8px; margin: 0 26px 8px 0; flex-wrap: wrap; }
    .${P}word { font: 500 26px/1.15 ui-serif, "New York", Georgia, serif; color: #B8F26B; word-break: break-word; letter-spacing: -.01em; }
    .${P}pos { font-size: 13px; font-style: italic; color: #9a9aa6; }
    .${P}row { display: block; margin: 6px 0; color: #EDE8DC; }
    .${P}label { display: inline-block; min-width: 74px; color: #8a857a; font-size: 10.5px;
      text-transform: uppercase; letter-spacing: .12em; }
    .${P}hi { font-size: 17px; }
    .${P}muted { color: #9a9aa6; }
    .${P}actions { display: flex; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(237,232,220,.1); flex-wrap: wrap; }
    .${P}btn { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600;
      background: rgba(255,255,255,.08); color: #fff; }
    .${P}btn:hover { background: rgba(255,255,255,.16); }
    .${P}btn:focus-visible { outline: 2px solid #B8F26B; outline-offset: 2px; }
    .${P}btn.${P}primary { background: #B8F26B; color: #111; }
    .${P}btn.${P}primary:hover { background: #CDF78F; }
    .${P}btn[disabled] { opacity: .65; cursor: default; }
    .${P}close { all: unset; position: absolute; top: 10px; right: 12px; cursor: pointer; color: #8d8d99;
      font-size: 20px; line-height: 1; }
    .${P}close:hover { color: #fff; }
    .${P}dots::after { content: "…"; animation: ${P}blink 1s steps(4) infinite; }
    @keyframes ${P}in { from { opacity: 0; translate: 0 8px; } to { opacity: 1; translate: 0 0; } }
    @keyframes ${P}blink { 0% { opacity: .2 } 50% { opacity: 1 } 100% { opacity: .2 } }
    .${P}hide-subs :is(${SUB_BOXES}) { opacity: 0 !important; }
  `;
  document.documentElement.appendChild(css);

  const mount = () => document.fullscreenElement || document.webkitFullscreenElement || document.body;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls.split(" ").map((c) => P + c).join(" ");
    if (text != null) n.textContent = text;
    return n;
  };

  // Players pause or play on any click, so clicks inside our boxes stop here.
  function shield(node) {
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend", "keydown", "keyup", "wheel"]) {
      node.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  const visible = (n) => {
    const r = n.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(n);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const tidy = (lines) => lines.flatMap((l) => String(l).split("\n")).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  // The player's own subtitle text, or the video's text track when the site uses the browser's built-in captions.
  function readCue() {
    for (const sel of SUB_SELECTORS) {
      let nodes;
      try { nodes = [...document.querySelectorAll(sel)]; } catch { continue; }
      // With our bar open, the site's subtitles are see-through but still readable.
      nodes = nodes.filter((n) => !n.closest(`.${P}bar`) && (bar || visible(n)));
      const lines = tidy(nodes.map((n) => n.innerText || n.textContent));
      if (lines.length) return [...new Set(lines)].join("\n");
    }
    if (video && video.textTracks) {
      for (const track of video.textTracks) {
        if (track.mode === "disabled" || !/subtitles|captions/.test(track.kind) || !track.activeCues) continue;
        const lines = tidy([...track.activeCues].map((c) => (c.text || "").replace(/<[^>]+>/g, "")));
        if (lines.length) return lines.join("\n");
      }
    }
    return "";
  }

  // The main video on the page: the biggest one that is on screen.
  function mainVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      const a = Math.max(0, r.width) * Math.max(0, r.height);
      if (a > area && r.width >= 200 && r.height >= 120) { best = v; area = a; }
    }
    return best;
  }

  function show() {
    if (dead || !alive()) { retire(); return; }
    if (!enabled || bar || !video || !video.paused || video.ended || !onPlayerPage()) return;
    let text = readCue();
    if (!text && lastCue && Math.abs(video.currentTime - lastCueAt) < KEEP_LAST_CUE_S) text = lastCue;
    if (!text) return;

    bar = el("div", "bar");
    bar.append(el("span", "hint", "Glossa  ·  click a word, or drag over a phrase"));
    textEl = el("span", "text", text);
    bar.append(textEl);
    shield(bar);
    bar.addEventListener("mouseup", (e) => setTimeout(() => pick(e), 0));
    mount().appendChild(bar);
    // Keep the bar above the video: sit just over the bottom of the player when it is not full screen.
    // Sit above the player's own controls (seek bar, buttons), which take the bottom of the video.
    const r = video.getBoundingClientRect();
    const fromVideoBottom = Math.max(r.height * 0.2, 110);
    bar.style.bottom = Math.max(16, innerHeight - Math.min(r.bottom, innerHeight) + fromVideoBottom) + "px";
    document.documentElement.classList.add(P + "hide-subs");
  }

  // After Glossa is reloaded or updated, this copy can no longer reach it, so it steps aside
  // and the fresh copy that Glossa puts into the page does the work.
  function retire() {
    if (dead) return;
    dead = true;
    close();
    css.remove();
  }

  function close() {
    clearTimeout(showTimer);
    request++;
    if (card) { card.remove(); card = null; }
    if (bar) { bar.remove(); bar = null; textEl = null; }
    document.documentElement.classList.remove(P + "hide-subs");
  }

  // A plain click selects the whole word under the pointer.
  function wordAt(x, y) {
    const range = document.caretRangeFromPoint?.(x, y);
    if (!range || !textEl.contains(range.startContainer) || range.startContainer.nodeType !== 3) return null;
    const s = range.startContainer.data, isLetter = (c) => /[\p{L}\p{N}'’-]/u.test(c || "");
    let a = range.startOffset, b = range.startOffset;
    while (a > 0 && isLetter(s[a - 1])) a--;
    while (b < s.length && isLetter(s[b])) b++;
    if (a === b) return null;
    range.setStart(range.startContainer, a);
    range.setEnd(range.startContainer, b);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }

  function pick(e) {
    if (!textEl) return;
    const sel = getSelection();
    let range = sel.rangeCount && textEl.contains(sel.anchorNode) && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    if (!range && textEl.contains(e.target)) range = wordAt(e.clientX, e.clientY);
    if (!range) return;
    const text = range.toString().replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").slice(0, 240);
    if (!/\p{L}/u.test(text)) return;
    explain(text, range.getBoundingClientRect());
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      // Some players block the clipboard API; a hidden field still copies.
      const t = document.createElement("textarea");
      t.value = text; t.style.cssText = "position:fixed;opacity:0;left:-9999px";
      mount().appendChild(t); t.select();
      const ok = document.execCommand("copy"); t.remove();
      return ok;
    }
  }

  // Cmd/Ctrl+C on the picked text copies it, even on players that swallow keyboard shortcuts.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && card) { card.remove(); card = null; return; }
    if (!textEl || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "c") return;
    const sel = getSelection();
    if (!sel.rangeCount || !textEl.contains(sel.anchorNode) || sel.isCollapsed) return;
    e.stopImmediatePropagation(); e.preventDefault();
    copy(sel.toString());
  }, true);

  function placeCard(rect) {
    const w = card.offsetWidth, h = card.offsetHeight, barTop = bar ? bar.getBoundingClientRect().top : rect.top;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), innerWidth - w - 12);
    card.style.left = left + "px";
    card.style.top = Math.max(12, barTop - h - 14) + "px";
  }

  function row(label, value, cls) {
    const r = el("div", "row");
    r.append(el("span", "label", label), el("span", cls || "", value));
    return r;
  }

  async function ask(msg) {
    if (!alive()) return { stale: true };
    try { return await chrome.runtime.sendMessage(msg); }
    catch { return { stale: true }; }
  }

  async function explain(text, rect) {
    const id = ++request;
    if (card) card.remove();
    card = el("div", "card");
    shield(card);
    const x = el("button", "close", "×");
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", () => { card.remove(); card = null; });
    const head = el("div", "head");
    head.append(el("span", "word", text));
    card.append(x, head, el("div", "row muted dots", "Looking up"));
    mount().appendChild(card);
    placeCard(rect);

    const res = await ask({ type: "explain", text });
    if (id !== request || !card) return;

    card.replaceChildren(x, head);
    const actions = el("div", "actions");
    const copyBtn = el("button", "btn", "Copy");
    copyBtn.addEventListener("click", async () => { copyBtn.textContent = (await copy(res && res.text || text)) ? "✓ Copied" : "Could not copy"; });

    // No answer at all means the background is an older copy that does not know this request.
    if (!res || res.stale || (res.ok === undefined && !res.error)) {
      card.append(el("div", "row muted", "Glossa was updated. Open chrome://extensions, press Reload on Glossa, then refresh this page."));
      actions.append(copyBtn);
      card.append(actions);
      placeCard(rect);
      return;
    }
    if (!res.ok) {
      card.append(el("div", "row muted", res.error || "Could not look this up. Check your internet connection."));
      actions.append(copyBtn);
      card.append(actions);
      placeCard(rect);
      return;
    }
    if (res.text) head.firstChild.textContent = res.text;
    if (res.pos) head.append(el("span", "pos", res.pos));
    if (res.english) card.append(row("English", res.english));
    if (res.hindi) card.append(row("Hindi", res.hindi, "hi"));
    if (res.hinglish) card.append(row("Hinglish", res.hinglish));
    if (res.similar && res.similar.length) card.append(row("Similar", res.similar.join(", ")));
    for (const part of res.parts || []) card.append(row(part.word, part.english));
    if (!res.english && !res.hindi && !(res.parts || []).length) card.append(el("div", "row muted", "No meaning found. It may be a name or slang."));

    const listen = el("button", "btn", "🔊 Listen");
    listen.addEventListener("click", () => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(res.text || text);
      u.lang = "en-US";
      u.rate = 0.9;
      speechSynthesis.speak(u);
    });
    actions.append(listen, copyBtn);
    // Saved words go into that film's PDF, which Glossa makes for Netflix.
    if (IS_NETFLIX && netflixId()) {
      const save = el("button", "btn primary", "★ Save to PDF");
      save.addEventListener("click", async () => {
        save.disabled = true;
        const ok = await ask({
          type: "pick", id: netflixId(), text: res.text || text,
          context: textEl ? textEl.textContent.replace(/\s+/g, " ") : "",
          t: Math.round(video ? video.currentTime : 0), result: res,
        });
        save.textContent = ok && ok.ok ? "✓ Saved" : "Could not save";
      });
      actions.append(save);
    }
    card.append(actions);
    placeCard(rect);
  }

  function attach(v) {
    video = v;
    v.addEventListener("pause", () => { clearTimeout(showTimer); showTimer = setTimeout(show, SHOW_DELAY_MS); });
    v.addEventListener("play", close);
    v.addEventListener("seeking", close);
    // Scrubbing while paused: show the line at the new spot once the player has drawn it.
    v.addEventListener("seeked", () => { if (v.paused) { clearTimeout(showTimer); showTimer = setTimeout(show, 500); } });
  }

  document.addEventListener("fullscreenchange", () => {
    for (const n of [bar, card]) if (n) mount().appendChild(n);
  });

  const timer = setInterval(() => {
    if (!alive()) { clearInterval(timer); retire(); return; }
    if (!onPlayerPage()) { close(); return; }
    const v = mainVideo();
    if (v && v !== video) { close(); attach(v); }
    if (video && !video.paused) {
      const cue = readCue();
      if (cue) { lastCue = cue; lastCueAt = video.currentTime; }
    }
  }, POLL_MS);
})();
