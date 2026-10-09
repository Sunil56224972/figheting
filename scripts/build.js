import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "dist");
const socketUrl = process.env.LAST_LIGHT_WS_URL?.trim() || "";

if (socketUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(socketUrl);
  } catch {
    throw new Error("LAST_LIGHT_WS_URL must be a valid ws:// or wss:// URL.");
  }
  if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
    throw new Error("LAST_LIGHT_WS_URL must use the ws:// or wss:// protocol.");
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of ["styles.css", "favicon.svg", "src", "shared"]) {
  await cp(resolve(root, file), resolve(output, file), { recursive: true });
}

const sourceHtml = await readFile(resolve(root, "index.html"), "utf8");
const escapedSocketUrl = socketUrl
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const outputHtml = sourceHtml.replace(
  '<meta name="last-light-ws" content="same-origin">',
  `<meta name="last-light-ws" content="${escapedSocketUrl}">`,
);

if (outputHtml === sourceHtml) {
  throw new Error("Could not find the multiplayer URL setting in index.html.");
}

await writeFile(resolve(output, "index.html"), outputHtml);
