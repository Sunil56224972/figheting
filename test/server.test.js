import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createGameServer } from "../server.js";

function waitForMessage(peer, type, timeout = 2000, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeout);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== type || !predicate(message)) return;
      clearTimeout(timer);
      peer.off("message", onMessage);
      resolve(message);
    };
    peer.on("message", onMessage);
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const peer = new WebSocket(url);
    peer.once("open", () => resolve(peer));
    peer.once("error", reject);
  });
}

test("HTTP serves the game and private rooms start a two-player match", async (t) => {
  const game = createGameServer();
  await new Promise((resolve) => game.httpServer.listen(0, "127.0.0.1", resolve));
  const address = game.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const socketUrl = `ws://127.0.0.1:${address.port}`;
  const peers = [];

  t.after(async () => {
    for (const peer of peers) peer.close();
    await game.close();
  });

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /LAST LIGHT/);

  const first = await connect(socketUrl);
  peers.push(first);
  const created = waitForMessage(first, "room-created");
  first.send(JSON.stringify({ type: "create-room", code: "NIGHT7" }));
  assert.equal((await created).code, "NIGHT7");

  const second = await connect(socketUrl);
  peers.push(second);
  const waiting = waitForMessage(second, "waiting");
  const firstStarted = waitForMessage(first, "match-started");
  const secondStarted = waitForMessage(second, "match-started");
  second.send(JSON.stringify({ type: "join-room", code: "NIGHT7" }));
  assert.equal((await waiting).code, "NIGHT7");
  assert.equal((await firstStarted).playerIndex, 0);
  assert.equal((await secondStarted).playerIndex, 1);

  const health = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await health.json(), { ok: true, rooms: 1 });

  const movement = waitForMessage(first, "state", 2000, (message) => message.match.fighters[0].x > 326);
  first.send(JSON.stringify({ type: "input", input: { move: 1 } }));
  await movement;
  first.send(JSON.stringify({ type: "input", input: { move: 0 } }));

  const opponentMovement = waitForMessage(second, "state", 2000, (message) => message.match.fighters[1].x < 634);
  second.send(JSON.stringify({ type: "input", input: { move: -1 } }));
  await opponentMovement;
  second.send(JSON.stringify({ type: "input", input: { move: 0 } }));

  game.rooms.get("NIGHT7").match.winner = 0;
  const firstRematch = waitForMessage(first, "match-started");
  const secondRematch = waitForMessage(second, "match-started");
  const firstWaiting = waitForMessage(first, "rematch-waiting");
  const secondWaiting = waitForMessage(second, "rematch-waiting");
  first.send(JSON.stringify({ type: "rematch" }));
  second.send(JSON.stringify({ type: "rematch" }));
  await Promise.all([firstWaiting, secondWaiting]);
  assert.equal((await firstRematch).match.round, 1);
  assert.equal((await secondRematch).match.round, 1);
});
