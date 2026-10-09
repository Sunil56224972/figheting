import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, stepMatch, WORLD } from "../shared/combat.js";

test("fighters move with acceleration and stay inside the arena", () => {
  const match = createMatch();
  for (let i = 0; i < 20; i += 1) stepMatch(match, [{ move: 1 }, {}], 1 / 60);
  assert.ok(match.fighters[0].x > 326);

  match.fighters[0].x = WORLD.right;
  for (let i = 0; i < 20; i += 1) stepMatch(match, [{ move: 1 }, {}], 1 / 60);
  assert.equal(match.fighters[0].x, WORLD.right);
});

test("fighters cannot walk through each other on the ground", () => {
  const match = createMatch();
  match.fighters[0].x = 450;
  match.fighters[1].x = 470;
  stepMatch(match, [{}, {}], 1 / 60);
  assert.ok(match.fighters[1].x - match.fighters[0].x >= 38);
});

test("a light attack hits once and applies damage", () => {
  const match = createMatch();
  match.fighters[0].x = 450;
  match.fighters[1].x = 500;
  match.fighters[0].facing = 1;
  const originalHealth = match.fighters[1].health;

  stepMatch(match, [{ light: true }, {}], 1 / 60);
  stepMatch(match, [{ light: false }, {}], 1 / 60);
  for (let i = 0; i < 24; i += 1) stepMatch(match, [{}, {}], 1 / 60);

  assert.equal(match.fighters[1].health, originalHealth - 8);
});

test("a grounded guard reduces incoming damage", () => {
  const match = createMatch();
  match.fighters[0].x = 450;
  match.fighters[1].x = 500;
  match.fighters[0].facing = 1;
  const originalHealth = match.fighters[1].health;

  stepMatch(match, [{ light: true }, { guard: true }], 1 / 60);
  stepMatch(match, [{ light: false }, { guard: true }], 1 / 60);
  for (let i = 0; i < 24; i += 1) stepMatch(match, [{}, { guard: true }], 1 / 60);

  assert.equal(match.fighters[1].health, originalHealth - 2);
});

test("two round wins end the match and a single win resets the next round", () => {
  const match = createMatch();
  match.fighters[1].health = 0;
  stepMatch(match, [{}, {}], 1 / 60);
  assert.equal(match.fighters[0].wins, 1);

  for (let i = 0; i < 70; i += 1) stepMatch(match, [{}, {}], 1 / 30);
  assert.equal(match.round, 2);
  assert.equal(match.fighters[0].health, 100);

  match.fighters[1].health = 0;
  stepMatch(match, [{}, {}], 1 / 60);
  for (let i = 0; i < 70; i += 1) stepMatch(match, [{}, {}], 1 / 30);
  assert.equal(match.winner, 0);
});
