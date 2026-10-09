export const WORLD = {
  width: 960,
  height: 540,
  floor: 414,
  left: 86,
  right: 874,
};

export const BUTTONS = ["jump", "crouch", "guard", "light", "heavy"];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function makeFighter(x, facing, palette) {
  return {
    x,
    y: WORLD.floor,
    vx: 0,
    vy: 0,
    facing,
    health: 100,
    wins: 0,
    palette,
    grounded: true,
    attack: "",
    attackT: 0,
    attackHit: false,
    stun: 0,
    flash: 0,
    pose: "idle",
    previousLight: false,
    previousHeavy: false,
  };
}

export function createMatch() {
  return {
    fighters: [
      makeFighter(326, 1, 0),
      makeFighter(634, -1, 1),
    ],
    time: 60,
    round: 1,
    roundOver: 0,
    roundWinner: -1,
    winner: -1,
    tick: 0,
  };
}

function resetRound(match) {
  const [left, right] = match.fighters;
  for (const fighter of [left, right]) {
    fighter.y = WORLD.floor;
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.health = 100;
    fighter.grounded = true;
    fighter.attack = "";
    fighter.attackT = 0;
    fighter.attackHit = false;
    fighter.stun = 0;
    fighter.flash = 0;
    fighter.pose = "idle";
    fighter.previousLight = false;
    fighter.previousHeavy = false;
  }
  left.x = 326;
  right.x = 634;
  left.facing = 1;
  right.facing = -1;
  match.time = 60;
  match.roundOver = 0;
  match.roundWinner = -1;
}

function attackSpec(kind) {
  return kind === "heavy"
    ? { duration: 0.46, start: 0.20, end: 0.31, damage: 15, reach: 86, push: 325 }
    : { duration: 0.31, start: 0.075, end: 0.17, damage: 8, reach: 69, push: 215 };
}

function resolveAttack(attacker, defender) {
  if (!attacker.attack || attacker.attackHit) return false;
  const spec = attackSpec(attacker.attack);
  if (attacker.attackT < spec.start || attacker.attackT > spec.end) return false;

  const direction = Math.sign(defender.x - attacker.x) || attacker.facing;
  const inRange = Math.abs(defender.x - attacker.x) <= spec.reach;
  const heightMatches = Math.abs(defender.y - attacker.y) < 72;
  if (!inRange || !heightMatches || attacker.facing !== direction) return false;

  attacker.attackHit = true;
  const guarded = defender.pose === "guard" && defender.grounded;
  defender.health = Math.max(0, defender.health - (guarded ? Math.ceil(spec.damage * 0.2) : spec.damage));
  defender.vx = direction * (guarded ? spec.push * 0.22 : spec.push);
  defender.vy = guarded ? -34 : -96;
  defender.stun = guarded ? 0.12 : 0.34;
  defender.flash = 0.12;
  defender.grounded = false;
  defender.pose = guarded ? "guard" : "hit";
  return !guarded;
}

function separateFighters(left, right) {
  if (Math.abs(left.y - right.y) > 64) return;
  const delta = right.x - left.x;
  const overlap = 38 - Math.abs(delta);
  if (overlap <= 0) return;
  const direction = delta >= 0 ? 1 : -1;
  left.x = clamp(left.x - direction * overlap * 0.5, WORLD.left, WORLD.right);
  right.x = clamp(right.x + direction * overlap * 0.5, WORLD.left, WORLD.right);
  if (left.vx * direction > 0) left.vx = 0;
  if (right.vx * -direction > 0) right.vx = 0;
}

function updateFighter(fighter, opponent, input, dt, allowInput) {
  const move = allowInput ? clamp(input.move || 0, -1, 1) : 0;
  const light = Boolean(input.light);
  const heavy = Boolean(input.heavy);
  const lightPressed = light && !fighter.previousLight;
  const heavyPressed = heavy && !fighter.previousHeavy;
  fighter.previousLight = light;
  fighter.previousHeavy = heavy;
  fighter.flash = Math.max(0, fighter.flash - dt);
  fighter.stun = Math.max(0, fighter.stun - dt);

  if (fighter.x !== opponent.x && !fighter.attack) {
    fighter.facing = opponent.x > fighter.x ? 1 : -1;
  }

  if (fighter.attack) {
    fighter.attackT += dt;
    if (fighter.attackT >= attackSpec(fighter.attack).duration) {
      fighter.attack = "";
      fighter.attackT = 0;
      fighter.attackHit = false;
    }
  }

  if (allowInput && fighter.stun <= 0 && !fighter.attack) {
    const canStart = fighter.grounded && !input.guard && !input.crouch;
    if (canStart && heavyPressed) {
      fighter.attack = "heavy";
      fighter.attackT = 0;
      fighter.attackHit = false;
    } else if (canStart && lightPressed) {
      fighter.attack = "light";
      fighter.attackT = 0;
      fighter.attackHit = false;
    }
  }

  const locked = fighter.stun > 0 || Boolean(fighter.attack);
  const guarding = allowInput && input.guard && fighter.grounded && !locked;
  const crouching = allowInput && input.crouch && fighter.grounded && !locked;
  if (!locked && !guarding && !crouching) {
    fighter.vx += move * (fighter.grounded ? 1050 : 520) * dt;
    fighter.vx = clamp(fighter.vx, -270, 270);
  } else if (guarding || crouching) {
    fighter.vx *= Math.max(0, 1 - dt * 12);
  }
  if (allowInput && input.jump && fighter.grounded && !locked) {
    fighter.vy = -510;
    fighter.grounded = false;
  }

  fighter.vx *= Math.pow(fighter.grounded ? 0.0008 : 0.14, dt);
  fighter.x = clamp(fighter.x + fighter.vx * dt, WORLD.left, WORLD.right);
  fighter.y += fighter.vy * dt;
  fighter.vy += 1320 * dt;
  if (fighter.y >= WORLD.floor) {
    fighter.y = WORLD.floor;
    fighter.vy = 0;
    fighter.grounded = true;
  }

  if (fighter.stun > 0) fighter.pose = "hit";
  else if (fighter.attack) fighter.pose = fighter.attack;
  else if (guarding) fighter.pose = "guard";
  else if (crouching) fighter.pose = "crouch";
  else if (!fighter.grounded) fighter.pose = "jump";
  else if (Math.abs(fighter.vx) > 22) fighter.pose = "walk";
  else fighter.pose = "idle";
}

export function stepMatch(match, inputs, rawDt) {
  if (match.winner !== -1) return match;
  const dt = clamp(rawDt, 0, 1 / 20);
  match.tick += 1;

  if (match.roundOver > 0) {
    match.roundOver = Math.max(0, match.roundOver - dt);
    if (match.roundOver === 0) {
      if (match.fighters.some((fighter) => fighter.wins >= 2)) {
        match.winner = match.fighters.findIndex((fighter) => fighter.wins >= 2);
      } else {
        match.round += 1;
        resetRound(match);
      }
    }
    return match;
  }

  match.time = Math.max(0, match.time - dt);
  const [left, right] = match.fighters;
  updateFighter(left, right, inputs[0] || {}, dt, true);
  updateFighter(right, left, inputs[1] || {}, dt, true);
  separateFighters(left, right);

  const leftHit = resolveAttack(left, right);
  const rightHit = resolveAttack(right, left);
  if (leftHit || rightHit) {
    left.flash = leftHit ? 0 : left.flash;
    right.flash = rightHit ? 0 : right.flash;
  }

  const isOver = left.health <= 0 || right.health <= 0 || match.time <= 0;
  if (isOver) {
    const winner = left.health === right.health
      ? -1
      : left.health > right.health ? 0 : 1;
    match.roundWinner = winner;
    if (winner >= 0) match.fighters[winner].wins += 1;
    match.roundOver = 2.2;
  }
  return match;
}
