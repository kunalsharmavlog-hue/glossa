// Small dependency-free PDF writer using the fonts built into every PDF reader.
(function (root) {
  const PAGE_W = 595, PAGE_H = 842, MARGIN = 50, CONTENT_W = PAGE_W - MARGIN * 2;
  const FONTS = { regular: "F1", bold: "F2", italic: "F3" };

  // Helvetica character widths for ASCII 32-126.
  const WIDTHS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

  const WIN_ANSI = { "€":128, "‘":145, "’":146, "“":147, "”":148, "•":149, "–":150, "—":151, "…":133 };

  // Converts text to bytes the built-in fonts can draw; unsupported characters are removed.
  function toWinAnsi(text) {
    let out = "";
    for (const ch of String(text).normalize("NFC")) {
      const code = ch.codePointAt(0);
      if (code >= 32 && code <= 126) out += ch;
      else if (WIN_ANSI[ch]) out += String.fromCharCode(WIN_ANSI[ch]);
      else if (code >= 160 && code <= 255) out += ch;
      else if (/\s/.test(ch)) out += " ";
      else {
        const plain = ch.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
        out += plain;
      }
    }
    return out;
  }

  function textWidth(bytes, size, font) {
    let w = 0;
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes.charCodeAt(i);
      w += c >= 32 && c <= 126 ? WIDTHS[c - 32] : 556;
    }
    return (w / 1000) * size * (font === "bold" ? 1.07 : 1);
  }

  function wrap(bytes, size, font, maxWidth) {
    const lines = [];
    let cur = "";
    for (const word of bytes.split(/ +/)) {
      const next = cur ? cur + " " + word : word;
      if (textWidth(next, size, font) <= maxWidth || !cur) cur = next;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  const escapePdf = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);

  // PDF's built-in fonts have no Hindi letters, so the word is drawn by the browser as a picture,
  // which also joins the matras correctly. Returns null if drawing fails, and the line is skipped.
  async function renderHindiImage(text) {
    try {
      const SCALE = 4, POINT_SIZE = 11.5, px = POINT_SIZE * SCALE;
      const font = `${px}px "Kohinoor Devanagari","Devanagari Sangam MN","Noto Sans Devanagari",sans-serif`;
      const probe = new OffscreenCanvas(1, 1).getContext("2d");
      probe.font = font;
      const width = Math.ceil(probe.measureText(text).width) + 8, height = Math.ceil(px * 1.6);
      if (width <= 8) return null;

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#1a1a1a";
      ctx.font = font;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(text, 4, Math.round(px * 1.15));

      const rgba = ctx.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
      const stream = new Blob([gray]).stream().pipeThrough(new CompressionStream("deflate"));
      const packed = new Uint8Array(await new Response(stream).arrayBuffer());
      let data = "";
      for (let i = 0; i < packed.length; i += 8192) data += String.fromCharCode(...packed.subarray(i, i + 8192));
      return { data, width, height, ptW: width / SCALE, ptH: height / SCALE, baseline: (height - Math.round(px * 1.15)) / SCALE };
    } catch {
      return null;
    }
  }

  function buildVocabPdf({ title, subtitle, entries, unknown }) {
    const images = [];
    const pages = [];
    let ops = [], y = PAGE_H - MARGIN;

    const newPage = () => {
      if (ops.length) pages.push(ops);
      ops = [];
      y = PAGE_H - MARGIN;
    };
    const draw = (bytes, x, size, font, gray = 0) => {
      ops.push(`${gray} g BT /${FONTS[font]} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdf(bytes)}) Tj ET`);
    };
    const ensure = (h) => { if (y - h < MARGIN + 20) newPage(); };

    // Headline: the movie name.
    const titleBytes = toWinAnsi(title).trim() || "Movie";
    for (const line of wrap(titleBytes, 26, "bold", CONTENT_W)) {
      y -= 26;
      draw(line, MARGIN, 26, "bold");
      y -= 6;
    }
    y -= 12;
    draw(toWinAnsi(subtitle), MARGIN, 11, "regular", 0.4);
    y -= 12;
    ops.push(`0.75 G 0.7 w ${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);
    y -= 24;

    for (const e of entries) {
      const defs = e.defs.flatMap((d) => wrap(toWinAnsi(d), 10.5, "regular", CONTENT_W - 12));
      const ex = wrap(toWinAnsi(`"${e.example}"  (${e.time})`), 9.5, "italic", CONTENT_W - 12);
      ensure(18 + (e.hindiImage ? 17 : 0) + defs.length * 14 + ex.length * 13 + 12);

      const word = toWinAnsi(e.word);
      draw(word, MARGIN, 13, "bold");
      if (e.pos) draw(toWinAnsi(e.pos), MARGIN + textWidth(word, 13, "bold") + 8, 10, "italic", 0.45);
      y -= 16;
      if (e.hindiImage) {
        const img = e.hindiImage, name = `Im${images.length}`;
        images.push(img);
        y -= 2;
        draw("Hindi:", MARGIN + 12, 10.5, "regular", 0.1);
        const x = MARGIN + 12 + textWidth("Hindi:", 10.5, "regular") + 3;
        ops.push(`q ${img.ptW.toFixed(2)} 0 0 ${img.ptH.toFixed(2)} ${x.toFixed(2)} ${(y - img.baseline).toFixed(2)} cm /${name} Do Q`);
        y -= 15;
      }
      for (const line of defs) { draw(line, MARGIN + 12, 10.5, "regular", 0.1); y -= 14; }
      for (const line of ex) { draw(line, MARGIN + 12, 9.5, "italic", 0.45); y -= 13; }
      y -= 12;
    }

    if (unknown && unknown.length) {
      ensure(60);
      y -= 4;
      draw("Meaning not found", MARGIN, 13, "bold");
      y -= 15;
      draw("These may be names or slang. Search them if you are curious.", MARGIN, 9.5, "italic", 0.45);
      y -= 15;
      for (const line of wrap(toWinAnsi(unknown.join(", ")), 10.5, "regular", CONTENT_W)) {
        ensure(14);
        draw(line, MARGIN, 10.5, "regular", 0.1);
        y -= 14;
      }
    }
    pages.push(ops);

    // Page numbers.
    pages.forEach((p, i) => {
      const label = `${i + 1} / ${pages.length}`;
      p.push(`0.55 g BT /F1 9 Tf ${(PAGE_W - MARGIN - textWidth(label, 9, "regular")).toFixed(2)} 28 Td (${label}) Tj ET`);
    });

    // Assemble the file. Every character is one byte, so string length equals byte offset.
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add(""); // Pages object, filled in below.
    const font = (name) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
    const f1 = font("Helvetica"), f2 = font("Helvetica-Bold"), f3 = font("Helvetica-Oblique");
    const xobjects = images.map((img, i) => {
      const n = add(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.data.length} >>\nstream\n${img.data}\nendstream`);
      return `/Im${i} ${n} 0 R`;
    }).join(" ");
    const kids = pages.map((p) => {
      const stream = p.join("\n");
      const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> /XObject << ${xobjects} >> >> /Contents ${c} 0 R >>`);
    });
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${escapePdf(titleBytes)} - Vocabulary) >>`);

    let pdf = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) pdf += String(o).padStart(10, "0") + " 00000 n \n";
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return pdf;
  }

  root.VocabPdf = { buildVocabPdf, renderHindiImage };
})(typeof self !== "undefined" ? self : globalThis);
