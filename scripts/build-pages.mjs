import {execFileSync} from "node:child_process";
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw new Error("Usage: node scripts/build-pages.mjs <empty-output-folder>");
const output = resolve(process.argv[2]);
mkdirSync(output, {recursive: true});
if (readdirSync(output).length) throw new Error("The Pages output folder must be empty.");

// Only publish the committed client tree. Local uploads and service files stay outside it.
const sourceTree = "HEAD:dist/client";
const tree = execFileSync("git", ["ls-tree", "-r", "-z", sourceTree], {cwd: repo}).toString("utf8");
for (const entry of tree.split("\0").filter(Boolean)) {
  const [object, name] = entry.split("\t", 2);
  if (!/^100(?:644|755) blob /.test(object) ||
      /(?:^|\/)(?:\.env|\.dev\.vars)(?:[./]|$)|\.(?:pdf|pem|key)$/i.test(name)) {
    throw new Error("Unexpected file in the published client tree: " + name);
  }
}
const archive = execFileSync("git", ["archive", "--format=tar", sourceTree], {cwd: repo, maxBuffer: 32 * 1024 * 1024});
const tar = process.platform === "win32" && process.env.SystemRoot
  ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
execFileSync(tar, ["-xf", "-", "-C", output], {input: archive});

const index = join(output, "index.html");
const html = readFileSync(index, "utf8");
const marker = 'data-reader-edition="full"';
if (!html.includes(marker)) throw new Error("The Pages edition marker was not found.");
writeFileSync(index, html.replace(marker, 'data-reader-edition="pages"'));
writeFileSync(join(output, ".nojekyll"), "");
console.log("GitHub Pages files: " + output);
