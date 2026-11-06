// Runs on Netflix and quietly records each subtitle line while a movie plays.
(function () {
  const POLL_MS = 300, SAVE_MS = 10000, NO_SUBS_WARNING_S = 180;
  const END_AT = 0.97, FINISHED_AT = 0.85, MIN_MOVIE_S = 300;
  const titleFromTab = () => {
    const name = (document.title.match(/^(.+) - Netflix$/) || [])[1];
    return name && !/^(Home|Shows|Movies|Games|New & Popular|My Netflix|My List|Browse.*)$/i.test(name) ? name : "";
  };

  let session = null, loadingId = null, dirty = false;
  let lastCue = "", playedWithoutSubs = 0, lastTick = Date.now();
  let hiddenByUs = false, showSubs = false, warned = {}, endSent = false;
  let titleRank = 0;

  const watchId = () => (location.pathname.match(/^\/watch\/(\d+)/) || [])[1] || null;
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  const style = document.createElement("style");
  document.documentElement.appendChild(style);
  function applySubtitleVisibility() {
    style.textContent = hiddenByUs && !showSubs ? ".player-timedtext{opacity:0!important}" : "";
  }

  chrome.storage.local.get("showSubs").then((r) => { showSubs = !!r.showSubs; applySubtitleVisibility(); });
  chrome.storage.onChanged.addListener((c) => {
    if (c.showSubs) { showSubs = !!c.showSubs.newValue; applySubtitleVisibility(); }
  });

  function toast(text) {
    const box = document.createElement("div");
    box.textContent = text;
    box.style.cssText = "position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(0,0,0,.85);color:#fff;font:15px/1.4 -apple-system,sans-serif;padding:10px 16px;border-radius:8px;max-width:520px;text-align:center;pointer-events:none";
    (document.fullscreenElement || document.body).appendChild(box);
    setTimeout(() => box.remove(), 8000);
  }

  function warnOnce(key, text) {
    if (warned[key]) return;
    warned[key] = true;
    toast(text);
  }

  async function save() {
    if (!dirty || !session || !alive()) return;
    dirty = false;
    session.updatedAt = Date.now();
    await chrome.storage.local.set({ [`s:${session.id}`]: session });
  }

  async function openSession(id) {
    if (loadingId === id) return;
    loadingId = id;
    await save();
    const key = `s:${id}`;
    const stored = (await chrome.storage.local.get(key))[key];
    session = stored || { id, title: "", lines: [], position: 0, duration: 0, updatedAt: Date.now() };
    titleRank = session.title ? (session.titleRank || 1) : 0;
    lastCue = ""; playedWithoutSubs = 0; warned = {}; endSent = false;
    hiddenByUs = false;
    applySubtitleVisibility();
    // Opened from a movie's page: exact match, or the page seen just before pressing play (episodes).
    const { lastPageTitle: seen } = await chrome.storage.local.get("lastPageTitle");
    if (seen && (seen.id === id || Date.now() - seen.at < 10 * 60 * 1000)) setTitle(seen.name, 1);
    session.maxPosition = session.maxPosition || 0;
    chrome.runtime.sendMessage({ type: "watching", id }).catch(() => {});
  }

  function setTitle(title, rank) {
    title = String(title || "").replace(/\s+/g, " ").trim();
    if (!title || !session || rank <= titleRank) return;
    titleRank = rank;
    session.title = title;
    session.titleRank = rank;
    dirty = true;
  }

  function readSubtitle() {
    const boxes = document.querySelectorAll(".player-timedtext-text-container");
    if (!boxes.length) return "";
    return [...boxes].map((b) => b.innerText || b.textContent).join(" ").replace(/\s+/g, " ").trim();
  }

  // The tab title is "Steve - Netflix" on a movie's own page, so remember it for when it plays.
  let lastPageTitle = "";
  function rememberPageTitle() {
    const pageId = (location.pathname.match(/^\/title\/(\d+)/) || [])[1] || new URLSearchParams(location.search).get("jbv");
    const name = titleFromTab();
    if (!pageId || !name || lastPageTitle === pageId + name) return;
    lastPageTitle = pageId + name;
    chrome.storage.local.set({ lastPageTitle: { id: pageId, name, at: Date.now() } });
  }

  function readTitleFromPlayer() {
    const el = document.querySelector('[data-uia="video-title"]');
    if (!el) return;
    const parts = [...el.children].map((c) => c.textContent.trim()).filter(Boolean);
    setTitle(parts.length ? parts.join(" - ") : el.textContent, 2);
  }

  function tick() {
    if (!alive()) { clearInterval(timer); clearInterval(saver); return; }
    rememberPageTitle();
    const id = watchId();
    if (!id) {
      if (session) { save(); session = null; loadingId = null; hiddenByUs = false; applySubtitleVisibility(); }
      return;
    }
    if (!session || session.id !== id) { openSession(id); return; }

    const now = Date.now(), delta = (now - lastTick) / 1000;
    lastTick = now;
    const video = document.querySelector("video");
    const length = video ? video.duration : NaN;
    if (Number.isFinite(length) && length > session.duration) session.duration = length;

    // After the credits Netflix keeps the same page but plays a promo for another title.
    // Anything much shorter than the movie (promo, ad) is not the movie.
    const isMovie = Number.isFinite(length) && length >= session.duration * 0.9;
    if (!isMovie) {
      const wasNearEnd = session.duration >= MIN_MOVIE_S && (session.maxPosition || 0) / session.duration >= FINISHED_AT;
      if (!endSent && wasNearEnd) finish();
      return;
    }

    if (session.position !== video.currentTime) {
      session.position = video.currentTime;
      session.maxPosition = Math.max(session.maxPosition || 0, video.currentTime);
      dirty = true;
    }

    const cue = readSubtitle();
    if (cue && cue !== lastCue) {
      session.lines.push({ t: Math.round(video.currentTime), text: cue });
      dirty = true;
      playedWithoutSubs = 0;
    }
    if (cue) lastCue = cue;
    else if (!video.paused) playedWithoutSubs += delta;

    if (playedWithoutSubs > NO_SUBS_WARNING_S && !session.lines.length) {
      warnOnce("nosubs", "Glossa: no subtitles found. Please turn on English subtitles in the player.");
    }

    readTitleFromPlayer();
    if (titleFromTab()) setTitle(titleFromTab(), 2);

    if (!endSent && session.duration >= MIN_MOVIE_S && video.currentTime / session.duration >= END_AT) finish();
  }

  async function finish() {
    endSent = true;
    dirty = true;
    await save();
    if (alive() && session) chrome.runtime.sendMessage({ type: "finished", id: session.id }).catch(() => {});
  }

  document.addEventListener("ended", (e) => {
    if (e.target.tagName !== "VIDEO" || !session || !session.duration) return;
    finish(); // The background script checks that most of the movie was really watched.
  }, true); // "ended" does not bubble, so this listens in the capture phase.

  window.addEventListener("pagehide", () => { dirty = true; save(); });

  // Messages from page-bridge.js, which can read Netflix's own player.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "netflix-vocab" || !session) return;
    const { title, movieId, subtitleState } = e.data;
    if (String(movieId) !== session.id) return;
    if (title) setTitle(title, 3);
    if (subtitleState === "enabled-by-extension") {
      hiddenByUs = true;
      applySubtitleVisibility();
    } else if (subtitleState === "other-language") {
      hiddenByUs = false;
      applySubtitleVisibility();
      warnOnce("lang", "Glossa: words are collected only from English subtitles. Subtitles in another language are on.");
    } else if (subtitleState === "no-english") {
      warnOnce("noeng", "Glossa: this movie has no English subtitles with the current audio.");
    }
  });

  const timer = setInterval(tick, POLL_MS);
  const saver = setInterval(save, SAVE_MS);
})();
