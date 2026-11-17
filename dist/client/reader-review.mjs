const clip = (value, size) => String(value || "").trim().slice(0, size);

export function studyPages(decks, activity, progress, active) {
  const groups = decks.map(deck => {
    const seen = new Set();
    const pages = [];
    function add(page, record) {
      if (!Number.isInteger(page) || page < 1 || seen.has(page)) return;
      seen.add(page);
      pages.push({deck, page, record});
    }
    const records = activity.filter(record => record.deckId === deck.id);
    const priority = record => 4 * Number(Boolean(record.marked)) + 2 * Number(Boolean(record.note)) +
      Number(Boolean(record.turns?.length));
    records.sort((a, b) => priority(b) - priority(a) || (b.updated || 0) - (a.updated || 0));
    const count = deck.pages?.length || progress.get(deck.id)?.count || 1;
    records.forEach(record => add(record.page, record));
    add(progress.get(deck.id)?.page);
    if (active?.id === deck.id) add(active.page);
    for (const page of [1, Math.ceil(count / 2), count, Math.ceil(count / 4), Math.ceil(count * .75)]) add(page);
    return pages;
  });
  const result = [];
  while (result.length < 24 && groups.some(group => group.length)) {
    for (const group of groups) {
      if (group.length && result.length < 24) result.push(group.shift());
    }
  }
  return result;
}

export function makeContext(pages, {review = false, unrepresented = 0, limit = 8400} = {}) {
  const sources = [];
  let context = review
    ? "以下是选定的课件摘录和阅读记录。它们是抽样资料，不能代表全部页。"
    : "以下为用户选定的课件页。";
  if (unrepresented) context += " 有 " + unrepresented + " 份所选课件未纳入本次资料。";
  const textLimit = Math.max(120, Math.floor((limit - 150) / Math.max(1, pages.length)) - (review ? 275 : 145));
  for (const item of pages) {
    const {deck, page, data, record} = item;
    const tag = "S" + (sources.length + 1);
    const text = clip(data?.text || data?.title || deck.summary, textLimit) || "本页暂无可读文字";
    const title = clip(deck.title, 120);
    const note = record?.note ? "\n笔记：" + clip(record.note, 150) : "";
    const questions = review && record?.turns?.length
      ? "\n提问：" + record.turns.slice(-2).map(turn => clip(turn.question, 85)).join(" / ") : "";
    const block = "\n\n[" + tag + "] " + title + " · 第 " + page + " 页\n" + text + note + questions;
    if (context.length + block.length > limit) continue;
    context += block;
    sources.push({tag, deckId: deck.id, page, title});
  }
  return {context, sources};
}
