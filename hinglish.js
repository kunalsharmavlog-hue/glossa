// Turns Hindi script into Hinglish: हठीला -> hathila. No browser APIs, so it can be tested in Node.
(function (root) {
  const CONSONANTS = {
    "क":"k","ख":"kh","ग":"g","घ":"gh","ङ":"ng","च":"ch","छ":"chh","ज":"j","झ":"jh","ञ":"n",
    "ट":"t","ठ":"th","ड":"d","ढ":"dh","ण":"n","त":"t","थ":"th","द":"d","ध":"dh","न":"n",
    "प":"p","फ":"ph","ब":"b","भ":"bh","म":"m","य":"y","र":"r","ल":"l","ळ":"l","व":"v",
    "श":"sh","ष":"sh","स":"s","ह":"h","क़":"k","ख़":"kh","ग़":"g","ज़":"z","ड़":"d","ढ़":"dh","फ़":"f",
  };
  const NUKTA = { "क":"क़","ख":"ख़","ग":"ग़","ज":"ज़","ड":"ड़","ढ":"ढ़","फ":"फ़" };
  const VOWELS = { "अ":"a","आ":"a","इ":"i","ई":"i","उ":"u","ऊ":"u","ऋ":"ri","ए":"e","ऐ":"ai","ओ":"o","औ":"au","ऑ":"o","ऍ":"e" };
  const SIGNS = { "ा":"a","ि":"i","ी":"i","ु":"u","ू":"u","ृ":"ri","े":"e","ै":"ai","ो":"o","ौ":"au","ॉ":"o","ॅ":"e" };
  const NASAL = { "ं":"n","ँ":"n","ः":"h" };
  const HALANT = "्";
  const NUKTA_SIGN = "़";

  function romanizeWord(word) {
    // Each unit is a consonant with its vowel ("a" until a sign or halant says otherwise).
    const units = [];
    const chars = [...word.normalize("NFC")];
    for (let i = 0; i < chars.length; i++) {
      let ch = chars[i];
      if (chars[i + 1] === NUKTA_SIGN && NUKTA[ch]) { ch = NUKTA[ch]; i++; }
      if (CONSONANTS[ch]) units.push({ c: CONSONANTS[ch], v: "a", inherent: true, after: "" });
      else if (VOWELS[ch]) units.push({ c: "", v: VOWELS[ch], inherent: false, after: "" });
      else if (SIGNS[ch] && units.length) { units.at(-1).v = SIGNS[ch]; units.at(-1).inherent = false; }
      else if (ch === HALANT && units.length) { units.at(-1).v = ""; units.at(-1).inherent = false; }
      else if (NASAL[ch] && units.length) units.at(-1).after += NASAL[ch];
    }

    // Hindi drops the written "a" at the end of a word and between some consonants: समझना -> samajhna.
    const last = units.at(-1);
    if (last && last.inherent && units.length > 1) last.v = "";
    for (let i = units.length - 2; i > 0; i--) {
      const u = units[i];
      if (u.inherent && !u.after && units[i - 1].v && units[i + 1].c && units[i + 1].v) u.v = "";
    }
    return units.map((u) => u.c + u.v + u.after).join("");
  }

  function romanize(text) {
    return String(text)
      .replace(/[ऀ-ॿ]+/g, romanizeWord)
      .replace(/\s+/g, " ")
      .trim();
  }

  root.Hinglish = { romanize };
})(typeof self !== "undefined" ? self : globalThis);
