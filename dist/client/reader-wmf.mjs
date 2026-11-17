const maxImageBytes = 8 * 1024 * 1024;

function convert(data, signal) {
  return new Promise(resolve => {
    if (signal.aborted || !data.length || data.length > maxImageBytes) { resolve(null); return; }
    let worker;
    try { worker = new Worker(new URL("./reader-wmf-worker.mjs", import.meta.url), {type: "module"}); }
    catch { resolve(null); return; }
    const cancel = () => finish(null);
    const timeout = setTimeout(cancel, 6000);
    function finish(result) {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(result);
    }
    signal.addEventListener("abort", cancel, {once: true});
    worker.onmessage = event => finish(event.data instanceof Uint8Array ? event.data : null);
    worker.onerror = cancel;
    const copy = data.slice();
    try { worker.postMessage(copy, [copy.buffer]); }
    catch { cancel(); }
  });
}

export function prepareWmfPreviews(files) {
  const aliases = new Map();
  const originals = new Map();
  const nonce = crypto.getRandomValues(new Uint32Array(2)).join("_");
  for (const records of [files.slideRels, files.slideLayoutRels, files.slideMasterRels, files.chartRels]) {
    for (const [part, text] of records || []) {
      if (!/(?:\.|%2e)wmf/i.test(text)) continue;
      const xml = new DOMParser().parseFromString(text, "application/xml");
      let edited = false;
      for (const relationship of xml.getElementsByTagNameNS("*", "Relationship")) {
        const target = relationship.getAttribute("Target") || "";
        if (relationship.getAttribute("TargetMode")?.toLowerCase() === "external" ||
            !relationship.getAttribute("Type")?.endsWith("/image") || !/(?:\.|%2e)wmf$/i.test(target)) continue;
        if (!originals.has(target)) {
          const alias = "__reader_wmf_" + nonce + "_" + originals.size + ".png";
          originals.set(target, alias);
          aliases.set(alias, target);
        }
        relationship.setAttribute("Target", "../media/" + originals.get(target));
        edited = true;
      }
      if (edited) records.set(part, new XMLSerializer().serializeToString(xml));
    }
  }

  const controller = new AbortController();
  const cache = new Map();
  let queue = Promise.resolve();
  const source = files.mediaResolver;
  if (source && aliases.size) files.mediaResolver = {
    async resolve(target) {
      const alias = target.split("/").at(-1);
      const original = aliases.get(alias);
      if (!original) return source.resolve(target);
      if (!cache.has(alias)) {
        const task = queue.then(async () => {
          if (controller.signal.aborted) return null;
          const media = await source.resolve(original);
          return media ? convert(media.data, controller.signal) : null;
        }).catch(() => null);
        cache.set(alias, task);
        queue = task;
      }
      const data = await cache.get(alias);
      if (data) return {mediaPath: "ppt/media/" + alias, data};
    }
  };
  return () => { controller.abort(); cache.clear(); };
}
