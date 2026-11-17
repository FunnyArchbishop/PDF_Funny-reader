const limit = 20 * 1024 * 1024;
const taskId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const languages = new Set(["en", "zh", "zh-TW", "ja", "ko", "de", "fr", "es", "ru"]);
const responseHeaders = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
const json = (data, status = 200) => Response.json(data, {status, headers: responseHeaders});
const failure = (status, message) => json({message}, status);

function endpoint(base, path, local) {
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))) return null;
    url.pathname = url.pathname.replace(/\/+$/, "") + path;
    return url;
  } catch { return null; }
}

async function pdfInput(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/pdf") || !request.body) {
    return failure(415, "请选择 PDF 文件。");
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return failure(413, "PDF 工具一次最多处理 20 MB。"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const blob = new Blob(chunks, {type: "application/pdf"});
  if (!(await blob.slice(0, 1024).text()).includes("%PDF-")) return failure(415, "文件不是可识别的 PDF。");
  return blob;
}

function fetchTool(url, options = {}) {
  return fetch(url, {...options, redirect: "error", signal: AbortSignal.timeout(90000)});
}

function outputPdf(result) {
  const type = result.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!result.ok || !result.body || !["application/pdf", "application/octet-stream"].includes(type)) {
    void result.body?.cancel().catch(() => {});
    return failure(502, "PDF 工具没有返回可用的 PDF 文件，请检查服务配置。");
  }
  return new Response(result.body, {headers: {...responseHeaders, "Content-Type": "application/pdf"}});
}

export async function handlePdfTools(request, env, local = false, allowedOrigin = new URL(request.url).origin) {
  if (!local && !request.headers.get("oai-authenticated-user-id")) return failure(401, "请先登录阅读器。");
  const url = new URL(request.url);
  const base = "/api/pdf-tools";
  const path = url.pathname.slice(base.length);
  const repair = endpoint(env.STIRLING_PDF_URL, "/api/v1/misc/repair", local);
  const translate = endpoint(env.PDFMATH_TRANSLATE_URL, "/v1/translate", local);
  if (path === "/status" && request.method === "GET") return json({repair: Boolean(repair), translate: Boolean(translate)});

  try {
    if (request.method === "POST" && (path === "/repair" || path === "/translation")) {
      if (request.headers.get("origin") !== allowedOrigin) return failure(403, "请从阅读器提交 PDF。");
      const destination = path === "/repair" ? repair : translate;
      if (!destination) return failure(503, "这个 PDF 服务尚未配置。");
      const input = await pdfInput(request);
      if (input instanceof Response) return input;
      const body = new FormData();
      if (path === "/repair") {
        body.append("fileInput", input, "document.pdf");
        const headers = env.STIRLING_PDF_KEY ? {"X-API-KEY": env.STIRLING_PDF_KEY} : {};
        return outputPdf(await fetchTool(repair, {method: "POST", body, headers}));
      }
      const from = url.searchParams.get("from"), to = url.searchParams.get("to");
      if (!languages.has(from) || !languages.has(to) || from === to) return failure(400, "请选择不同的原文和译文语言。");
      body.append("file", input, "document.pdf");
      body.append("data", JSON.stringify({lang_in: from, lang_out: to,
        service: env.PDFMATH_TRANSLATE_SERVICE || "google", thread: 4}));
      const headers = env.PDFMATH_TRANSLATE_TOKEN ? {Authorization: "Bearer " + env.PDFMATH_TRANSLATE_TOKEN} : {};
      const result = await fetchTool(translate, {method: "POST", body, headers});
      const job = result.ok ? await result.json() : null;
      return typeof job?.id === "string" && taskId.test(job.id) ? json({id: job.id}, 202)
        : failure(502, "PDFMathTranslate 未接受翻译任务，请检查服务配置。");
    }
    const [root, id, format, ...rest] = path.slice(1).split("/");
    if (request.method !== "GET" || root !== "translation" || !taskId.test(id || "") ||
        (format !== undefined && !["mono", "dual"].includes(format)) || rest.length) {
      return failure(404, "找不到这个 PDF 操作。");
    }
    if (!translate) return failure(503, "PDFMathTranslate 尚未配置。");
    translate.pathname += "/" + id + (format ? "/" + format : "");
    const headers = env.PDFMATH_TRANSLATE_TOKEN ? {Authorization: "Bearer " + env.PDFMATH_TRANSLATE_TOKEN} : {};
    const result = await fetchTool(translate, {headers});
    if (format) return outputPdf(result);
    if (!result.ok) return failure(502, "暂时无法读取翻译进度。");
    const task = await result.json();
    const state = typeof task.state === "string" ? task.state.toUpperCase() : "PENDING";
    return json({state, done: Number(task.info?.n) || 0, total: Number(task.info?.total) || 0});
  } catch {
    return failure(502, "连接 PDF 服务失败或超时，请检查服务是否已启动。");
  }
}
