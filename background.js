// Decides when a movie is finished, looks up meanings and saves the PDF.
importScripts("common-words.js", "vocab.js", "pdf.js", "hinglish.js");

const LOOKUP_GAP_MS = 1200;
const RESUME_ALARM = "resume-pdf";

const FINISHED_AT = 0.85;   // Leaving after this much of the movie counts as finished.
const MIN_LINES = 5;
const REBUILD_AFTER_LINES = 10;
const building = new Set();

const sessionKey = (id) => `s:${id}`;
const watchIdFrom = (url) => (String(url).match(/netflix\.com\/watch\/(\d+)/) || [])[1] || null;

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const NAME_SENSE = /\b(given name|surname|placename|place name|family name|city in|town in|county|unit of)\b/i;
// "plural of betray" says nothing useful; the dictionary form is looked up instead.
const FORM_OF = /^(\(?obsolete|\(?archaic|third-person|plural of|simple past|past participle|present participle|past tense|alternative (form|spelling)|misspelling|inflection|comparative|superlative)/i;

function pickSenses(groups) {
  // One sense per part of speech, at most two, so that each entry stays short.
  const defs = [];
  const parts = [];
  for (const g of groups) {
    const def = g.defs.find((d) => d && !NAME_SENSE.test(d) && !FORM_OF.test(d));
    if (!def) continue;
    defs.push(def);
    if (g.pos) parts.push(g.pos.toLowerCase());
    if (defs.length === 2) break;
  }
  return defs.length ? { pos: [...new Set(parts)].join(", "), defs } : null;
}

async function fromDictionaryApi(word) {
  const data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!Array.isArray(data)) return null;
  const groups = data.flatMap((entry) => entry.meanings || []).map((m) => ({
    pos: m.partOfSpeech,
    defs: (m.definitions || []).map((d) => d.definition),
  }));
  return pickSenses(groups);
}

async function fromWiktionary(word) {
  const data = await fetchJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  if (!data || !Array.isArray(data.en)) return null;
  const strip = (html) => String(html).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  const groups = data.en.map((g) => ({
    pos: g.partOfSpeech,
    defs: (g.definitions || []).map((d) => strip(d.definition)),
  }));
  return pickSenses(groups);
}

// Simple English Wiktionary is written for learners, so it is tried first.
async function fromSimpleWiktionary(word) {
  const data = await fetchJson(`https://simple.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(word)}`);
  const page = data && data.query && Object.values(data.query.pages)[0];
  if (!page || !page.extract) return null;
  let pos = "", skip = true;
  for (const raw of page.extract.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^=+\s*(.+?)\s*=+$/);
    if (heading) {
      const h = heading[1].toLowerCase();
      skip = !/^(noun|verb|adjective|adverb|interjection|preposition|pronoun)\b/.test(h);
      if (!skip) pos = h.split(" ")[0];
      continue;
    }
    if (skip || !line) continue;
    const def = line.replace(/^\((transitive|intransitive|countable|uncountable|informal|formal)[^)]*\)\s*/i, "").trim();
    // "The past tense of complicate" explains nothing, so the fuller dictionaries answer instead.
    if (/past tense|past participle|present participle|plural (form )?of|third.person/i.test(def)) return null;
    const plain = def.replace(/\s*(Synonyms?|Antonyms?):.*$/i, "").trim(); // "...inexperienced Antonym: experienced"
    if (plain.length > 3) return { pos, def: plain };
  }
  return null;
}

const firstClause = (def) => def.split(/;\s/)[0].replace(/[.;,\s]+$/, "");

function looksLikeSpelling(hindiRoman, word) {
  const skeleton = (s) => s.toLowerCase().replace(/ph/g, "f").replace(/ck|c|q/g, "k").replace(/[aeiouy]/g, "");
  return skeleton(hindiRoman) === skeleton(word);
}

// Returns undefined if the service could not be reached, and null if it has no usable meaning.
// maxWords is 4 for one word; phrases and whole lines picked on screen allow longer answers.
async function hindiFor(word, maxWords = 4) {
  const data = await fetchJson(`https://api.mymemory.translated.net/get?langpair=en|hi&q=${encodeURIComponent(word)}`);
  if (!data || !data.responseData) return undefined;
  // The top result is sometimes a whole unrelated sentence, so only short, Hindi-only answers count.
  const allowed = maxWords > 4 ? /^[ऀ-ॿ\s\-,?!'"।.]+$/ : /^[ऀ-ॿ\s-]+$/;
  const answers = [data.responseData.translatedText, ...(data.matches || []).map((m) => m.translation)]
    .map((t) => String(t || "").replace(/[।.!?,]+$/, "").trim())
    .filter((t) => t && /[ऀ-ॿ]/.test(t) && allowed.test(t) && t.split(/\s+/).length <= maxWords)
    .filter((t) => maxWords > 4 || !looksLikeSpelling(Hinglish.romanize(t), word));
  return answers.length ? { hindi: answers[0], hinglish: Hinglish.romanize(answers[0]) } : null;
}

async function similarWords(word) {
  const data = await fetchJson(`https://api.datamuse.com/words?max=15&ml=${encodeURIComponent(word)}`);
  if (!Array.isArray(data)) return [];
  const common = Object.values(self.COMMON_WORDS).join(" ").split(" ");
  const known = new Set(common);
  const stem = word.slice(0, 5);
  return data.map((d) => d.word).filter((w) => known.has(w) && !w.startsWith(stem)).slice(0, 3);
}

// The English meaning of a word or an idiom such as "give up", trying the dictionary form too.
async function englishFor(text, forms = [text]) {
  for (const form of forms) {
    const simple = await fromSimpleWiktionary(form);
    if (simple) return { english: simple.def, pos: simple.pos };
    const full = (await fromDictionaryApi(form)) || (await fromWiktionary(form));
    if (full) return { english: firstClause(full.defs[0]), pos: full.pos.split(",")[0] };
  }
  return null;
}

async function lookUp(word) {
  const found = await englishFor(word, [word, ...Vocab.baseForms(word)]);
  if (!found) return null;
  const { english, pos } = found;
  const answer = await hindiFor(word);
  return {
    pos,
    english,
    answered: answer !== undefined,
    hindi: answer ? answer.hindi : "",
    hinglish: answer ? answer.hinglish : "",
    similar: await similarWords(word),
  };
}

async function lookUpAll(words) {
  const { meaningsV2: cache = {} } = await chrome.storage.local.get("meaningsV2");
  // Words with no meaning anywhere are skipped for the rest of this browser session.
  const { triedWords = [] } = await chrome.storage.session.get("triedWords");
  const tried = new Set(triedWords);
  const results = { ...cache };
  const queue = words.filter((w) => !(w in cache) && !tried.has(w));
  for (const w of queue) {
    const result = await lookUp(w);
    if (result) {
      results[w] = result;
      // Kept for next time only if Hindi was answered, so that a failed attempt can retry.
      if (result.answered) cache[w] = result;
    } else {
      tried.add(w);
    }
    // Saved after every word: if Chrome stops this script, the next run continues from here.
    await chrome.storage.local.set({ meaningsV2: cache });
    await chrome.storage.session.set({ triedWords: [...tried] });
    await new Promise((r) => setTimeout(r, LOOKUP_GAP_MS)); // These free services limit fast requests.
  }
  return results;
}

// Pause & Pick: the meaning of whatever was selected in the paused subtitle.
const pickCache = new Map();

async function cachedWord(word) {
  const { meaningsV2: cache = {} } = await chrome.storage.local.get("meaningsV2");
  if (cache[word]) return cache[word];
  const result = await lookUp(word);
  if (result && result.answered) {
    const fresh = (await chrome.storage.local.get("meaningsV2")).meaningsV2 || {};
    fresh[word] = result;
    await chrome.storage.local.set({ meaningsV2: fresh });
  }
  return result;
}

async function explain(raw) {
  const text = String(raw).replace(/[“”]/g, '"').replace(/’/g, "'").replace(/\s+/g, " ").trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").slice(0, 240);
  const words = text.match(/\p{L}+(?:'\p{L}+)*/gu) || [];
  if (!words.length) return { ok: false, error: "Select a word or a phrase." };

  if (words.length === 1) {
    const word = words[0].toLowerCase().replace(/'(s|re|ve|ll|d|m)$/, "");
    const r = await cachedWord(word);
    if (!r) return { ok: false, error: `No meaning found for "${word}". It may be a name or slang.` };
    return { ok: true, kind: "word", text: word, pos: r.pos, english: r.english, hindi: r.hindi, hinglish: r.hinglish, similar: r.similar || [] };
  }

  const phrase = text.toLowerCase();
  if (pickCache.has(phrase)) return pickCache.get(phrase);
  const short = words.length <= 5; // Idioms such as "piece of cake" have their own dictionary entry.
  const [idiom, hindi] = await Promise.all([
    short ? englishFor(phrase) : null,
    hindiFor(phrase, Math.max(8, words.length * 3)),
  ]);
  // The hard words inside the phrase get a short English meaning of their own.
  const parts = [];
  for (const h of Vocab.extractHardWords([{ t: 0, text }], self.COMMON_WORDS, "all").slice(0, 3)) {
    const r = await cachedWord(h.word);
    if (r) parts.push({ word: h.word, english: r.english });
  }
  if (!idiom && !hindi && !parts.length) {
    return { ok: false, error: hindi === undefined ? "Could not reach the dictionary. Check your internet connection." : "No meaning found for this phrase." };
  }
  const result = {
    ok: true, kind: short ? "phrase" : "sentence", text,
    pos: idiom ? (idiom.pos || "phrase") : "", english: idiom ? idiom.english : "",
    hindi: hindi ? hindi.hindi : "", hinglish: hindi ? hindi.hinglish : "", parts,
  };
  pickCache.set(phrase, result);
  return result;
}

// Words saved from the card go to the top of that movie's PDF.
async function savePick({ id, text, context, t, result }) {
  if (!id || !text) return { ok: false };
  const key = `picks:${id}`;
  const picks = (await chrome.storage.local.get(key))[key] || [];
  const at = picks.findIndex((p) => p.text.toLowerCase() === text.toLowerCase());
  const pick = { text, context: String(context || "").slice(0, 400), t: t || 0, result };
  if (at >= 0) picks[at] = pick; else picks.push(pick);
  await chrome.storage.local.set({ [key]: picks });
  return { ok: true, count: picks.length };
}

// Unfinished PDFs are written down, so they survive Chrome stopping this script or being closed.
async function getPending() {
  return (await chrome.storage.local.get("pendingPdfs")).pendingPdfs || [];
}

async function addPending(id) {
  const pending = await getPending();
  if (!pending.includes(id)) await chrome.storage.local.set({ pendingPdfs: [...pending, id] });
  chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 1 });
}

async function removePending(id) {
  const pending = (await getPending()).filter((p) => p !== id);
  await chrome.storage.local.set({ pendingPdfs: pending });
  if (!pending.length) chrome.alarms.clear(RESUME_ALARM);
}

async function resumePending() {
  if (building.size) return;
  const [next] = await getPending();
  if (next) await buildPdf(next);
}

// Finds movies that were finished while no PDF could be made, such as before an update.
async function catchUp() {
  const all = await chrome.storage.local.get(null);
  for (const key of Object.keys(all)) {
    if (!key.startsWith("s:")) continue;
    const s = all[key];
    if (s.lines.length >= MIN_LINES && s.duration && (s.maxPosition || 0) / s.duration >= FINISHED_AT && !all[`built:${s.id}`]) {
      await addPending(s.id);
    }
  }
  await resumePending();
}

async function buildPdf(id) {
  if (building.has(id)) return { ok: false, error: "PDF is already being created" };
  await addPending(id);
  if (building.size) return { ok: false, error: "Waiting for another PDF to finish" };
  building.add(id);
  // Chrome stops an idle background script after 30 seconds; regular API calls prevent that.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  chrome.action.setBadgeBackgroundColor({ color: "#141311" });
  chrome.action.setBadgeText({ text: "..." });
  try {
    const key = sessionKey(id);
    const s = (await chrome.storage.local.get(key))[key];
    if (!s || !s.lines.length) return { ok: false, error: "No subtitles collected for this movie yet" };

    const { level = "all" } = await chrome.storage.local.get("level");
    const hard = Vocab.extractHardWords(s.lines, self.COMMON_WORDS, level);
    const defs = await lookUpAll(hard.map((h) => h.word));

    const entries = [], unknown = [];
    const { [`picks:${id}`]: picks = [] } = await chrome.storage.local.get(`picks:${id}`);
    const picked = new Set();
    for (const p of [...picks].sort((a, b) => a.t - b.t)) {
      const r = p.result || {};
      const defs = [];
      if (r.english) defs.push(`English: ${r.english}`);
      if (r.hinglish) defs.push(`Hinglish: ${r.hinglish}`);
      for (const part of r.parts || []) defs.push(`${part.word}: ${part.english}`);
      if (r.similar && r.similar.length) defs.push(`Similar: ${r.similar.join(", ")}`);
      if (!defs.length) continue;
      // A long Hindi sentence would run off the page as one picture, so Hinglish carries it instead.
      const hindiImage = r.hindi && r.hindi.length <= 40 ? await VocabPdf.renderHindiImage(r.hindi) : null;
      const pos = ["your pick", r.pos].filter(Boolean).join(", ");
      entries.push({ word: p.text, pos, hindiImage, defs, example: p.context, time: Vocab.formatTime(p.t) });
      picked.add(p.text.toLowerCase());
    }
    const pickedCount = entries.length;
    for (const h of hard) {
      if (picked.has(h.word)) continue;
      const d = defs[h.word];
      if (d) {
        const defs = [`English: ${d.english}`];
        if (d.hinglish) defs.push(`Hinglish: ${d.hinglish}`);
        if (d.similar && d.similar.length) defs.push(`Similar: ${d.similar.join(", ")}`);
        const hindiImage = d.hindi ? await VocabPdf.renderHindiImage(d.hindi) : null;
        entries.push({ word: h.word, pos: d.pos, hindiImage, defs, example: h.example, time: Vocab.formatTime(h.t) });
      }
      else unknown.push(h.word);
    }

    const { [`name:${id}`]: customName } = await chrome.storage.local.get(`name:${id}`);
    const title = customName || s.title || `Netflix Movie ${id}`;
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const pdf = VocabPdf.buildVocabPdf({
      title,
      subtitle: `Vocabulary: ${entries.length} words` + (pickedCount ? ` (${pickedCount} picked by you)` : "") + `  |  ${date}`,
      entries,
      unknown,
    });

    const safeName = title.replace(/[\\/:*?"<>|~\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 80) || "Movie";
    const downloadId = await chrome.downloads.download({
      url: "data:application/pdf;base64," + btoa(pdf),
      filename: `Glossa/${safeName} - Vocabulary.pdf`,
      conflictAction: "uniquify",
      saveAs: false,
    });

    // Kept apart from the session, which the open Netflix tab keeps overwriting.
    await chrome.storage.local.set({ [`built:${id}`]: { lines: s.lines.length, at: Date.now(), words: entries.length } });
    chrome.action.setBadgeText({ text: "✓" });
    return { ok: true, words: entries.length, downloadId };
  } catch (err) {
    console.error("PDF build failed", err);
    chrome.action.setBadgeText({ text: "!" });
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    clearInterval(keepAlive);
    building.delete(id);
    await removePending(id);
    resumePending();
  }
}

// Called automatically: builds only when most of the movie has been watched.
async function finishIfWatched(id) {
  const key = sessionKey(id);
  const s = (await chrome.storage.local.get(key))[key];
  if (!s || s.lines.length < MIN_LINES || !s.duration) return;
  if ((s.maxPosition || 0) / s.duration < FINISHED_AT) return;
  const { [`built:${id}`]: built } = await chrome.storage.local.get(`built:${id}`);
  if (built && s.lines.length - built.lines < REBUILD_AFTER_LINES) return;
  await buildPdf(id);
}

async function tabMap() {
  return (await chrome.storage.session.get("tabs")).tabs || {};
}

// Reloading or updating the extension cuts off Netflix tabs that are already open,
// so capture is restarted in them without needing a page refresh.
chrome.runtime.onInstalled.addListener(async () => {
  const open = await chrome.tabs.query({ url: "https://www.netflix.com/*" });
  for (const tab of open) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => {});
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page-bridge.js"], world: "MAIN" }).catch(() => {});
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["learn.js"] }).catch(() => {});
  }
  await chrome.storage.local.remove(["defs", "meanings"]); // Left over from older versions.
  await catchUp();
});

chrome.runtime.onStartup.addListener(catchUp);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESUME_ALARM) resumePending();
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "watching" && sender.tab) {
    // A visible sign on the toolbar icon that this tab is being recorded.
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#1a7f37" });
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "REC" });
    tabMap().then((tabs) => {
      tabs[sender.tab.id] = msg.id;
      chrome.storage.session.set({ tabs });
    });
  } else if (msg.type === "finished") {
    finishIfWatched(msg.id);
  } else if (msg.type === "explain") {
    explain(msg.text).then(reply, () => reply({ ok: false, error: "Something went wrong. Try again." }));
    return true;
  } else if (msg.type === "pick") {
    savePick(msg).then(reply);
    return true;
  } else if (msg.type === "build") {
    buildPdf(msg.id).then(reply);
    return true; // The reply is sent after the PDF is ready.
  }
});

// Leaving the movie page, or starting a different title in the same tab.
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url) return;
  const tabs = await tabMap();
  const id = tabs[tabId];
  if (id && watchIdFrom(change.url) !== id) {
    chrome.action.setBadgeText({ tabId, text: "" });
    delete tabs[tabId];
    await chrome.storage.session.set({ tabs });
    await finishIfWatched(id);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabs = await tabMap();
  const id = tabs[tabId];
  if (id) {
    delete tabs[tabId];
    await chrome.storage.session.set({ tabs });
    await finishIfWatched(id);
  }
});
