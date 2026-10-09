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

## Checks

```sh
npm test
```
