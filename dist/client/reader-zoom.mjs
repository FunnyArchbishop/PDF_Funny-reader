const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createPdfZoom(preview) {
  const fit = document.getElementById("pdf-fit");
  const zoom = document.getElementById("pdf-zoom");
  const help = document.getElementById("pdf-zoom-help");
  const dialog = document.getElementById("pdf-detail");
  const title = document.getElementById("pdf-detail-title");
  const body = document.getElementById("pdf-detail-body");
  const status = document.getElementById("pdf-detail-status");
  let sheet, canvas, page, media, drag, selecting, request;
  let fitWidth = true;

  function syncFit() {
    if (canvas && fitWidth) preview.dataset.fit = "width";
    else delete preview.dataset.fit;
    fit.setAttribute("aria-pressed", String(fitWidth));
    fit.title = fitWidth ? "切换到整页显示" : "切换到适合宽度";
  }

  function clearDrag() {
    if (!drag) return;
    const {id, box} = drag;
    drag = undefined;
    box.remove();
    if (preview.hasPointerCapture(id)) preview.releasePointerCapture(id);
  }

  function select(enabled) {
    clearDrag();
    selecting = enabled;
    preview.toggleAttribute("data-selecting", enabled);
    zoom.setAttribute("aria-pressed", String(enabled));
    help.hidden = !enabled;
    if (enabled) preview.focus({preventScroll: true});
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)};
  }

  function between(a, b) {
    return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)};
  }

  function near(x, y) {
    const width = .33, height = .24;
    return {x: clamp(x - width / 2, 0, 1 - width), y: clamp(y - height / 2, 0, 1 - height), width, height};
  }

  async function show(rect) {
    select(false);
    request?.abort();
    const signal = (request = new AbortController()).signal;
    title.textContent = "局部放大 · 第 " + page + " 页";
    status.textContent = "正在放大…";
    body.replaceChildren();
    dialog.showModal();
    try {
      const detail = await media.renderRegion(page - 1, rect, signal);
      signal.throwIfAborted();
      detail.setAttribute("role", "img");
      detail.setAttribute("aria-label", "第 " + page + " 页局部预览");
      body.replaceChildren(detail);
      status.textContent = "";
    } catch (error) {
      if (!signal.aborted) status.textContent = error.message || "无法渲染选区。";
    }
  }

  fit.onclick = () => {
    fitWidth = !fitWidth;
    select(false);
    syncFit();
    preview.scrollTop = 0;
  };
  zoom.onclick = () => select(!selecting);
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    request?.abort();
    body.replaceChildren();
    if (canvas && document.activeElement === preview) zoom.focus({preventScroll: true});
  });
  preview.addEventListener("pointerdown", event => {
    if (!selecting || drag || event.button !== 0 || event.target !== canvas) return;
    event.preventDefault();
    const box = document.createElement("div");
    box.className = "zoom-box";
    box.hidden = true;
    sheet.append(box);
    drag = {id: event.pointerId, start: point(event), box};
    preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener("pointermove", event => {
    if (event.pointerId !== drag?.id) return;
    const rect = between(drag.start, point(event));
    const bounds = canvas.getBoundingClientRect();
    const origin = sheet.getBoundingClientRect();
    drag.box.hidden = false;
    Object.assign(drag.box.style, {
      left: (bounds.left - origin.left + rect.x * bounds.width) + "px",
      top: (bounds.top - origin.top + rect.y * bounds.height) + "px",
      width: (rect.width * bounds.width) + "px",
      height: (rect.height * bounds.height) + "px"
    });
  });
  preview.addEventListener("pointerup", event => {
    if (event.pointerId !== drag?.id) return;
    const end = point(event);
    const rect = between(drag.start, end);
    const bounds = canvas.getBoundingClientRect();
    clearDrag();
    void show(rect.width * bounds.width >= 12 && rect.height * bounds.height >= 12 ? rect : near(end.x, end.y));
  });
  for (const eventName of ["pointercancel", "lostpointercapture"]) {
    preview.addEventListener(eventName, event => { if (event.pointerId === drag?.id) clearDrag(); });
  }
  preview.addEventListener("keydown", event => {
    if (!selecting || !["Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      select(false);
      zoom.focus({preventScroll: true});
    } else {
      const bounds = preview.getBoundingClientRect();
      const center = point({clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2});
      void show(near(center.x, center.y));
    }
  });

  return {
    update(nextMedia, nextPage) {
      request?.abort();
      if (dialog.open) dialog.close();
      select(false);
      media = nextMedia;
      page = nextPage;
      sheet = media?.renderRegion && preview.querySelector(".pdf-sheet");
      canvas = sheet?.querySelector("canvas");
      fit.hidden = zoom.hidden = !canvas;
      syncFit();
      preview.scrollTop = 0;
    }
  };
}
