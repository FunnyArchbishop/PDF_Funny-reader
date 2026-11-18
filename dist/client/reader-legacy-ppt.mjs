import {parse, PasswordRequiredError, slideText, slideToSvgFile} from "./vendor/legacy-ppt/core.mjs";

const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export async function openLegacyPpt(bytes, host, signal) {
  signal.throwIfAborted();
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, signature.length));
  if (!signature.every((byte, index) => header[index] === byte)) {
    throw new Error("无法读取这份 .ppt，请确认它是 PowerPoint 97–2003 演示文稿。");
  }
  let presentation;
  try {
    presentation = await parse(bytes);
  } catch (error) {
    if (error instanceof PasswordRequiredError) {
      throw new Error("这份 PPT 已加密，请先在 PowerPoint 中解密再导入。");
    }
    throw new Error("无法打开这份旧版 PPT。可在 PowerPoint 中另存为 PPTX 或 PDF 后重试。", {cause: error});
  }
  if (signal.aborted || !presentation.slides.length) {
    presentation.dispose?.();
    signal.throwIfAborted();
    throw new Error("未找到可阅读的页。");
  }

  let currentPage, currentUrl;
  return {
    count: presentation.slides.length,
    text(index) {
      const text = slideText(presentation.slides[index]).trim();
      return {text, title: text.split("\n")[0].slice(0, 90)};
    },
    async render(index, pageSignal) {
      if (index === currentPage) return;
      const svg = await slideToSvgFile(presentation, presentation.slides[index]);
      pageSignal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([svg], {type: "image/svg+xml"}));
      try {
        // As an image, the slide cannot run scripts or activate its links.
        const image = new Image();
        image.className = "legacy-ppt-slide";
        image.alt = "第 " + (index + 1) + " 页幻灯片";
        image.src = url;
        await image.decode();
        pageSignal.throwIfAborted();
        host.replaceChildren(image);
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = url;
      currentPage = index;
    },
    close() {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      presentation.dispose?.();
    }
  };
}
