import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("Vercel build emits static files and configures the multiplayer server URL", async () => {
  execFileSync(process.execPath, ["scripts/build.js"], {
    cwd: root,
    env: { ...process.env, LAST_LIGHT_WS_URL: "wss://fight.example.test/ws" },
  });

  const output = resolve(root, "dist");
  const html = await readFile(resolve(output, "index.html"), "utf8");
  assert.match(html, /name="last-light-ws" content="wss:\/\/fight\.example\.test\/ws"/);
  await stat(resolve(output, "styles.css"));
  await stat(resolve(output, "src/main.js"));
  await stat(resolve(output, "shared/combat.js"));
  await assert.rejects(stat(resolve(output, "server.js")));
});

test("Vercel build rejects non-WebSocket multiplayer URLs", () => {
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/build.js"], {
      cwd: root,
      env: { ...process.env, LAST_LIGHT_WS_URL: "https://fight.example.test" },
      stdio: "pipe",
    }),
    /LAST_LIGHT_WS_URL must use the ws:\/\/ or wss:\/\//,
  );
});
