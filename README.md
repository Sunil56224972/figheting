# Last Light

A handcrafted 2D fighting game set on a rain-soaked late-night train platform. Built with Canvas 2D, a shared deterministic combat simulation, and a small authoritative WebSocket server.

## Run

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open `http://localhost:3000`. Local Duel supports two players on one keyboard:

- P1: `A` / `D` move, `W` jump, `S` crouch, `F` light, `G` heavy, `H` guard.
- P2: arrow keys move, `J` light, `K` heavy, `L` guard.
- First player to win two rounds takes the match.

## Play Online

Both players need to reach the same running server. Click **Find a Friend**, create a room, and share its short code. Your friend opens the same game address and joins that room. Localhost works on one computer; internet matches require hosting this Node server at a publicly reachable address. Private room codes are not accounts or encryption.

The server simulates combat and broadcasts state at 20 updates per second. Keep the server process running for the entire match.

## Deploy to Vercel

Vercel serves the static game build; it does not run `server.js` as the persistent multiplayer server. Deploy this repository with the `Other` framework preset, build command `npm run build`, and output directory `dist` (these settings are also in `vercel.json`).

Local Duel works on Vercel without extra setup. To enable online rooms, run `npm start` on a publicly reachable Node.js host and set the Vercel environment variable `LAST_LIGHT_WS_URL` to that server's WebSocket URL, such as `wss://your-game-server.example.com`. Redeploy after setting it. The room state currently lives in server memory, so use one persistent game-server instance rather than scaling it across serverless instances.

## Checks

```sh
npm test
npm run build
```
