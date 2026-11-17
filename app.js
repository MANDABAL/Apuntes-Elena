/* Apuntes en mi letra: PDF -> texto estructurado -> PDF escrito con la fuente de su letra. */
(function () {
  const $ = (id) => document.getElementById(id);
  let PUA = window.LETRA_PUA || null;
  let FONT_B64 = window.LETRA_FONT || null;
  const ALIAS = { "–": "-", "—": "-", "−": "-", "“": '"', "”": '"', "„": '"', "«": "«", "‘": "'", "’": "'",
    "…": "...", "[": "(", "]": ")", "➔": "→", "➜": "→", "➝": "→", "⇒": "→", "⟶": "→", "►": "→", "\t": " ", " ": " ", "ﬁ": "fi", "ﬂ": "fl" };
  const BULLET_ONLY = /^([•·▪■□○●◦❖➢➤►✓✔★☆\-−–—*o]|[-])$/;
  const BULLET_INLINE = /^([•·▪■□○●◦❖➢➤►✓✔★☆−–—*]|[-])\s*/;
  const NUMBERED = /^(\d{1,2}|[a-zA-Z])[.)]\s+/;
  const NOISE = /wuolah|reservados todos los derechos|plan turbo|eliminar la publi|consigo coins|planes pro|pierdo espacio|necesito concentraci|ali ali|con 1 coin|lo quito yo|^[0-9a-f]{24,}(-\d+)?$|^\d{1,3}$|^[.\s]*$/i;

  let fontBytes = null, sourceName = "apuntes";

  function b64ToBytes(b64) {
    const bin = atob(b64); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function joinItems(items, h) {
    let text = "", end = null;
    for (const it of items) {
      if (end !== null && it.x - end > h * 0.15 && !text.endsWith(" ") && !/^[\s.,;:)\]]/.test(it.s)) text += " ";
      text += it.s; end = it.x + it.w;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  // ---------- 1. Leer el PDF y reconstruir la estructura ----------
  // ---- OCR (solo si una página no trae texto: escaneos, fotos) ----
  let ocrWorker = null;
  async function getOcr() {
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract) throw new Error("NO_OCR");
    const base = new URL("vendor/tesseract/", document.baseURI).href;
    ocrWorker = await Tesseract.createWorker("spa", 1, {
      workerPath: base + "worker.min.js", corePath: base + "core/", langPath: base + "lang", gzip: true,
    });
    return ocrWorker;
  }

  async function ocrLines(page, p) {
    const worker = await getOcr();
    const scale = 2.6;                          // ~190 ppp: suficiente para letra de apuntes
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data } = await worker.recognize(c, {}, { blocks: true, text: false });
    const raw = [];
    for (const b of data.blocks || []) for (const par of b.paragraphs || []) for (const ln of par.lines || []) {
      const words = (ln.words || []).filter((w) => w.text.trim() && w.confidence > 45);
      if (!words.length) continue;
      const rh = ln.rowAttributes && ln.rowAttributes.row_height ? ln.rowAttributes.row_height : (ln.bbox.y1 - ln.bbox.y0) * 0.8;
      const y = (ln.baseline && ln.baseline.y0 ? (ln.baseline.y0 + ln.baseline.y1) / 2 : ln.bbox.y1) / scale;
      raw.push({ y, h: rh / scale, words: words.map((w) => ({ s: w.text, x: w.bbox.x0 / scale, x1: w.bbox.x1 / scale, conf: w.confidence })) });
    }
    // columna de texto: lo que queda fuera (banners, garabatos de los márgenes) se descarta
    const pct = (arr, q) => { const a = [...arr].sort((m, n) => m - n); return a.length ? a[Math.floor((a.length - 1) * q)] : 0; };
    const full = raw.filter((l) => l.words.length >= 4);
    const colL = pct(full.map((l) => l.words[0].x), 0.2), colR = pct(full.map((l) => l.words[l.words.length - 1].x1), 0.8);
    const out = [];
    for (const l of raw) {
      const ws = (full.length ? l.words.filter((w) => w.x1 > colL - l.h * 0.15 && w.x < colR + l.h * 1.5) : l.words)
        .filter((w) => /[0-9A-Za-zÁÉÍÓÚáéíóúÑñÜü]/.test(w.s) || /^[-–—•·→(),.;:¿?¡!"'%*]+$/.test(w.s));
      if (!ws.length) continue;
      const items = ws.map((w) => ({ s: w.s, x: w.x, w: w.x1 - w.x, y: l.y, h: l.h }));
      const text = joinItems(items, l.h);
      if ((text.match(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/g) || []).length < 3) continue;
      out.push({ page: p, y: l.y, h: l.h, items, x: items[0].x, text, ocr: true });
    }
    c.width = c.height = 0;
    return out;
  }

  async function pdfToMarkup(buf, progress) {
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const lines = [];
    let ocrPages = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items
        .filter((it) => it.str !== undefined && Math.abs(it.transform[1]) < 0.01 && Math.abs(it.transform[2]) < 0.01)
        .map((it) => ({ s: it.str, x: it.transform[4], y: vp.height - it.transform[5], h: Math.abs(it.transform[3]) || it.height, w: it.width }))
        .filter((it) => it.s.trim() !== "" && it.h > 2)
        .sort((a, b) => a.y - b.y || a.x - b.x);
      const chars = items.reduce((a, it) => a + it.s.trim().length, 0);
      if (chars < 40) {                          // página escaneada: OCR
        ocrPages++;
        progress && progress(`Leyendo con OCR la página ${p} de ${pdf.numPages}… (unos segundos por página)`);
        lines.push(...(await ocrLines(page, p)));
        continue;
      }
      progress && progress(`Leyendo página ${p} de ${pdf.numPages}…`);
      const pl = [];
      for (const it of items) {
        let L = pl.find((l) => Math.abs(l.y - it.y) < Math.max(l.h, it.h) * 0.45);
        if (!L) { L = { page: p, y: it.y, h: it.h, items: [] }; pl.push(L); }
        L.items.push(it); L.h = Math.max(L.h, it.h);
      }
      for (const L of pl) {
        L.items.sort((a, b) => a.x - b.x);
        L.x = L.items[0].x; L.text = joinItems(L.items, L.h);
        lines.push(L);
      }
    }
    pdfToMarkup.ocrPages = ocrPages;
    // quitar cabeceras/pies repetidos y publicidad
    const count = {};
    for (const L of lines) count[L.text] = (count[L.text] || 0) + 1;
    const pages = new Set(lines.map((l) => l.page)).size;
    const body = lines.filter((L) => !NOISE.test(L.text) && !(pages > 3 && count[L.text] > pages * 0.5 && L.text.length < 120));
    if (!body.length) return "";

    // estadísticas por página (cada página puede venir a otra escala)
    const stat = {};
    for (const L of body) (stat[L.page] = stat[L.page] || []).push(L);
    for (const p in stat) {
      const ls = stat[p];
      const hs = []; ls.forEach((l) => { for (let i = 0; i < Math.ceil(l.text.length / 20); i++) hs.push(l.h); });
      hs.sort((a, b) => a - b);
      const xs = ls.map((l) => l.x).sort((a, b) => a - b);
      stat[p] = { medH: hs[Math.floor(hs.length / 2)], bodyX: xs[Math.floor(xs.length * 0.1)] };
    }
    // clasificar
    const blocks = [];
    for (const L of body) {
      let kind = "p", text = L.text, markX = L.x;
      const first = L.items[0], second = L.items[1];
      const st = stat[L.page];
      L.rel = (L.x - st.bodyX) / st.medH;
      if ((L.h > st.medH * 1.3 || /^tema\s*\d/i.test(text)) && L.h > st.medH * 1.08 && text.length < 160) kind = "h1";
      else if (L.h > st.medH * 1.12 && text.length < 140) kind = "h2";
      else if (second && (BULLET_ONLY.test(first.s.trim()) && second.x - (first.x + first.w) > L.h * 0.4 ||
               L.ocr && /^[\[(]?[oOe0>+*•·]?[\])]?$/.test(first.s.trim()) && second.x - (first.x + first.w) > L.h * 0.8)) {
        kind = "li"; text = joinItems(L.items.slice(1), L.h);
      } else if (BULLET_INLINE.test(text) && !/^[-–]\d/.test(text)) {
        kind = "li"; text = text.replace(BULLET_INLINE, "");
      } else if (NUMBERED.test(text)) {
        kind = "ol";
      }
      const prev = blocks[blocks.length - 1];
      const samePageGap = prev && prev.page === L.page ? L.y - prev.lastY : null;
      const cont = prev && kind === "p" && prev.kind !== "h1" && prev.kind !== "h2" &&
        (samePageGap === null ? prev.page === L.page - 1 : samePageGap < L.h * 1.9) &&
        L.x > prev.textX - 8 &&
        !(/[.:;!?)]$/.test(prev.text) && /^[A-ZÁÉÍÓÚÑ¿¡"“(]/.test(text) && Math.abs(L.x - prev.textX) > 4) &&
        !(/[.:!?]$/.test(prev.text) && /^[A-ZÁÉÍÓÚÑ¿¡]/.test(text) && prev.kind === "p");
      if (cont) {
        prev.text = prev.text.endsWith("-") ? prev.text + text : prev.text + " " + text;
        prev.lastY = L.y; prev.page = L.page;
        continue;
      }
      if ((kind === "h1" || kind === "h2") && prev && prev.kind === kind && prev.page === L.page && L.y - prev.lastY < L.h * 1.8) {
        prev.text += " " + text; prev.lastY = L.y; continue;   // título en dos líneas
      }
      const textX = kind === "li" && second ? second.x : L.x;
      blocks.push({ kind, text, page: L.page, lastY: L.y, markX, textX, rel: L.rel });
    }
    // niveles de sangría para listas
    const rels = blocks.filter((b) => b.kind === "li" || b.kind === "ol").map((b) => b.rel).sort((a, b) => a - b);
    const marks = [];
    for (const r of rels) if (!marks.length || r - marks[marks.length - 1] > 0.9) marks.push(r);
    const levelOf = (r) => { let k = 0; marks.forEach((m, i) => { if (r >= m - 0.45) k = i; }); return k; };
    const out = [];
    for (const b of blocks) {
      if (b.kind === "h1") out.push("", "# " + b.text);
      else if (b.kind === "h2") out.push("", "## " + b.text);
      else if (b.kind === "li" || b.kind === "ol") {
        const lvl = Math.min(2, levelOf(b.rel));
        out.push("  ".repeat(lvl) + (b.kind === "li" ? "- " : "") + b.text);
      } else out.push(b.text);
    }
    return out.join("\n").replace(/^\n+/, "");
  }

  // ---------- 2. Escribir el PDF con su letra ----------
  function makeRng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; }

  function normChar(ch, missing) {
    if (PUA[ch]) return ch;
    if (ALIAS[ch] !== undefined) return ALIAS[ch];
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base !== ch && [...base].every((c) => PUA[c])) return base;
    if (ch === " ") return ch;
    if (/^[-•●▪■□○◦❖➢➤►✓✔★☆]$/.test(ch)) return "•";
    missing.add(ch); return "";
  }

  function parseMarkup(md) {
    const blocks = [];
    for (const raw of md.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const lvl = Math.min(2, Math.floor((raw.length - raw.trimStart().length) / 2));
      const t = raw.trim();
      let m;
      if (t.startsWith("# ")) blocks.push({ kind: "h1", text: t.slice(2) });
      else if (t.startsWith("## ")) blocks.push({ kind: "h2", text: t.slice(3) });
      else if (t.startsWith("-> ")) blocks.push({ kind: "li", lvl, mark: "↳", text: t.slice(3) });
      else if (t.startsWith("- ")) blocks.push({ kind: "li", lvl, mark: lvl < 2 ? "-" : "→", text: t.slice(2) });
      else if ((m = t.match(/^(\d{1,2}|[a-zA-Z])([.)])\s+(.*)$/))) blocks.push({ kind: "li", lvl, mark: m[1] + m[2], text: m[3] });
      else blocks.push({ kind: "p", text: t });
    }
    return blocks;
  }

  async function markupToPdf(md, sizePt, onProgress) {
    const { PDFDocument, rgb, degrees } = PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: false });
    const W = 595.28, H = 841.89, ML = 56, MR = 48, MT = 52, MB = 50;
    const INK = rgb(0.13, 0.13, 0.19);
    const rnd = makeRng(20261117), last = {}, missing = new Set();
    const pick = (ch) => {
      const v = PUA[ch]; if (!v) return ch;
      let i = Math.floor((rnd() + 0.5) * v.length);
      if (v.length > 1 && last[ch] === i) i = (i + 1) % v.length;
      last[ch] = i; return String.fromCharCode(v[i]);
    };
    let page = null, y = 0;
    const newPage = () => { page = doc.addPage([W, H]); y = H - MT; };
    newPage();

    const prepWord = (w, size) => {
      const glyphs = [];
      for (const raw of w) {
        const n = normChar(raw, missing);
        for (const ch of n) { if (ch === " ") continue; const g = pick(ch); glyphs.push({ g, w: font.widthOfTextAtSize(g, size) }); }
      }
      return { glyphs, w: glyphs.reduce((a, b) => a + b.w, 0) };
    };
    const drawGlyphs = (glyphs, x, yy, size) => {
      for (const { g, w } of glyphs) {
        const s = size * (1 + rnd() * 0.06);
        page.drawText(g, { x, y: yy + rnd() * size * 0.07, size: s, font, color: INK, rotate: degrees(rnd() * 4) });
        x += w;
      }
      return x;
    };

    const blocks = parseMarkup(md);
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (bi % 20 === 0) { onProgress && onProgress(bi / blocks.length); await new Promise((r) => setTimeout(r, 0)); }
      const size = b.kind === "h1" ? sizePt * 1.35 : b.kind === "h2" ? sizePt * 1.18 : sizePt;
      const lh = size * 1.72;
      const before = b.kind === "h1" ? 4 : b.kind === "h2" ? sizePt * 0.9 : sizePt * 0.12;
      const indent = b.kind === "li" ? 4 + b.lvl * sizePt * 1.6 : 0;
      const hang = b.kind === "li" ? sizePt * 1.35 : 0;
      const x0 = ML + indent + hang + (rnd() + 0.5) * 3;
      const maxX = W - MR;
      // títulos: no dejarlos solos al final de la página
      const need = (b.kind === "h1" || b.kind === "h2") ? lh * 3 : lh;
      if (y - before - need < MB) newPage(); else y -= before;
      if (y - lh < MB) newPage();
      const words = b.text.split(/\s+/).filter(Boolean).map((w) => prepWord(w, size));
      const space = font.widthOfTextAtSize(" ", size) * 0.85;
      let line = [], lw = 0;
      const lines = [];
      for (const w of words) {
        if (line.length && x0 + lw + space + w.w > maxX) { lines.push(line); line = []; lw = 0; }
        lw += (line.length ? space : 0) + w.w; line.push(w);
      }
      if (line.length) lines.push(line);
      lines.forEach((ln, li) => {
        if (y - lh * 0.75 < MB) newPage();
        y -= lh * (li === 0 ? 0.78 : 1);
        if (li === 0 && b.kind === "li") {
          const m = prepWord(b.mark, size);
          drawGlyphs(m.glyphs, ML + indent + (rnd() + 0.5) * 2, y, size);
        }
        let x = x0 + (rnd() + 0.5) * 2;
        const startX = x;
        ln.forEach((w, wi) => { if (wi) x += space * (1 + rnd() * 0.25); x = drawGlyphs(w.glyphs, x, y, size); });
        if (b.kind === "h1" || b.kind === "h2") {
          const uy = y - size * 0.22;
          page.drawLine({ start: { x: startX - 2, y: uy + rnd() }, end: { x: x + 2, y: uy + rnd() }, thickness: b.kind === "h1" ? 1.1 : 0.85, color: INK });
        }
      });
      y -= lh * 0.22;
      if (b.kind === "h1") y -= sizePt * 0.5;
    }
    return { bytes: await doc.save(), pages: doc.getPageCount(), missing: [...missing] };
  }

  // ---------- 3. Interfaz ----------
  const status = (msg, kind) => { const el = $("status"); el.textContent = msg; el.dataset.kind = kind || ""; };
  const words = (t) => (t.match(/\S+/g) || []).length;

  async function onFile(file) {
    if (!file) return;
    sourceName = file.name.replace(/\.pdf$/i, "");
    status("Leyendo el PDF…", "busy");
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const md = await pdfToMarkup(buf, (m) => status(m, "busy"));
      if (!md.trim()) { status("No he encontrado texto en este PDF.", "error"); return; }
      $("text").value = md;
      const ocr = pdfToMarkup.ocrPages ? ` · ${pdfToMarkup.ocrPages} páginas leídas con OCR (revisa el texto por si hay algún error)` : "";
      $("fileinfo").textContent = `${file.name} · ${words(md).toLocaleString("es-ES")} palabras${ocr}`;
      $("step2").hidden = false;
      document.dispatchEvent(new CustomEvent("letra:loaded"));
      status("Texto listo. Puedes revisarlo o pasarlo directamente a tu letra.", "ok");
    } catch (e) {
      console.error(e);
      if (e && e.message === "NO_OCR") status("Este PDF es un escaneo y aquí no está disponible el OCR. Usa la web propia de la herramienta.", "error");
      else status("No he podido leer ese PDF. ¿Está protegido con contraseña o dañado?", "error");
    }
  }

  async function generate() {
    const md = $("text").value;
    if (!md.trim()) return;
    const btn = $("go"); btn.disabled = true;
    status("Escribiendo en tu letra…", "busy");
    try {
      const sizes = { s: 12.5, m: 14, l: 15.5 };
      const fire = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
      fire("letra:progress", 0);
      const res = await markupToPdf(md, sizes[$("size").value], (f) => fire("letra:progress", f * 0.95));
      fire("letra:progress", 1);
      const name = `${sourceName} (mi letra).pdf`;
      await preview(res.bytes);
      let saved = false;
      const dl = window.claude && window.claude.use ? await window.claude.use("downloads").catch(() => null) : null;
      if (dl) {
        try { await dl.save({ filename: name, data: new Blob([res.bytes], { type: "application/pdf" }) }); saved = true; }
        catch (e) { status("Descarga cancelada. Pulsa otra vez el botón para descargarlo.", "error"); btn.disabled = false; return; }
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([res.bytes], { type: "application/pdf" }));
        a.download = name; document.body.appendChild(a); a.click(); a.remove(); saved = true;
      }
      let msg = `Hecho: ${res.pages} páginas.`;
      if (res.missing.length) msg += ` Caracteres que no están en tu letra y se han quitado: ${res.missing.join(" ")}`;
      status(msg, "ok");
      document.dispatchEvent(new CustomEvent("letra:done"));
    } catch (e) {
      console.error(e); status("Algo ha fallado al crear el PDF: " + e.message, "error");
    }
    btn.disabled = false;
  }

  async function preview(bytes) {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const page = await pdf.getPage(1);
    const c = $("preview"), wrap = $("previewWrap");
    const scale = Math.min(2, (wrap.clientWidth || 420) / 595) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    wrap.hidden = false;
  }

  window.__letra = { pdfToMarkup, markupToPdf };
  window.__letraUnlock = (font, pua) => { FONT_B64 = font; PUA = pua; fontBytes = b64ToBytes(font); };
  document.addEventListener("DOMContentLoaded", () => {
    if (FONT_B64) fontBytes = b64ToBytes(FONT_B64);
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = $("pdfjs-worker").src;
    $("file").addEventListener("change", (e) => onFile(e.target.files[0]));
    $("go").addEventListener("click", generate);
    const drop = $("drop");
    ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); });
  });
})();
