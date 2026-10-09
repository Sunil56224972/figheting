import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createMatch, stepMatch } from "./shared/combat.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/favicon.svg", "favicon.svg"],
  ["/src/main.js", "src/main.js"],
  ["/shared/combat.js", "shared/combat.js"],
]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const emptyInput = () => ({ move: 0, jump: false, crouch: false, guard: false, light: false, heavy: false });
const safeSend = (peer, message) => {
  if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify(message));
};

export function createGameServer() {
  const rooms = new Map();
  const peers = new Map();
  const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    const file = publicFiles.get(url.pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    try {
      const contents = await readFile(resolve(root, file));
      response.writeHead(200, {
        "content-type": contentTypes[extname(file)] || "application/octet-stream",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      response.end(contents);
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Unable to read game files");
    }
  });

  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname !== "/" && pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (peer) => wsServer.emit("connection", peer, request));
  });

  function removePeer(peer) {
    const state = peers.get(peer);
    if (!state) return;
    peers.delete(peer);
    if (!state.roomCode) return;
    const room = rooms.get(state.roomCode);
    if (!room) return;
    rooms.delete(state.roomCode);
    for (const other of room.players) {
      if (other && other !== peer) safeSend(other, { type: "opponent-left" });
    }
  }

  function startMatch(room) {
    room.started = true;
    room.match = createMatch();
    room.inputs = [emptyInput(), emptyInput()];
    room.rematch = new Set();
    room.lastTick = performance.now();
    for (let index = 0; index < room.players.length; index += 1) {
      safeSend(room.players[index], { type: "match-started", playerIndex: index, match: room.match });
    }
  }

  function assignRoom(peer, state, message, create) {
    const code = String(message.code || "").toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) {
      safeSend(peer, { type: "error", message: "Room codes must be 4 to 6 letters or numbers." });
      return;
    }
    if (state.roomCode) {
      safeSend(peer, { type: "error", message: "You are already in a room. Reload to reconnect." });
      return;
    }

    let room = rooms.get(code);
    if (create) {
      if (room) {
        safeSend(peer, { type: "error", message: "That room code is already in use. Try another." });
        return;
      }
      room = {
        code,
        players: [peer, null],
        inputs: [emptyInput(), emptyInput()],
        inputReceivedAt: [performance.now(), performance.now()],
        match: null,
        started: false,
        lastTick: performance.now(),
        rematch: new Set(),
      };
      rooms.set(code, room);
      state.roomCode = code;
      state.playerIndex = 0;
      safeSend(peer, { type: "room-created", code });
      return;
    }

    if (!room || room.players[1] || room.started) {
      safeSend(peer, { type: "error", message: "Room not found or already full. Check the code with your friend." });
      return;
    }
    room.players[1] = peer;
    state.roomCode = code;
    state.playerIndex = 1;
    safeSend(peer, { type: "waiting", code });
    startMatch(room);
  }

  wsServer.on("connection", (peer) => {
    const state = { roomCode: "", playerIndex: -1, windowStart: Date.now(), messageCount: 0 };
    peers.set(peer, state);
    peer.on("message", (data) => {
      const now = Date.now();
      if (now - state.windowStart > 1000) {
        state.windowStart = now;
        state.messageCount = 0;
      }
      state.messageCount += 1;
      if (state.messageCount > 90) {
        peer.close(1008, "Rate limit exceeded");
        return;
      }

      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        safeSend(peer, { type: "error", message: "Invalid message." });
        return;
      }
      if (!message || typeof message.type !== "string") {
        safeSend(peer, { type: "error", message: "Invalid message." });
        return;
      }
      if (message.type === "create-room" || message.type === "join-room") {
        assignRoom(peer, state, message, message.type === "create-room");
        return;
      }

      const room = rooms.get(state.roomCode);
      if (!room || !room.started || room.players[state.playerIndex] !== peer) {
        safeSend(peer, { type: "error", message: "Join a room before sending game input." });
        return;
      }
      if (message.type === "input") {
        const input = message.input;
        if (!input || typeof input !== "object") return;
        const move = Number(input.move);
        room.inputs[state.playerIndex] = {
          move: Number.isFinite(move) ? Math.max(-1, Math.min(1, move)) : 0,
          jump: input.jump === true,
          crouch: input.crouch === true,
          guard: input.guard === true,
          light: input.light === true,
          heavy: input.heavy === true,
        };
        room.inputReceivedAt[state.playerIndex] = performance.now();
      } else if (message.type === "rematch" && room.match.winner !== -1) {
        room.rematch.add(state.playerIndex);
        safeSend(peer, { type: "rematch-waiting" });
        if (room.rematch.size === 2) startMatch(room);
      }
    });
    peer.on("close", () => removePeer(peer));
    peer.on("error", () => removePeer(peer));
  });

  const ticker = setInterval(() => {
    const now = performance.now();
    for (const room of rooms.values()) {
      if (!room.started || !room.match) continue;
      const dt = Math.min(0.05, (now - room.lastTick) / 1000);
      room.lastTick = now;
      for (let index = 0; index < room.inputs.length; index += 1) {
        if (now - room.inputReceivedAt[index] > 350) room.inputs[index] = emptyInput();
      }
      stepMatch(room.match, room.inputs, dt);
      if (room.match.tick % 3 === 0) {
        const payload = JSON.stringify({ type: "state", match: room.match });
        for (const peer of room.players) {
          if (peer?.readyState === WebSocket.OPEN) peer.send(payload);
        }
      }
    }
  }, 1000 / 60);
  ticker.unref();

  return {
    httpServer,
    rooms,
    async close() {
      clearInterval(ticker);
      for (const peer of wsServer.clients) peer.terminate();
      await new Promise((resolveClose) => wsServer.close(resolveClose));
      if (httpServer.listening) {
        await new Promise((resolveClose, reject) => httpServer.close((error) => error ? reject(error) : resolveClose()));
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const game = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  game.httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Last Light is running at http://localhost:${port}`);
    console.log("For online friends, expose this server over the Internet and share the same address.");
  });
  const shutdown = async () => {
    await game.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
