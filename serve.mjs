import {startReaderHost} from "./reader-host.mjs";

const port = Number(process.env.READER_PORT || 4174);
const webOrigins = (process.env.READER_WEB_ORIGINS ?? "https://funnyarchbishop.github.io")
  .split(",").map(value => value.trim()).filter(Boolean);
const reader = await startReaderHost({port, webOrigins});
console.log("本地阅读器：" + reader.origin);
if (reader.pairingCode) console.log("GitHub 网页版配对码：" + reader.pairingCode);
