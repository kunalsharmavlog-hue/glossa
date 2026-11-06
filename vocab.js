// Turns subtitle lines into a list of hard words. No browser APIs, so it can be tested in Node.
(function (root) {
  const THRESHOLD_BANDS = { all: ["a"], medium: ["a", "b"], hardest: ["a", "b", "c"] };

  // Sounds and filler that subtitles spell out but nobody needs a meaning for.
  const FILLER = new Set(
    "hmm hmmm mmm mhm uh uhh um umm huh ah ahh aah oh ooh ohh eh ehh er erm shh shhh psst whoa wow yay ugh argh ow ouch haha hahaha heh hey yeah yep nope nah".split(" ")
  );

  function buildBandSets(common) {
    const sets = {};
    for (const key of Object.keys(common)) sets[key] = new Set(common[key].split(" "));
    return sets;
  }

  // Likely dictionary forms of a word: chairs -> chair, speculatively -> speculative.
  function baseForms(w) {
    const out = [];
    const add = (s) => { if (s.length >= 3 && s !== w && !out.includes(s)) out.push(s); };
    if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
    if (w.endsWith("es")) add(w.slice(0, -2));
    if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
    if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
    if (w.endsWith("ed")) {
      const stem = w.slice(0, -2);
      add(stem); add(stem + "e");
      if (stem.length > 2 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
    }
    if (w.endsWith("ing")) {
      const stem = w.slice(0, -3);
      add(stem); add(stem + "e");
      if (stem.length > 2 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
    }
    if (w.endsWith("in")) add(w + "g"); // runnin' -> running
    if (w.endsWith("ily")) add(w.slice(0, -3) + "y");
    if (w.endsWith("ly")) add(w.slice(0, -2));
    if (w.endsWith("ier")) add(w.slice(0, -3) + "y");
    if (w.endsWith("iest")) add(w.slice(0, -4) + "y");
    if (w.endsWith("er")) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (w.endsWith("est")) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
    return out;
  }

  // Removes everything in a subtitle that is not spoken dialogue.
  function cleanLine(text) {
    return text
      .replace(/<[^>]+>/g, " ")
      .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")          // [door slams] (sighs)
      .replace(/♪[^♪]*♪?/g, " ")                      // song lyrics
      .replace(/(^|\s)[A-Z][A-Z .'-]{1,24}:/g, " ")   // JOHN: speaker labels
      .replace(/\S*\*+\S*/g, " ")                     // ****ing masked by Netflix
      .replace(/([.?!…,"])-(?=\S)/g, "$1 - ")         // -Anyone?-Chalk, man. (two speakers)
      .replace(/^\s*-\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(text) {
    const tokens = [];
    const re = /[\p{L}]+(?:['’][\p{L}]+)*/gu;
    let m, sentenceStart = true, last = 0;
    while ((m = re.exec(text))) {
      const afterTitle = /^\s*\.\s*$/.test(text.slice(last, m.index)) && /^(mr|mrs|ms|dr|st|prof|sgt|lt|capt)$/i.test(tokens.at(-1)?.raw || "");
      if (/[.!?…:]/.test(text.slice(last, m.index)) && !afterTitle) sentenceStart = true;
      tokens.push({ raw: m[0], sentenceStart });
      sentenceStart = false;
      last = m.index + m[0].length;
    }
    return tokens;
  }

  // don't -> skip; you're -> you; dog's -> dog
  function normalize(raw) {
    const w = raw.toLowerCase().replace(/’/g, "'");
    if (w.endsWith("n't")) return null;
    return w.replace(/'(s|re|ve|ll|d|m)$/, "");
  }

  function extractHardWords(lines, common, level = "all") {
    const bands = buildBandSets(common);
    const known = new Set();
    for (const b of THRESHOLD_BANDS[level] || THRESHOLD_BANDS.all) for (const w of bands[b]) known.add(w);
    const isKnown = (w) => known.has(w) || baseForms(w).some((b) => known.has(b));

    const found = new Map();
    for (const line of lines) {
      const text = cleanLine(line.text);
      if (!text) continue;
      const lineIsShouting = text === text.toUpperCase();
      for (const { raw, sentenceStart } of tokenize(text)) {
        const w = normalize(raw);
        if (!w || !/^[a-z]+$/.test(w) || w.length < 3) continue;
        if (FILLER.has(w) || /(.)\1\1/.test(w) || isKnown(w)) continue;
        const capitalized = /^[A-Z]/.test(raw) && !lineIsShouting;
        let e = found.get(w);
        if (!e) {
          e = { word: w, count: 0, lower: 0, midCaps: 0, example: text, t: line.t };
          found.set(w, e);
        }
        e.count++;
        if (!capitalized && !lineIsShouting) e.lower++;
        if (capitalized && !sentenceStart) e.midCaps++;
      }
    }

    // A word that is only ever capitalized in the middle of a sentence is a name.
    for (const [w, e] of found) if (e.midCaps > 0 && e.lower === 0) found.delete(w);

    // betrayed + betray -> one entry, kept under the simplest form.
    for (const w of [...found.keys()]) {
      const parent = baseForms(w).find((b) => found.has(b));
      if (parent) {
        found.get(parent).count += found.get(w).count;
        found.delete(w);
      }
    }
    // betrayed + betrays, with "betray" itself never spoken -> one entry under "betray".
    for (const w of [...found.keys()]) {
      if (!found.has(w)) continue;
      const forms = baseForms(w);
      for (const other of [...found.keys()]) {
        if (other === w) continue;
        const shared = baseForms(other).find((b) => forms.includes(b));
        if (shared) {
          const e = found.get(w);
          e.count += found.get(other).count;
          found.delete(other);
          found.delete(w);
          e.word = shared;
          found.set(shared, e);
          break;
        }
      }
    }

    return [...found.values()]
      .map(({ word, count, example, t }) => ({ word, count, example, t }))
      .sort((a, b) => a.word.localeCompare(b.word));
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  }

  root.Vocab = { extractHardWords, baseForms, cleanLine, formatTime };
})(typeof self !== "undefined" ? self : globalThis);
