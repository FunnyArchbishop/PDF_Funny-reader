import {readToolPdf} from "./reader-media.mjs";

const $ = id => document.getElementById(id);
const api = "./api/pdf-tools/";
const languages = {en: "英语", zh: "简体中文", "zh-TW": "繁体中文", ja: "日语", ko: "韩语", de: "德语", fr: "法语", es: "西班牙语", ru: "俄语"};

async function toolRequest(path, options) {
  const result = await fetch(api + path, options);
  if (!result.ok) {
    const data = await result.json().catch(() => ({}));
    throw new Error(data.message || "PDF 工具暂时不可用。");
  }
  return result;
}

export function createPdfTools({toggleFonts, addFile, backendEnabled = true}) {
  const button = $("pdf-tools"), dialog = $("pdf-tools-dialog"), setup = $("pdf-tools-setup");
  const repair = $("pdf-repair"), translate = $("pdf-translate");
  const from = $("pdf-lang-from"), to = $("pdf-lang-to"), files = $("pdf-translation-files");
  const states = new Map();
  let current, nativeUrl, services;
  for (const [value, label] of Object.entries(languages)) {
    from.add(new Option(label, value));
    to.add(new Option(label, value));
  }
  from.value = "en";
  to.value = "zh";

  function refresh() {
    const state = current?.state;
    $("pdf-tools-status").textContent = state?.status || "";
    repair.disabled = !services?.repair || !current || state.busy;
    translate.disabled = !services?.translate || !current || state.busy;
    translate.textContent = state?.job && !state.ready ? "继续查看进度" : "开始翻译";
    files.hidden = !state?.ready;
    for (const control of files.querySelectorAll("button")) control.disabled = Boolean(state?.busy);
  }

  function note(state, status) {
    state.status = status;
    if (current?.state === state) refresh();
  }

  async function run(action) {
    if (!current || current.state.busy) return;
    const context = current;
    context.state.busy = true;
    refresh();
    try { await action(context); }
    catch (error) { note(context.state, error.message || "处理失败，请重试。"); }
    finally {
      context.state.busy = false;
      if (current?.state === context.state) refresh();
    }
  }

  async function input({deck, file}) {
    if (file?.size > 20 * 1024 * 1024) throw new Error("PDF 工具一次最多处理 20 MB。");
    const blob = await readToolPdf(deck, file, AbortSignal.timeout(60000));
    if (blob.size > 20 * 1024 * 1024) throw new Error("PDF 工具一次最多处理 20 MB。");
    return {method: "POST", headers: {"Content-Type": "application/pdf"}, body: blob};
  }

  async function saveCopy(context, response, label) {
    const blob = await response.blob();
    if (!(await blob.slice(0, 1024).text()).includes("%PDF-")) throw new Error("服务返回的文件不是 PDF。");
    const title = context.deck.title + " · " + label;
    await addFile(new File([blob], title + ".pdf", {type: "application/pdf"}),
      {title, group: "PDF 处理结果"}, current?.state === context.state && dialog.open);
    if (current?.state === context.state && dialog.open) dialog.close();
    note(context.state, label + "已加入课件库。");
  }

  button.onclick = async () => {
    if (!current) return;
    dialog.showModal();
    refresh();
    if (!backendEnabled) return;
    try { services = await (await toolRequest("status")).json(); }
    catch { services = {}; }
    setup.hidden = Boolean(services.repair && services.translate);
    refresh();
  };
  $("pdf-font-mode").onclick = () => {
    dialog.close();
    toggleFonts(current.deck.id);
  };
  repair.onclick = () => void run(async context => {
    note(context.state, "正在用 Stirling‑PDF 修复副本…");
    const result = await toolRequest("repair", await input(context));
    await saveCopy(context, result, "修复版");
  });
  translate.onclick = () => {
    const params = new URLSearchParams({from: from.value, to: to.value});
    void run(async context => {
      const {state} = context;
      note(state, state.job ? "正在读取翻译任务…" : "正在提交 PDFMathTranslate 翻译任务…");
      if (!state.job || state.ready) {
        if (params.get("from") === params.get("to")) throw new Error("请选择不同的原文和译文语言。");
        const result = await toolRequest("translation?" + params, await input(context));
        state.job = (await result.json()).id;
        state.ready = false;
      }
      const until = Date.now() + 20 * 60 * 1000;
      while (Date.now() < until) {
        const progress = await (await toolRequest("translation/" + state.job)).json();
        if (progress.state === "SUCCESS") {
          state.ready = true;
          note(state, "翻译完成。选择双语版或译文版加入课件库。");
          return;
        }
        if (["FAILURE", "REVOKED"].includes(progress.state)) {
          state.job = null;
          throw new Error("翻译服务未完成任务，请检查服务日志后重试。");
        }
        note(state, progress.total > 0 ? "正在翻译 · " + progress.done + " / " + progress.total : "正在排队或翻译…");
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      note(state, "翻译仍在进行。稍后可点「继续查看进度」。");
    });
  };
  files.onclick = event => {
    const format = event.target.closest("button")?.dataset.translation;
    if (format) void run(async context => {
      note(context.state, "正在读取翻译结果…");
      const result = await toolRequest("translation/" + context.state.job + "/" + format);
      await saveCopy(context, result, format === "dual" ? "双语版" : "译文版");
    });
  };

  return {
    get busy() { return Array.from(states.values()).some(state => state.busy); },
    update(deck, file, outlineFonts) {
      if (current?.deck.id === deck?.id && current?.file === file && current?.outlineFonts === outlineFonts) return;
      if (dialog.open) dialog.close();
      if (nativeUrl) URL.revokeObjectURL(nativeUrl);
      nativeUrl = undefined;
      if (deck?.kind === "pdf" && (file || deck.url)) {
        if (!states.has(deck.id)) states.set(deck.id, {busy: false, ready: false, status: ""});
        current = {deck, file, outlineFonts, state: states.get(deck.id)};
        if (file) nativeUrl = URL.createObjectURL(file.type === "application/pdf" ? file : file.slice(0, file.size, "application/pdf"));
        $("pdf-native").href = nativeUrl || deck.url;
        $("pdf-tools-source").textContent = deck.title;
        $("pdf-font-mode").setAttribute("aria-pressed", String(outlineFonts));
      } else current = undefined;
      button.hidden = !current;
      refresh();
    }
  };
}
