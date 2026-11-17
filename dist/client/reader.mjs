import * as db from "./reader-store.mjs";
import {deckRecord, openMedia, readManifest, remoteUrl} from "./reader-media.mjs";
import {makeContext, studyPages} from "./reader-review.mjs";
import {createPdfZoom} from "./reader-zoom.mjs";

const $ = id => document.getElementById(id);
const decks = new Map();
const activity = new Map();
const progress = new Map();
const study = [];
const picked = new Map();
const pendingChat = new Set();
const pageDrafts = new Map();
const textCache = new Map();
const preview = $("preview");
const pdfZoom = createPdfZoom(preview);
let active, view, opening, rendering, selectedStudy, reviewBusy = false, importing = false;
let searchRun, searchMatches;

function node(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text || "";
  if (className) el.className = className;
  return el;
}

function report(id, error) {
  $(id).textContent = error?.message || String(error);
}

function linkTo(deckId, page) {
  return "#read/" + encodeURIComponent(deckId) + "/" + page;
}

function sourceLink(source) {
  const a = node("a", "[" + source.tag + "] " + source.title + " · 第 " + source.page + " 页");
  a.href = linkTo(source.deckId, source.page);
  return a;
}

function showSources(host, sources) {
  host.replaceChildren(...(sources || []).map(sourceLink));
}

function decorateSources(host, sources) {
  const byTag = new Map((sources || []).map(source => [source.tag, source]));
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const text of texts) {
    if (text.parentElement.closest("a, code, pre, math")) continue;
    const parts = text.data.split(/(\[S\d+\])/g);
    if (parts.length === 1) continue;
    text.replaceWith(...parts.map(part => {
      const source = byTag.get(part.slice(1, -1));
      if (!source || !part.startsWith("[")) return part;
      const a = sourceLink(source);
      a.title = a.textContent;
      a.textContent = part;
      return a;
    }));
  }
}

function renderMarkdown(text, host, sources) {
  if (window.renderCourseAnswer) window.renderCourseAnswer(text, host);
  else host.textContent = text;
  decorateSources(host, sources);
}

const keyOf = (deckId, page) => deckId + "/" + page;

function recordFor(deckId, page) {
  const id = keyOf(deckId, page);
  return activity.get(id) || {id, deckId, page, note: "", marked: false, turns: []};
}

async function saveRecord(deckId, page, changes) {
  const record = {...recordFor(deckId, page), ...changes, updated: Date.now()};
  activity.set(record.id, record);
  await db.put("activity", record);
}

function library() {
  const filter = $("deck-search").value.trim().toLowerCase();
  const list = $("deck-list");
  const groupMap = new Map();
  for (const deck of decks.values()) {
    if (!(deck.title + " " + deck.group + " " + deck.name).toLowerCase().includes(filter)) continue;
    if (!groupMap.has(deck.group)) groupMap.set(deck.group, []);
    groupMap.get(deck.group).push(deck);
  }
  const fragment = document.createDocumentFragment();
  for (const [group, items] of groupMap) {
    fragment.append(node("h2", group));
    for (const deck of items) {
      const button = node("button", deck.title);
      button.dataset.deck = deck.id;
      if (active?.id === deck.id) button.setAttribute("aria-current", "true");
      const count = deck.pages?.length || progress.get(deck.id)?.count;
      const label = deck.kind.toUpperCase();
      button.append(node("small", count ? label + " · " + count + " 页" : label));
      fragment.append(button);
    }
  }
  list.replaceChildren(fragment);
  if (!groupMap.size) list.append(node("p", "没有匹配的课件。", "muted"));
  $("deck-count").textContent = decks.size + " 份";
}

async function importFiles(input) {
  if (importing) return;
  importing = true;
  const files = Array.from(input.files);
  input.value = "";
  const manifests = files.filter(file => /\.json$/i.test(file.name));
  const supported = files.filter(file => /\.(pptx|pdf|html?)$/i.test(file.name));
  const byPath = new Map(supported.map(file => [file.webkitRelativePath || file.name, file]));
  const imports = new Map(supported.map(file => [file, {file}]));
  const errors = [];
  let first, added = 0;
  try {
    for (const manifest of manifests) {
      try {
        let base = $("manifest-base").value.trim();
        if (base) base = remoteUrl(base.endsWith("/") ? base : base + "/").href;
        const result = await readManifest(manifest, byPath, base);
        for (const item of result.imports) imports.set(item.file || item.url, item);
        if (result.missing.length) errors.push(result.missing.length + " 个清单路径未找到，请同时导入文件夹或填写清单基址。");
      } catch (error) { errors.push(manifest.name + "：" + error.message); }
    }
    for (const entry of imports.values()) {
      $("library-status").textContent = "正在导入 " + (entry.file?.name || entry.meta.title) + "…";
      try {
        const deck = await deckRecord(entry);
        if (!deck) continue;
        await db.importDeck(deck, entry.file);
        decks.set(deck.id, deck);
        first ||= deck.id;
        added++;
      } catch (error) { errors.push((entry.file?.name || entry.meta?.title) + "：" + error.message); }
    }
    const legacy = files.filter(file => /\.ppt$/i.test(file.name)).length;
    if (legacy) errors.push(legacy + " 个旧版 .ppt 请先另存为 .pptx 或 PDF。");
    $("library-status").textContent = [added ? "已导入 " + added + " 份。" : "没有导入课件。", ...errors.slice(0, 4)].join(" ");
    library();
    if (first) navigate(first, progress.get(first)?.page || 1);
  } finally { importing = false; }
}

function navigate(deckId, page) {
  location.hash = linkTo(deckId, page);
}

function showTab(review, noDeck = false) {
  $("reader-panel").hidden = $("chat-panel").hidden = review || noDeck;
  $("empty-panel").hidden = review || !noDeck;
  $("review-panel").hidden = !review;
  $("ai-settings").hidden = false;
  $("read-tab").removeAttribute("aria-current");
  $("review-tab").removeAttribute("aria-current");
  $(review ? "review-tab" : "read-tab").setAttribute("aria-current", "page");
  if (review) showReview();
}

async function route() {
  const [, encoded, value] = location.hash.slice(1).split("/");
  const recent = [...progress.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  const fallback = decks.get(recent?.id) || decks.values().next().value;
  if (location.hash === "#review") {
    if (!active && fallback) active = {id: fallback.id, page: progress.get(fallback.id)?.page || 1};
    showTab(true);
    return;
  }
  let id;
  try { id = decodeURIComponent(encoded || ""); } catch { id = ""; }
  const deck = decks.get(id) || decks.get(active?.id) || fallback;
  showTab(false, !deck);
  if (!deck) return;
  const page = Number(value) || progress.get(deck.id)?.page || 1;
  if (view && active?.id === deck.id) {
    await showPage(deck, page);
    return;
  }
  if (active?.id === deck.id && opening && !opening.signal.aborted) {
    active.page = page;
    return;
  }
  opening?.abort();
  rendering?.abort();
  pdfZoom.update();
  searchRun?.abort();
  searchMatches = undefined;
  view?.close?.();
  view = undefined;
  opening = new AbortController();
  const signal = opening.signal;
  active = {id: deck.id, page};
  library();
  $("deck-title").textContent = deck.title;
  $("deck-group").textContent = deck.group;
  $("page-search").value = "";
  $("page-search-status").textContent = "";
  $("page-results").replaceChildren();
  $("total").textContent = "";
  $("transcript").textContent = "";
  $("note").value = "";
  $("note").disabled = true;
  $("source-link").hidden = !deck.url;
  $("source-link").href = deck.url || "";
  $("preview-status").textContent = "正在打开课件…";
  for (const id of ["prev", "next", "mark", "include", "full", "page"]) $(id).disabled = true;
  const host = node("div", "", "preview-content");
  preview.replaceChildren(host);
  chat();
  try {
    const file = deck.url ? undefined : (await db.get("files", deck.id))?.file;
    const loaded = await openMedia(deck, file, host, signal);
    if (signal.aborted) { loaded.close?.(); return; }
    view = loaded;
    if (!view.count) throw new Error("未找到可阅读的页。");
    await showPage(deck, active.page);
  } catch (error) {
    if (!signal.aborted) report("preview-status", error);
  } finally {
    if (!signal.aborted) opening = undefined;
  }
}

async function showPage(deck, requested) {
  const media = view;
  const page = Math.min(media.count, Math.max(1, Math.trunc(requested)));
  if (!Number.isFinite(page)) return;
  rendering?.abort();
  rendering = new AbortController();
  const signal = rendering.signal;
  pdfZoom.update();
  const id = keyOf(deck.id, page);
  active = {id: deck.id, page};
  const position = {id: deck.id, page, count: media.count, updated: Date.now()};
  progress.set(deck.id, position);
  db.put("progress", position).catch(error => report("note-status", error));
  $("page").value = page;
  $("page").max = media.count;
  $("total").textContent = "/ " + media.count + " 页";
  $("prev").disabled = page <= 1;
  $("next").disabled = page >= media.count;
  for (const id of ["mark", "include", "page", "full", "note"]) $(id).disabled = false;
  const record = recordFor(deck.id, page);
  $("mark").setAttribute("aria-pressed", String(record.marked));
  $("include").setAttribute("aria-pressed", String(picked.has(id)));
  $("note").value = record.note;
  $("note-status").textContent = "";
  $("transcript").textContent = "";
  $("preview-status").textContent = "正在渲染第 " + page + " 页…";
  pageList();
  chat();
  try {
    await media.render(page - 1, signal);
    signal.throwIfAborted();
    pdfZoom.update(media, page);
    $("preview-status").textContent = media.independent ? "HTML 演示使用其内置翻页。阅读索引显示已提取的文字。" : "";
  } catch (error) { if (!signal.aborted) report("preview-status", error); }
  try {
    signal.throwIfAborted();
    const data = await pageData(deck, page);
    signal.throwIfAborted();
    $("transcript").textContent = data?.text || "本页没有可提取的文字。可在笔记中补充图示信息。";
    pageList();
  } catch (error) { if (!signal.aborted) $("transcript").textContent = error.message; }
}

async function pageData(deck, page, media = active?.id === deck.id ? view : undefined) {
  if (deck.pages) return deck.pages[page - 1];
  const id = keyOf(deck.id, page);
  if (textCache.has(id)) return textCache.get(id);
  if (!media || page > media.count) return;
  const data = await media.text(page - 1);
  if (textCache.size >= 300) textCache.delete(textCache.keys().next().value);
  textCache.set(id, data);
  return data;
}

function pageList() {
  if (!view || !active) return;
  const filter = $("page-search").value.trim().toLowerCase();
  const deck = decks.get(active.id);
  const list = document.createDocumentFragment();
  for (let page = 1; page <= view.count; page++) {
    const data = deck.pages?.[page - 1] || textCache.get(keyOf(deck.id, page));
    const title = "第 " + page + " 页" + (data?.title ? " · " + data.title : "");
    if (filter && !searchMatches?.has(page) &&
        !(title + " " + (data?.text || "")).toLowerCase().includes(filter) && String(page) !== filter) continue;
    const option = node("option", title);
    option.value = page;
    option.selected = page === active.page;
    list.append(option);
  }
  $("page-results").replaceChildren(list);
}

async function searchPages() {
  searchRun?.abort();
  searchMatches = undefined;
  $("page-search-status").textContent = "";
  pageList();
  const filter = $("page-search").value.trim().toLowerCase();
  const deck = decks.get(active?.id);
  const media = view;
  if (!media || deck.pages || !filter || /^\d+$/.test(filter)) return;
  const controller = new AbortController();
  searchRun = controller;
  const {signal} = controller;
  const matches = new Set();
  searchMatches = matches;
  $("page-search-status").textContent = "正在搜索课件全文…";
  try {
    for (let page = 1; page <= media.count; page++) {
      signal.throwIfAborted();
      const data = await pageData(deck, page, media);
      if ((data?.title + " " + data?.text).toLowerCase().includes(filter)) matches.add(page);
      if (page % 12 === 0) {
        pageList();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    signal.throwIfAborted();
    pageList();
    $("page-search-status").textContent = matches.size + " 页包含这个词。";
  } catch (error) {
    if (!signal.aborted) report("page-search-status", error);
  }
}

function chat() {
  if (!active) return;
  const {id: deckId, page} = active;
  const id = keyOf(deckId, page);
  const deck = decks.get(deckId);
  $("chat-context").textContent = picked.size ? "已选 " + picked.size + " 页 · 对话记录保存到当前页"
    : deck.title + " · 第 " + page + " 页";
  const chips = Array.from(picked, ([key, item]) => {
    const chip = node("button", item.title + " · " + item.page + " ×");
    chip.type = "button";
    chip.dataset.removePage = key;
    chip.setAttribute("aria-label", "取消选择 " + item.title + " 第 " + item.page + " 页");
    return chip;
  });
  $("chat-sources").replaceChildren(...chips);
  $("include").setAttribute("aria-pressed", String(picked.has(id)));
  const messages = $("messages");
  messages.replaceChildren();
  for (const turn of recordFor(deckId, page).turns) {
    const question = node("div", "", "message question");
    question.append(node("strong", "你"), node("p", turn.question));
    const answer = node("div", "", "message");
    const body = node("div", "", "slide-answer-body");
    answer.append(node("strong", "DeepSeek"), body);
    renderMarkdown(turn.answer, body, turn.sources);
    messages.append(question, answer);
  }
  if (!messages.childElementCount) messages.append(node("p", "可以从当前页开始，也可以跨课件勾选多页再提问。", "muted"));
  messages.scrollTop = messages.scrollHeight;
  $("question").value = pageDrafts.get(id) || "";
  $("chat-form").querySelector("button").disabled = !view || pendingChat.has(id);
  $("chat-status").textContent = pendingChat.has(id) ? "正在读取课件并生成回答…" : "";
}

async function askAI(payload) {
  const response = await fetch("./api/deepseek", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({...payload, key: $("api-key").value.trim() || undefined})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.answer !== "string") {
    if (result.error === "key_required") $("ai-settings").open = true;
    throw new Error(result.message || "AI 服务不可用，请检查站点连接。");
  }
  return result.answer;
}

async function fillSources(items) {
  const grouped = new Map();
  for (const item of items) {
    const id = item.deck.id;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(item);
  }
  for (const group of grouped.values()) {
    const {deck} = group[0];
    let temporary;
    try {
      if (group.some(item => !deck.pages && !textCache.has(keyOf(deck.id, item.page))) &&
          !(deck.id === active?.id && view)) {
        const file = deck.url ? undefined : (await db.get("files", deck.id))?.file;
        const controller = new AbortController();
        temporary = await openMedia(deck, file, null, controller.signal);
      }
      for (const item of group) item.data = await pageData(deck, item.page, temporary);
    } catch {
      // Keep the user's notes and questions available when a slide cannot be read.
    } finally { temporary?.close?.(); }
  }
  return items.filter(item => item.data || item.record?.note || item.record?.turns?.length);
}

async function submitChat(event) {
  event.preventDefault();
  if (!active || !view) return;
  const {id: deckId, page} = active;
  const id = keyOf(deckId, page);
  const question = $("question").value.trim();
  if (!question || pendingChat.has(id)) return;
  pendingChat.add(id);
  pageDrafts.set(id, question);
  const choices = (picked.size ? Array.from(picked.values()) : [{deckId, page}]).map(item => ({
    deck: decks.get(item.deckId), page: item.page, record: recordFor(item.deckId, item.page)
  }));
  chat();
  let notice = "";
  try {
    const sources = await fillSources(choices);
    const context = makeContext(sources);
    if (sources.length !== choices.length) context.context += "\n部分选页暂时无法读取。";
    const history = recordFor(deckId, page).turns.slice(-3).map(turn => ({
      question: turn.question.slice(0, 1000), answer: turn.answer.slice(0, 2400)
    }));
    const answer = await askAI({question, context: context.context, history, mode: "reader"});
    await saveRecord(deckId, page, {turns: [...recordFor(deckId, page).turns,
      {question, answer, sources: context.sources}].slice(-35)});
    if (pageDrafts.get(id) === question) pageDrafts.delete(id);
  } catch (error) { notice = error.message; }
  finally {
    pendingChat.delete(id);
    if (active.id === deckId && active.page === page) {
      chat();
      $("chat-status").textContent = notice;
    }
  }
}

function allActivity() {
  return [...activity.values()].filter(record => decks.has(record.deckId) &&
    (record.marked || record.note || record.turns.length));
}

function showReview() {
  const records = allActivity().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const activityHost = $("review-activity");
  activityHost.replaceChildren();
  for (const record of records.slice(0, 60)) {
    const item = node("article", "", "activity");
    const source = node("a", decks.get(record.deckId).title + " · 第 " + record.page + " 页");
    source.href = linkTo(record.deckId, record.page);
    item.append(source);
    if (record.marked) item.append(node("p", "已加入复习", "muted"));
    if (record.note) item.append(node("p", record.note));
    if (record.turns.length) item.append(node("p", record.turns.at(-1).question, "muted"));
    activityHost.append(item);
  }
  if (!records.length) activityHost.append(node("p", "标记课件页、记录笔记或向 AI 提问后，会在这里看到记录。", "muted"));
  const picker = $("review-decks");
  const selected = new Set(Array.from(picker.selectedOptions, option => option.value));
  picker.replaceChildren(...Array.from(decks.values(), deck => {
    const option = node("option", deck.group + " / " + deck.title);
    option.value = deck.id;
    option.selected = selected.has(deck.id);
    return option;
  }));
  showStudy(selectedStudy || study[0]);
}

const studyLabels = {outline: "大纲", detail: "详细讲义", quiz: "自测题"};

function showStudy(result) {
  selectedStudy = result;
  $("export").disabled = !result;
  $("expand-outline").hidden = result?.mode !== "outline";
  $("expand-outline").disabled = reviewBusy;
  $("study-tabs").replaceChildren(...study.slice(0, 20).map(entry => {
    const button = node("button", studyLabels[entry.mode] + " · " +
      new Date(entry.created).toLocaleString("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}));
    button.dataset.study = entry.id;
    button.setAttribute("aria-pressed", String(entry === result));
    return button;
  }));
  const output = $("study-output");
  output.replaceChildren();
  showSources($("study-sources"), result?.sources);
  if (!result) { output.append(node("p", "生成的大纲、讲义和自测题会保存在这里。", "muted")); return; }
  if (result.goal) output.append(node("p", "复习要求：" + result.goal, "muted"));
  const body = node("div", "", "study-text slide-answer-body");
  const split = result.mode === "quiz" ? result.answer.match(/^#{1,6}\s*答案与解析\s*$/m) : null;
  if (split) {
    renderMarkdown(result.answer.slice(0, split.index), body, result.sources);
    const details = node("details");
    details.append(node("summary", "查看答案与解析"));
    const answers = node("div");
    renderMarkdown(result.answer.slice(split.index + split[0].length), answers, result.sources);
    details.append(answers);
    body.append(details);
  } else renderMarkdown(result.answer, body, result.sources);
  output.append(body);
}

async function generate(outline) {
  if (reviewBusy) return;
  const scope = $("scope").value;
  const records = allActivity();
  const ids = outline?.deckIds || (scope === "activity" ? [...new Set(records.map(item => item.deckId))]
    : scope === "picked" ? Array.from($("review-decks").selectedOptions, option => option.value)
    : [active?.id]);
  const selected = ids.map(id => decks.get(id)).filter(Boolean);
  if (!selected.length) { $("review-status").textContent = "请先选择课件或添加阅读记录。"; return; }
  const mode = outline ? "detail" : $("review-type").value;
  const goal = $("goal").value.trim() || outline?.goal || "";
  reviewBusy = true;
  $("review-form").querySelector("button.primary").disabled = $("expand-outline").disabled = true;
  $("review-status").textContent = "正在整理课件摘录和阅读记录…";
  try {
    const items = await fillSources(studyPages(selected, records, progress, active));
    if (!items.length) throw new Error("选定的课件暂时没有可用的阅读资料。请先打开课件检查内容。");
    const represented = new Set(items.map(item => item.deck.id));
    const packet = makeContext(items, {review: true, unrepresented: selected.length - represented.size,
      limit: outline ? 6000 : 8400});
    const context = outline ? packet.context + "\n\n待展开的已有大纲（仅作结构参考）：\n" +
      outline.answer.replace(/\[S\d+\]/g, "").slice(0, 2300) : packet.context;
    $("review-status").textContent = "正在生成" + studyLabels[mode] + "…";
    const answer = await askAI({question: goal || "请根据课件和我的阅读记录安排复习。",
      context, mode, history: []});
    const result = {id: crypto.randomUUID(), mode, goal, answer, sources: packet.sources,
      deckIds: ids, created: Date.now()};
    study.unshift(result);
    showStudy(result);
    await db.put("studies", result);
    $("review-status").textContent = "已保存。使用了 " + packet.sources.length + " 页资料。";
  } catch (error) {
    report("review-status", error);
    if ($("ai-settings").open && $("chat-panel").hidden) {
      $("review-status").textContent += " 可在课件阅读页的 AI 设置中填写密钥。";
    }
  } finally {
    reviewBusy = false;
    $("review-form").querySelector("button.primary").disabled = $("expand-outline").disabled = false;
  }
}

function exportStudy() {
  if (!selectedStudy) return;
  const {answer, sources, mode, goal} = selectedStudy;
  const refs = sources.map(source => "- [" + source.tag + "] " + source.title + " · 第 " + source.page + " 页");
  const url = URL.createObjectURL(new Blob(["# " + studyLabels[mode] + "\n\n",
    goal ? "复习要求：" + goal + "\n\n" : "", answer, "\n\n## 参考页\n", refs.join("\n")], {type: "text/markdown;charset=utf-8"}));
  const anchor = node("a");
  anchor.href = url;
  anchor.download = studyLabels[mode] + ".md";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("files").addEventListener("change", event => void importFiles(event.target));
$("folder").addEventListener("change", event => void importFiles(event.target));
$("deck-search").addEventListener("input", library);
$("deck-list").addEventListener("click", event => {
  const id = event.target.closest("button[data-deck]")?.dataset.deck;
  if (id) navigate(id, progress.get(id)?.page || 1);
});
$("read-tab").onclick = () => {
  if (active) navigate(active.id, active.page);
  else if (location.hash) location.hash = "";
  else void route();
};
$("empty-import").onclick = () => $("files").click();
$("review-tab").onclick = () => { location.hash = "#review"; };
$("prev").onclick = () => navigate(active.id, active.page - 1);
$("next").onclick = () => navigate(active.id, active.page + 1);
$("page-form").onsubmit = event => { event.preventDefault(); navigate(active.id, Number($("page").value)); };
$("full").onclick = () => preview.requestFullscreen().catch(error => report("preview-status", error));
$("page-search").oninput = searchPages;
$("page-results").onchange = event => { if (event.target.value) navigate(active.id, Number(event.target.value)); };
$("mark").onclick = async () => {
  const {id, page} = active;
  const marked = !recordFor(id, page).marked;
  $("mark").setAttribute("aria-pressed", String(marked));
  try { await saveRecord(id, page, {marked}); } catch (error) { report("note-status", error); }
};
$("note").oninput = () => {
  const {id, page} = active;
  saveRecord(id, page, {note: $("note").value}).then(() => {
    if (active.id === id && active.page === page) $("note-status").textContent = "已保存";
  }).catch(error => report("note-status", error));
};
$("include").onclick = () => {
  const {id: deckId, page} = active;
  const id = keyOf(deckId, page);
  if (picked.has(id)) picked.delete(id);
  else {
    if (picked.size >= 8) { $("chat-status").textContent = "每次最多选择 8 页。"; return; }
    picked.set(id, {deckId, page, title: decks.get(deckId).title});
  }
  chat();
};
$("chat-sources").onclick = event => {
  const id = event.target.closest("button")?.dataset.removePage;
  if (id) { picked.delete(id); chat(); }
};
$("question").oninput = () => pageDrafts.set(keyOf(active.id, active.page), $("question").value);
$("chat-form").addEventListener("submit", submitChat);
$("scope").onchange = () => { $("review-picker").hidden = $("scope").value !== "picked"; };
$("review-form").onsubmit = event => { event.preventDefault(); void generate(); };
$("expand-outline").onclick = () => void generate(selectedStudy);
$("export").onclick = exportStudy;
$("study-tabs").onclick = event => {
  const id = event.target.closest("button")?.dataset.study;
  if (id) showStudy(study.find(result => result.id === id));
};
document.addEventListener("keydown", event => {
  if ($("reader-panel").hidden || !view || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
  const target = active.page + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0);
  if (target !== active.page && target >= 1 && target <= view.count) { event.preventDefault(); navigate(active.id, target); }
});

try {
  const [files, records, positions, results] = await Promise.all(
    ["decks", "activity", "progress", "studies"].map(db.all));
  files.forEach(deck => decks.set(deck.id, deck));
  records.forEach(record => activity.set(record.id, record));
  positions.forEach(position => progress.set(position.id, position));
  study.push(...results.sort((a, b) => b.created - a.created));
} catch (error) { report("library-status", error); }
library();
window.addEventListener("hashchange", route);
await route();
