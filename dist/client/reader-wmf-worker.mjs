import {convertMetafile} from "./vendor/metafile/browser.mjs";

self.onmessage = async ({data}) => {
  try {
    const language = navigator.language.toLowerCase();
    const image = await convertMetafile(data, {
      format: "png", dpiScale: 4, maxWidth: 1600, maxHeight: 1600, maxCanvasDimension: 1600, maxRecords: 150000,
      wmfAnsiCodePage: /^zh-(tw|hk|mo|hant)/.test(language) ? 950 : language.startsWith("zh") ? 936 : undefined
    });
    if (!image) throw new Error("No drawable WMF content");
    self.postMessage(image.data, [image.data.buffer]);
  } catch { self.postMessage(null); }
};
