const vendor = new URL("./vendor/", import.meta.url);
const pdfBase = new URL("pdfjs/", vendor);
const maxBytes = 100 * 1024 * 1024;
const kindOf = name => name.match(/\.(pptx|pdf|html?)$/i)?.[1].toLowerCase().replace(/^htm$/, "html");
const pathKey = path => path.replaceAll("\\", "/").replace(/^\.\//, "");

export function remoteUrl(value, base = location.href) {
  const url = new URL(value, base);
  if (url.protocol !== "https:" && url.origin !== location.origin) throw new Error("课件链接须使用 HTTPS。");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("课件链接格式无效。");
  return url;
}

export async function readManifest(file, files, base) {
  if (file.size > 2 * 1024 * 1024) throw new Error("课件清单超过 2 MB。");
  const manifest = JSON.parse(await file.text());
  const rows = Array.isArray(manifest) ? manifest : manifest?.slides ?? manifest?.decks;
  if (!Array.isArray(rows)) throw new Error("清单须包含 slides 或 decks 列表。");
  const directory = pathKey(file.webkitRelativePath || file.name).split("/").slice(0, -1).join("/");
  const imports = [], missing = [];
  for (const row of rows) {
    const path = row?.file || row?.url;
    if (typeof path !== "string" || typeof row.title !== "string" || !kindOf(path.split(/[?#]/)[0])) continue;
    const resolved = pathKey(directory ? directory + "/" + path : path);
    const local = files.get(resolved) || files.get(pathKey(path));
    const meta = {title: row.title.slice(0, 200), group: String(row.kind || row.group || "清单课件").slice(0, 100),
      summary: String(row.description || "").slice(0, 1600)};
    if (local) imports.push({file: local, meta});
    else if (base || /^https:\/\//i.test(path)) {
      const url = remoteUrl(path, base).href;
      imports.push({url, meta});
    } else missing.push(path);
  }
  return {imports, missing};
}

export async function deckRecord({file, url, meta = {}}) {
  const name = file?.name || decodeURIComponent(new URL(url).pathname.split("/").at(-1));
  const kind = kindOf(name);
  if (!kind) return null;
  if (file && file.size > maxBytes) throw new Error("单份文件超过 100 MB。");
  const path = file?.webkitRelativePath || name;
  const fingerprint = file ? JSON.stringify([path, file.size, file.lastModified]) : url;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  const id = "file-" + Array.from(new Uint8Array(digest).slice(0, 16), n => n.toString(16).padStart(2, "0")).join("");
  return {id, kind, name, url, title: meta.title || name.replace(/\.[^.]+$/, ""),
    group: meta.group || path.split("/").slice(0, -1).join("/") || "我的课件", summary: meta.summary || ""};
}

async function content(deck, file, signal) {
  if (file) return file.arrayBuffer();
  const response = await fetch(deck.url, {signal, credentials: "omit"});
  if (!response.ok || !response.body) throw new Error("无法读取远程课件。");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("远程文件超过 100 MB。");
      chunks.push(value);
    }
    return new Blob(chunks).arrayBuffer();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function htmlPages(raw) {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  for (const node of doc.querySelectorAll("script,style,template,noscript")) node.remove();
  const sections = Array.from(doc.querySelectorAll(".slide, [data-slide], .slides section"))
    .filter(node => !node.querySelector(".slide, [data-slide], .slides section"));
  const nodes = sections.length ? sections : [doc.body];
  return nodes.map(node => ({
    title: node.querySelector("h1,h2,h3")?.textContent.trim() || "",
    text: node.textContent.replace(/\s+/g, " ").trim().slice(0, 12000)
  }));
}

export async function readToolPdf(deck, file, signal) {
  return file || new Blob([await content(deck, file, signal)], {type: "application/pdf"});
}

export async function openMedia(deck, file, host, signal, {outlineFonts = false} = {}) {
  if (!file && !deck.url) throw new Error("找不到原文件，请重新导入这份课件。");
  if (deck.kind === "html") {
    const raw = file && new TextDecoder().decode(await content(deck, file, signal));
    const pages = raw ? htmlPages(raw) : [{title: deck.title, text: deck.summary}];
    const frame = document.createElement("iframe");
    frame.title = deck.title;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    if (file) {
      frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src data: blob:; form-action \'none\'; base-uri \'none\'">' + raw;
    } else frame.src = deck.url;
    return {count: pages.length, text: index => pages[index], independent: true,
      render() { if (!frame.isConnected) host.replaceChildren(frame); }};
  }
  const bytes = await content(deck, file, signal);
  signal.throwIfAborted();
  if (deck.kind === "pdf") {
    const pdfjs = await import(new URL("pdf.min.mjs", pdfBase));
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", pdfBase).href;
    const task = pdfjs.getDocument({data: bytes, isEvalSupported: false,
      disableFontFace: outlineFonts, useSystemFonts: true, iccUrl: new URL("iccs/", pdfBase).href,
      cMapUrl: new URL("cmaps/", pdfBase).href, cMapPacked: true,
      standardFontDataUrl: new URL("standard_fonts/", pdfBase).href, wasmUrl: new URL("wasm/", pdfBase).href});
    try {
      const pdf = await task.promise;
      const texts = new Map();
      let rendering;
      return {count: pdf.numPages, async text(index) {
        if (!texts.has(index)) {
          const page = await pdf.getPage(index + 1);
          const parts = await page.getTextContent();
          const text = parts.items.map(item => item.str ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
          texts.set(index, {text, title: text.trim().split("\n")[0].slice(0, 90)});
        }
        return texts.get(index);
      }, async render(index, pageSignal) {
        rendering?.cancel();
        const page = await pdf.getPage(index + 1);
        pageSignal.throwIfAborted();
        const unit = page.getViewport({scale: 1});
        const viewport = page.getViewport({scale: Math.min(1800 / Math.max(unit.width, unit.height), 2)});
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        rendering = page.render({canvasContext: canvas.getContext("2d"), viewport});
        await rendering.promise;
        pageSignal.throwIfAborted();
        const sheet = document.createElement("div");
        sheet.className = "pdf-sheet";
        sheet.append(canvas);
        host.replaceChildren(sheet);
      }, async renderRegion(index, rect, detailSignal) {
        const page = await pdf.getPage(index + 1);
        detailSignal.throwIfAborted();
        const unit = page.getViewport({scale: 1});
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const maxWidth = Math.min(window.innerWidth * .88, 1020);
        const maxHeight = window.innerHeight * .74;
        const scale = Math.min(maxWidth / (unit.width * rect.width),
          maxHeight / (unit.height * rect.height), 16000 / (ratio * Math.max(unit.width, unit.height)));
        const viewport = page.getViewport({scale: scale * ratio});
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * rect.width);
        canvas.height = Math.ceil(viewport.height * rect.height);
        canvas.style.width = (canvas.width / ratio) + "px";
        const render = page.render({canvas, viewport,
          transform: [1, 0, 0, 1, -viewport.width * rect.x, -viewport.height * rect.y]});
        const cancel = () => render.cancel();
        detailSignal.addEventListener("abort", cancel, {once: true});
        try {
          await render.promise;
          detailSignal.throwIfAborted();
          return canvas;
        } finally { detailSignal.removeEventListener("abort", cancel); }
      }, close() { rendering?.cancel(); void task.destroy().catch(() => {}); }};
    } catch (error) { await task.destroy().catch(() => {}); throw error; }
  }
  const {PptxViewer, RECOMMENDED_ZIP_LIMITS, buildTextIndex, parseZipLazyMedia, buildPresentation} =
    await import(new URL("pptx/renderer.mjs", vendor));
  const viewer = host && await PptxViewer.open(bytes, host, {
    zipLimits: RECOMMENDED_ZIP_LIMITS, externalMedia: "block", renderMode: "slide",
    width: Math.max(280, host.getBoundingClientRect().width - 16), lazySlides: true, lazyMedia: true,
    pdfjs: false, signal
  });
  const model = viewer?.presentationData || buildPresentation(await parseZipLazyMedia(bytes, RECOMMENDED_ZIP_LIMITS), {lazySlides: true});
  let index;
  return {count: model.slides.length, render: async page => {
    if (index === page) return;
    await viewer.goToSlide(page);
    index = page;
  }, text(page) {
    const matches = buildTextIndex({...model, slides: [model.slides[page]]});
    const lines = matches.map(hit => hit.text);
    return {title: lines[0]?.slice(0, 90) || "", text: lines.join("\n")};
  }, close() { viewer?.destroy(); }};
}
