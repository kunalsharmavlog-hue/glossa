// Pause & Pick: when the movie is paused, the subtitle on screen turns into text you can select.
// Click a word, or drag across a phrase or the whole line, and its meaning appears on screen.
(function () {
  if (window.__glossaPick) return; // Already running after an extension reload.
  window.__glossaPick = true;

  const POLL_MS = 250, KEEP_LAST_CUE_S = 12, SHOW_DELAY_MS = 180;
  const P = "glossa-"; // Class prefix, so that Netflix's styles and ours never mix.

  let enabled = true, video = null, bar = null, textEl = null, card = null, request = 0;
  let lastCue = "", lastCueAt = -1, showTimer = null;

  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const onWatchPage = () => /^\/watch\/\d+/.test(location.pathname);
  const watchId = () => (location.pathname.match(/^\/watch\/(\d+)/) || [])[1] || null;

  chrome.storage.local.get("pausePick").then((r) => { enabled = r.pausePick !== false; });
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
      text-align: center; white-space: pre-line; cursor: text; user-select: text; -webkit-user-select: text;
      text-shadow: 0 1px 2px rgba(0,0,0,.6); }
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
    .${P}actions { display: flex; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(237,232,220,.1); }
    .${P}btn { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600;
      background: rgba(255,255,255,.08); color: #fff; }
    .${P}btn:hover { background: rgba(255,255,255,.16); }
    .${P}btn.${P}primary { background: #B8F26B; color: #111; }
    .${P}btn.${P}primary:hover { background: #CDF78F; }
    .${P}btn[disabled] { opacity: .65; cursor: default; }
    .${P}close { all: unset; position: absolute; top: 10px; right: 12px; cursor: pointer; color: #8d8d99;
      font-size: 20px; line-height: 1; }
    .${P}close:hover { color: #fff; }
    .${P}dots::after { content: "…"; animation: ${P}blink 1s steps(4) infinite; }
    @keyframes ${P}in { from { opacity: 0; translate: 0 8px; } to { opacity: 1; translate: 0 0; } }
    @keyframes ${P}blink { 0% { opacity: .2 } 50% { opacity: 1 } 100% { opacity: .2 } }
    .${P}hide-subs .player-timedtext { opacity: 0 !important; }
  `;
  document.documentElement.appendChild(css);

  const mount = () => document.fullscreenElement || document.body;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls.split(" ").map((c) => P + c).join(" ");
    if (text != null) n.textContent = text;
    return n;
  };

  // Netflix pauses or plays on any click in the player, so clicks inside our boxes stop here.
  function shield(node) {
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend"]) {
      node.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  function readCue() {
    const boxes = document.querySelectorAll(".player-timedtext-text-container, .player-timedtext [class*=\"text-container\"]");
    return [...boxes].map((b) => b.innerText || b.textContent).join("\n")
      .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  }

  function show() {
    if (!enabled || bar || !video || !video.paused || !onWatchPage()) return;
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
    document.documentElement.classList.add(P + "hide-subs");
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

  function placeCard(rect) {
    const w = card.offsetWidth, h = card.offsetHeight, barTop = bar.getBoundingClientRect().top;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), innerWidth - w - 12);
    card.style.left = left + "px";
    card.style.top = Math.max(12, barTop - h - 14) + "px";
  }

  function row(label, value, cls) {
    const r = el("div", "row");
    r.append(el("span", "label", label), el("span", cls || "", value));
    return r;
  }

  async function explain(text, rect) {
    const id = ++request;
    if (card) card.remove();
    card = el("div", "card");
    shield(card);
    const x = el("button", "close", "×");
    x.title = "Close";
    x.addEventListener("click", () => { card.remove(); card = null; });
    const head = el("div", "head");
    head.append(el("span", "word", text));
    card.append(x, head, el("div", "row muted dots", "Looking up"));
    mount().appendChild(card);
    placeCard(rect);

    let res;
    try { res = await chrome.runtime.sendMessage({ type: "explain", text }); }
    catch { res = { ok: false, error: "Glossa was updated. Refresh this page to use it again." }; }
    if (id !== request || !card) return;

    card.replaceChildren(x, head);
    if (!res || !res.ok) {
      card.append(el("div", "row muted", (res && res.error) || "Could not look this up. Check your internet connection."));
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

    const actions = el("div", "actions");
    const listen = el("button", "btn", "🔊 Listen");
    listen.addEventListener("click", () => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(res.text || text);
      u.lang = "en-US";
      u.rate = 0.9;
      speechSynthesis.speak(u);
    });
    const save = el("button", "btn primary", "★ Save to PDF");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await chrome.runtime.sendMessage({
          type: "pick", id: watchId(), text: res.text || text,
          context: textEl ? textEl.textContent.replace(/\s+/g, " ") : "",
          t: Math.round(video ? video.currentTime : 0), result: res,
        });
        save.textContent = "✓ Saved";
      } catch {
        save.textContent = "Could not save";
      }
    });
    actions.append(listen, save);
    card.append(actions);
    placeCard(rect);
  }

  function attach(v) {
    video = v;
    v.addEventListener("pause", () => { clearTimeout(showTimer); showTimer = setTimeout(show, SHOW_DELAY_MS); });
    v.addEventListener("play", close);
    v.addEventListener("seeking", close);
    // Scrubbing while paused: show the line at the new spot once Netflix has drawn it.
    v.addEventListener("seeked", () => { if (v.paused) { clearTimeout(showTimer); showTimer = setTimeout(show, 500); } });
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && card) { card.remove(); card = null; } }, true);
  document.addEventListener("fullscreenchange", () => {
    for (const n of [bar, card]) if (n) mount().appendChild(n);
  });

  const timer = setInterval(() => {
    if (!alive()) { clearInterval(timer); close(); return; }
    if (!onWatchPage()) { close(); return; }
    const v = document.querySelector("video");
    if (v && v !== video) { close(); attach(v); }
    if (video && !video.paused) {
      const cue = readCue();
      if (cue) { lastCue = cue; lastCueAt = video.currentTime; }
    }
  }, POLL_MS);
})();
