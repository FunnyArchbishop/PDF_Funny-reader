export const needsConnection = document.documentElement.dataset.readerEdition === "pages";
const key = "stdoverwatch-reader:backend-session";
const defaultAddress = "http://127.0.0.1:4174/";
let connection;

function backendAddress(value) {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("请输入 HTTPS 服务地址或本机后端地址。");
  }
  url.pathname = url.pathname.replace(/\/*$/, "/");
  return {base: url.href, localHttp: url.protocol === "http:" && loopback};
}

function pairedCode(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{32}$/i.test(value)) throw new Error("请输入后端窗口显示的配对码。");
  return value;
}

if (needsConnection) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved) connection = {...backendAddress(saved.base), code: pairedCode(saved.code)};
  } catch {}
}

async function fetchBackend(backend, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + backend.code);
  try {
    return await fetch(new URL(path, backend.base), {
      ...init, headers, credentials: "omit", redirect: "error",
      ...(backend.localHttp ? {targetAddressSpace: "loopback"} : {})
    });
  } catch {
    throw new Error("无法连接后端。请检查服务地址、运行状态和浏览器的本地网络权限。");
  }
}

export function apiFetch(path, init) {
  if (!needsConnection) return fetch("./" + path, init);
  if (!connection) throw new Error("请先在「设置」中连接阅读器后端。");
  return fetchBackend(connection, path, init);
}

export function bindReaderConnection() {
  if (!needsConnection) return;
  const $ = id => document.getElementById(id);
  const address = $("backend-address"), code = $("backend-code");
  const connect = $("backend-connect"), disconnect = $("backend-disconnect"), status = $("backend-status");
  address.value = connection?.base || defaultAddress;
  code.value = connection?.code || "";

  function showConnection() {
    status.textContent = connection ? "已配对" : "未连接";
    disconnect.disabled = !connection;
  }

  $("backend-form").onsubmit = async event => {
    event.preventDefault();
    connect.disabled = disconnect.disabled = true;
    status.textContent = "正在连接…";
    try {
      const candidate = {...backendAddress(address.value.trim()), code: pairedCode(code.value.trim())};
      const response = await fetchBackend(candidate, "api/reader/status", {signal: AbortSignal.timeout(10000)});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.readerApi !== 1) throw new Error(data.message || "无法识别阅读器后端，请检查地址。");
      connection = candidate;
      try { sessionStorage.setItem(key, JSON.stringify(connection)); } catch {}
      showConnection();
    } catch (error) { status.textContent = error.message; }
    finally {
      connect.disabled = false;
      disconnect.disabled = !connection;
    }
  };
  disconnect.onclick = () => {
    connection = undefined;
    try { sessionStorage.removeItem(key); } catch {}
    code.value = "";
    showConnection();
  };
  connect.disabled = false;
  showConnection();
}
