import { createMatch, stepMatch, WORLD } from "/shared/combat.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#game");
const ctx = canvas.getContext("2d");
const hud = $("#hud");
const menu = $("#menu-overlay");
const lobby = $("#lobby-overlay");
const ending = $("#end-overlay");
const touchControls = $("#touch-controls");
const keys = new Set();
const touchKeys = new Set();
const particles = [];
const palette = [
  { coat: "#536e5b", shade: "#30463d", light: "#91b28a", accent: "#e9b961", skin: "#c78e6c", hair: "#252c29" },
  { coat: "#8d5141", shade: "#5f3934", light: "#c27659", accent: "#d4bd8a", skin: "#d6a37c", hair: "#242329" },
];

let mode = "menu";
let match = createMatch();
let previousHealth = [100, 100];
let chipHealth = [100, 100];
let lastFrame = performance.now();
let hitStop = 0;
let socket = null;
let localRoomCode = "";
let soundEnabled = true;
let audioContext = null;
let ambience = null;
let myPlayerIndex = 0;
let networkPrevious = null;
let networkCurrent = null;
let networkUpdatedAt = 0;

const keyMap = {
  KeyA: [0, "left"], KeyD: [0, "right"], KeyW: [0, "jump"], KeyS: [0, "crouch"],
  KeyF: [0, "light"], KeyG: [0, "heavy"], KeyH: [0, "guard"],
  ArrowLeft: [1, "left"], ArrowRight: [1, "right"], ArrowUp: [1, "jump"], ArrowDown: [1, "crouch"],
  KeyJ: [1, "light"], KeyK: [1, "heavy"], KeyL: [1, "guard"],
};

function startAudio() {
  if (!soundEnabled) return;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) return;
  if (!audioContext) audioContext = new AudioEngine();
  if (audioContext.state === "suspended") audioContext.resume();
}

function tone(frequency, duration, type = "sine", volume = 0.08, slide = 0) {
  if (!soundEnabled) return;
  startAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(25, frequency + slide), now + duration);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function noise(duration, volume, highpass = 500) {
  if (!soundEnabled) return;
  startAudio();
  if (!audioContext) return;
  const count = Math.max(1, Math.floor(audioContext.sampleRate * duration));
  const buffer = audioContext.createBuffer(1, count, audioContext.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < count; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / count);
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  filter.type = "highpass";
  filter.frequency.value = highpass;
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start();
}

function playAttack(kind) {
  if (kind === "heavy") {
    tone(170, 0.19, "sawtooth", 0.055, -95);
    noise(0.13, 0.035, 1000);
  } else {
    tone(270, 0.105, "triangle", 0.04, -130);
    noise(0.075, 0.025, 1500);
  }
}

function playImpact(heavy = false) {
  tone(heavy ? 92 : 132, heavy ? 0.22 : 0.15, "triangle", heavy ? 0.15 : 0.11, -45);
  noise(heavy ? 0.2 : 0.13, heavy ? 0.15 : 0.11, 180);
  tone(heavy ? 720 : 980, 0.06, "square", 0.028, -510);
}

function ensureAmbience() {
  if (!soundEnabled || ambience) return;
  startAudio();
  if (!audioContext) return;
  const output = audioContext.createGain();
  output.gain.value = 0.035;
  output.connect(audioContext.destination);
  const low = audioContext.createOscillator();
  const high = audioContext.createOscillator();
  const filter = audioContext.createBiquadFilter();
  const wobble = audioContext.createOscillator();
  const wobbleGain = audioContext.createGain();
  low.type = "sine";
  low.frequency.value = 54;
  high.type = "triangle";
  high.frequency.value = 82;
  filter.type = "lowpass";
  filter.frequency.value = 230;
  wobble.frequency.value = 0.12;
  wobbleGain.gain.value = 22;
  wobble.connect(wobbleGain).connect(filter.frequency);
  low.connect(filter);
  high.connect(filter);
  filter.connect(output);
  low.start();
  high.start();
  wobble.start();
  ambience = { output, nodes: [low, high, wobble] };
}

function stopAmbience() {
  if (ambience && audioContext) {
    const current = ambience;
    current.output.gain.setTargetAtTime(0, audioContext.currentTime, 0.12);
    window.setTimeout(() => {
      for (const node of current.nodes) {
        try { node.stop(); } catch {}
        node.disconnect();
      }
      current.output.disconnect();
    }, 500);
    ambience = null;
  }
}

function setSound(enabled) {
  soundEnabled = enabled;
  $("#sound-toggle").classList.toggle("is-muted", !enabled);
  $("#sound-label").textContent = enabled ? "SOUND ON" : "SOUND OFF";
  if (enabled) {
    startAudio();
    if (mode === "local" || mode === "online") ensureAmbience();
  } else {
    stopAmbience();
  }
}

function drawBackground(time) {
  const width = WORLD.width;
  const height = WORLD.height;
  const sky = ctx.createLinearGradient(0, 0, 0, 385);
  sky.addColorStop(0, "#172932");
  sky.addColorStop(0.45, "#304046");
  sky.addColorStop(0.76, "#72564d");
  sky.addColorStop(1, "#be8060");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const distantGlow = ctx.createRadialGradient(630, 274, 10, 630, 274, 310);
  distantGlow.addColorStop(0, "#f0b77937");
  distantGlow.addColorStop(1, "#e7b07a00");
  ctx.fillStyle = distantGlow;
  ctx.fillRect(250, 40, 650, 365);

  ctx.fillStyle = "#e5c796";
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(733, 104, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#b4a085";
  ctx.beginPath();
  ctx.arc(746, 95, 27, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 24; i += 1) {
    const x = (i * 73 + 13) % 930;
    const y = 87 + ((i * 41) % 206);
    const flicker = 0.28 + (Math.sin(time * 0.0011 + i * 7) + 1) * 0.13;
    ctx.fillStyle = i % 4 === 0 ? `rgba(232,183,112,${flicker})` : `rgba(167,196,190,${flicker * 0.6})`;
    ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, 2);
  }

  drawSkyline(time);
  drawStation(time);
  drawRain(time);
  drawPlatform();
}

function drawSkyline(time) {
  const buildings = [
    { x: 0, w: 95, h: 135 }, { x: 72, w: 126, h: 185 }, { x: 172, w: 87, h: 129 },
    { x: 237, w: 125, h: 214 }, { x: 337, w: 105, h: 158 }, { x: 423, w: 140, h: 199 },
    { x: 537, w: 105, h: 144 }, { x: 622, w: 142, h: 205 }, { x: 740, w: 92, h: 155 },
    { x: 811, w: 149, h: 192 },
  ];
  for (let i = 0; i < buildings.length; i += 1) {
    const building = buildings[i];
    const top = 333 - building.h;
    ctx.fillStyle = i % 2 === 0 ? "#263337" : "#303b3b";
    ctx.fillRect(building.x, top, building.w, building.h);
    ctx.fillStyle = "#171f22";
    ctx.fillRect(building.x + 5, top + 7, building.w - 10, 3);
    for (let row = 0; row < Math.floor(building.h / 18); row += 1) {
      for (let col = 0; col < Math.floor(building.w / 13); col += 1) {
        const lit = (row * 3 + col * 7 + i * 5) % 9;
        if (lit > 3) continue;
        const flicker = 0.28 + (Math.sin(time * 0.001 + row * 3 + col + i) + 1) * 0.16;
        ctx.fillStyle = lit === 1
          ? `rgba(230,173,105,${flicker})`
          : `rgba(158,192,179,${flicker * 0.78})`;
        ctx.fillRect(building.x + 12 + col * 13, top + 18 + row * 18, 5, 8);
      }
    }
    ctx.fillStyle = "#1b2527";
    ctx.fillRect(building.x + building.w * 0.6, top - 12, 3, 12);
  }

  ctx.fillStyle = "#283337";
  ctx.fillRect(0, 320, WORLD.width, 91);
  ctx.fillStyle = "#374044";
  ctx.fillRect(0, 325, WORLD.width, 5);
  ctx.fillStyle = "#7d6d5d";
  ctx.fillRect(0, 329, WORLD.width, 2);

  const signGlow = ctx.createRadialGradient(483, 264, 2, 483, 264, 98);
  signGlow.addColorStop(0, "#e8a45a2c");
  signGlow.addColorStop(1, "#e8a45a00");
  ctx.fillStyle = signGlow;
  ctx.fillRect(380, 170, 210, 180);
  ctx.fillStyle = "#253033";
  ctx.fillRect(408, 226, 154, 47);
  ctx.fillStyle = "#d6b681";
  ctx.fillRect(408, 226, 154, 2);
  ctx.fillStyle = "#151c1e";
  ctx.fillRect(414, 232, 142, 35);
  ctx.fillStyle = "#edc676";
  ctx.font = "500 10px 'DM Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("EASTBOUND  /  LAST TRAIN", 485, 247);
  ctx.fillStyle = "#91ba9b";
  ctx.font = "500 7px 'DM Mono', monospace";
  ctx.fillText("PLATFORM 04     01:47", 485, 260);
  ctx.textAlign = "left";
}

function drawStation(time) {
  ctx.fillStyle = "#1b2427";
  ctx.fillRect(0, 300, WORLD.width, 36);
  ctx.fillStyle = "#414345";
  ctx.fillRect(0, 300, WORLD.width, 4);
  ctx.fillStyle = "#82705a";
  ctx.fillRect(0, 304, WORLD.width, 2);

  for (let i = 0; i < 8; i += 1) {
    const x = 28 + i * 133;
    const glow = 0.44 + (Math.sin(time * 0.0016 + i * 5) + 1) * 0.12;
    ctx.fillStyle = "#32393a";
    ctx.fillRect(x, 80, 12, 251);
    ctx.fillStyle = "#20292b";
    ctx.fillRect(x + 7, 80, 8, 251);
    ctx.fillStyle = `rgba(238,191,123,${glow})`;
    ctx.fillRect(x - 3, 168, 4, 64);
    ctx.fillStyle = "#d29c61";
    ctx.fillRect(x - 3, 168, 4, 2);
    ctx.fillStyle = "#181f20";
    ctx.fillRect(x + 15, 311, 3, 19);
  }

  ctx.fillStyle = "#303638";
  ctx.fillRect(0, 333, WORLD.width, 18);
  ctx.fillStyle = "#b48b61";
  ctx.fillRect(0, 333, WORLD.width, 2);
  ctx.fillStyle = "#544c43";
  ctx.fillRect(0, 350, WORLD.width, 3);
}

function drawRain(time) {
  ctx.save();
  ctx.strokeStyle = "#d4d6c51c";
  ctx.lineWidth = 1;
  for (let i = 0; i < 42; i += 1) {
    const x = (i * 71 + 9 + time * (0.015 + (i % 4) * 0.004)) % WORLD.width;
    const y = ((i * 93 + time * (0.06 + (i % 3) * 0.018)) % 400) - 20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5, y + 17 + (i % 4) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlatform() {
  const floorTop = WORLD.floor;
  ctx.fillStyle = "#252c2d";
  ctx.fillRect(0, floorTop - 57, WORLD.width, 63);
  ctx.fillStyle = "#b89368";
  ctx.fillRect(0, floorTop - 57, WORLD.width, 2);
  ctx.fillStyle = "#65615a";
  ctx.fillRect(0, floorTop - 53, WORLD.width, 2);
  ctx.fillStyle = "#171e20";
  ctx.fillRect(0, floorTop - 48, WORLD.width, 49);

  const floor = ctx.createLinearGradient(0, floorTop - 2, 0, WORLD.height);
  floor.addColorStop(0, "#51504a");
  floor.addColorStop(0.17, "#383d3c");
  floor.addColorStop(1, "#192326");
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorTop, WORLD.width, WORLD.height - floorTop);

  ctx.fillStyle = "#b59d76";
  ctx.fillRect(0, floorTop, WORLD.width, 2);
  ctx.strokeStyle = "#a8a09027";
  ctx.lineWidth = 1;
  for (let i = -2; i < 13; i += 1) {
    const x = i * 91 + 14;
    ctx.beginPath();
    ctx.moveTo(x, floorTop + 2);
    ctx.lineTo(x + (i - 5) * 18, WORLD.height);
    ctx.stroke();
  }
  for (let y = floorTop + 18; y < WORLD.height; y += 22) {
    ctx.strokeStyle = `rgba(184,171,147,${0.15 - (y - floorTop) * 0.0007})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
  }

  const puddles = [
    [120, 470, 96, 7], [354, 500, 131, 9], [661, 459, 118, 6], [837, 508, 74, 8],
  ];
  for (const [x, y, w, h] of puddles) {
    const reflection = ctx.createLinearGradient(x, y - h, x, y + h);
    reflection.addColorStop(0, "#9ebdb91a");
    reflection.addColorStop(0.5, "#d4ae7237");
    reflection.addColorStop(1, "#9ebdb900");
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#141b1c";
  ctx.fillRect(0, WORLD.height - 6, WORLD.width, 6);
}

function pathRoundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawLimb(fromX, fromY, elbowX, elbowY, endX, endY, color, shadow, thickness = 11) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = shadow;
  ctx.lineWidth = thickness + 3;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(elbowX, elbowY, thickness * 0.47, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f2d3a533";
  ctx.beginPath();
  ctx.arc(elbowX - 1, elbowY - 2, thickness * 0.17, 0, Math.PI * 2);
  ctx.fill();
}

function drawFighter(fighter, index, time) {
  const colors = palette[index];
  const walk = fighter.pose === "walk" ? Math.sin(time * 0.016 + index * 2) : 0;
  const crouch = fighter.pose === "crouch" ? 12 : 0;
  const isAttack = fighter.pose === "light" || fighter.pose === "heavy";
  const attackRatio = isAttack
    ? Math.min(1, fighter.attackT / (fighter.attack === "heavy" ? 0.3 : 0.17))
    : 0;
  const extension = isAttack ? (fighter.attack === "heavy" ? 43 : 30) * Math.sin(Math.min(1, attackRatio * 1.3) * Math.PI / 2) : 0;
  const wind = Math.sin(time * 0.003 + index * 3) * 4;

  ctx.save();
  ctx.translate(fighter.x, WORLD.floor);
  ctx.fillStyle = "#070d10a8";
  ctx.beginPath();
  ctx.ellipse(0, 5, 31 + Math.min(12, Math.abs(fighter.vx) * 0.025), 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(0, fighter.y - WORLD.floor);
  ctx.scale(fighter.facing, 1);

  const bodyOffset = -crouch;
  const recoil = fighter.pose === "hit" ? -8 : 0;
  ctx.translate(recoil, bodyOffset);

  ctx.fillStyle = colors.shade;
  ctx.beginPath();
  ctx.moveTo(-8, -54);
  ctx.lineTo(-18, -31 + walk * 4);
  ctx.lineTo(-19 - walk * 7, 0);
  ctx.lineTo(-5 - walk * 6, 0);
  ctx.lineTo(1, -31 - walk * 3);
  ctx.lineTo(12, -52);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#171d1d";
  ctx.beginPath();
  ctx.ellipse(-13 - walk * 7, -1, 12, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(12, -1, 13, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.accent;
  ctx.fillRect(-19 - walk * 7, -5, 11, 2);
  ctx.fillRect(7, -5, 12, 2);

  ctx.fillStyle = colors.shade;
  ctx.beginPath();
  ctx.moveTo(-15, -51);
  ctx.lineTo(-21, -82);
  ctx.lineTo(-14, -103);
  ctx.lineTo(12, -106);
  ctx.lineTo(21, -83);
  ctx.lineTo(14, -50);
  ctx.lineTo(0, -45);
  ctx.closePath();
  ctx.fill();
  const bodyGrad = ctx.createLinearGradient(-17, -99, 21, -59);
  bodyGrad.addColorStop(0, colors.light);
  bodyGrad.addColorStop(0.44, colors.coat);
  bodyGrad.addColorStop(1, colors.shade);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-12, -52);
  ctx.lineTo(-16, -82);
  ctx.lineTo(-11, -99);
  ctx.lineTo(11, -101);
  ctx.lineTo(17, -81);
  ctx.lineTo(10, -54);
  ctx.lineTo(0, -48);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(-9, -97);
  ctx.lineTo(1, -101);
  ctx.lineTo(13, -59);
  ctx.lineTo(6, -56);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f5dbac7a";
  ctx.fillRect(0, -94, 2, 3);
  ctx.fillRect(3, -83, 2, 3);
  ctx.fillRect(6, -72, 2, 3);
  ctx.fillRect(9, -62, 2, 3);

  ctx.fillStyle = colors.shade;
  ctx.beginPath();
  ctx.moveTo(-10, -100);
  ctx.quadraticCurveTo(-22, -108, -37, -122 + wind);
  ctx.lineTo(-53, -141 + wind);
  ctx.quadraticCurveTo(-32, -136 + wind, -12, -126);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(-20, -112);
  ctx.quadraticCurveTo(-37, -128 + wind, -49, -137 + wind);
  ctx.lineTo(-34, -128 + wind);
  ctx.closePath();
  ctx.fill();

  const rearEndX = -25 - walk * 3;
  drawLimb(-11, -91, -23, -78, rearEndX, -64, colors.shade, "#272e2a", 9);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(rearEndX - 3, -68, 7, 3);

  let fistX = 21 + extension;
  let fistY = -80;
  let elbowX = 10 + extension * 0.45;
  let elbowY = -72;
  if (fighter.pose === "guard") { fistX = 21; fistY = -112; elbowX = 17; elbowY = -83; }
  if (fighter.pose === "crouch") { fistX = 26; fistY = -79; elbowX = 19; elbowY = -70; }
  if (fighter.pose === "hit") { fistX = 8; fistY = -68; elbowX = 18; elbowY = -82; }
  const attackColor = index === 0 ? "#b4c49b" : "#d6a28b";
  drawLimb(11, -91, elbowX, elbowY, fistX, fistY, colors.coat, colors.shade, 11);
  ctx.fillStyle = "#302f2a";
  ctx.beginPath();
  ctx.arc(fistX + 3, fistY, 8.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = attackColor;
  ctx.beginPath();
  ctx.arc(fistX + 4, fistY - 1, 6.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.accent;
  ctx.fillRect(fistX - 1, fistY + 5, 9, 2);

  ctx.fillStyle = colors.skin;
  pathRoundRect(-7, -119, 14, 10, 3);
  ctx.fill();
  ctx.fillStyle = colors.hair;
  ctx.beginPath();
  ctx.moveTo(-13, -121);
  ctx.quadraticCurveTo(-15, -143, 0, -143);
  ctx.quadraticCurveTo(16, -140, 14, -124);
  ctx.lineTo(8, -128);
  ctx.lineTo(3, -134);
  ctx.lineTo(-3, -128);
  ctx.lineTo(-10, -126);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.skin;
  ctx.beginPath();
  ctx.ellipse(1, -127, 10, 12, 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.hair;
  ctx.beginPath();
  ctx.moveTo(-9, -130);
  ctx.quadraticCurveTo(-8, -144, 4, -138);
  ctx.lineTo(13, -136);
  ctx.lineTo(9, -131);
  ctx.lineTo(1, -133);
  ctx.lineTo(-6, -127);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#332c28";
  ctx.fillRect(6, -127, 3, 1.5);
  ctx.fillStyle = "#f2dbb3";
  ctx.fillRect(7, -128, 1.5, 1);
  ctx.fillStyle = "#864e43";
  ctx.fillRect(7, -120, 4, 1);

  ctx.fillStyle = index === 0 ? "#dae6ca" : "#ead4b7";
  ctx.font = "700 7px 'DM Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(index === 0 ? "J" : "R", 0, -68);

  if (fighter.flash > 0) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = Math.min(0.65, fighter.flash * 5.5);
    ctx.fillStyle = "#fff3cb";
    ctx.beginPath();
    ctx.ellipse(0, -87, 25, 57, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (isAttack && !fighter.attackHit && attackRatio > 0.25) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.42, attackRatio * 0.42);
    ctx.strokeStyle = index === 0 ? "#c4e0bb" : "#f29b7d";
    ctx.lineWidth = fighter.attack === "heavy" ? 5 : 3;
    ctx.beginPath();
    ctx.arc(fighter.x + fighter.facing * 35, fighter.y - 82, fighter.attack === "heavy" ? 56 : 43, -0.8, 0.55);
    ctx.stroke();
    ctx.restore();
  }
}

function spawnImpact(x, y, heavy) {
  const count = heavy ? 20 : 12;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.45;
    const speed = 65 + Math.random() * (heavy ? 255 : 175);
    particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: 0.18 + Math.random() * 0.28, maxLife: 0.46,
      size: 1.2 + Math.random() * (heavy ? 3.2 : 2.1),
      color: Math.random() > 0.5 ? "#f9dc9c" : "#f28b65",
    });
  }
  for (let i = 0; i < 3; i += 1) {
    particles.push({
      x: x + (Math.random() - 0.5) * 26, y: y + (Math.random() - 0.5) * 19,
      vx: (Math.random() - 0.5) * 30, vy: 28 + Math.random() * 44,
      life: 0.7 + Math.random() * 0.35, maxLife: 1.05,
      size: 2 + Math.random() * 1.6, color: "#b95042",
    });
  }
  hitStop = heavy ? 0.065 : 0.045;
  playImpact(heavy);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= dt;
    if (particle.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 500 * dt;
  }
}

function drawParticles() {
  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
}

function readInput(player) {
  const has = (action) => keys.has(`${player}:${action}`) || touchKeys.has(`${player}:${action}`);
  return {
    move: (has("right") ? 1 : 0) - (has("left") ? 1 : 0),
    jump: has("jump"),
    crouch: has("crouch"),
    guard: has("guard"),
    light: has("light"),
    heavy: has("heavy"),
  };
}

function setHudVisible(visible) {
  hud.hidden = !visible;
}

function updateHud(dt) {
  if (mode !== "local" && mode !== "online") return;
  const [first, second] = match.fighters;
  $("#health-one").style.width = `${first.health}%`;
  $("#health-two").style.width = `${second.health}%`;
  const fighters = [first, second];
  for (let i = 0; i < fighters.length; i += 1) {
    if (fighters[i].health > chipHealth[i]) chipHealth[i] = fighters[i].health;
    else chipHealth[i] = Math.max(fighters[i].health, chipHealth[i] - dt * 38);
  }
  $("#chip-one").style.width = `${Math.max(0, chipHealth[0] - first.health)}%`;
  $("#chip-two").style.width = `${Math.max(0, chipHealth[1] - second.health)}%`;
  const pipOne = `<i class="${first.wins > 0 ? "won-one" : ""}"></i><i class="${first.wins > 1 ? "won-one" : ""}"></i>`;
  const pipTwo = `<i class="${second.wins > 0 ? "won-two" : ""}"></i><i class="${second.wins > 1 ? "won-two" : ""}"></i>`;
  if ($("#pips-one").dataset.pips !== pipOne) {
    $("#pips-one").innerHTML = pipOne;
    $("#pips-one").dataset.pips = pipOne;
  }
  if ($("#pips-two").dataset.pips !== pipTwo) {
    $("#pips-two").innerHTML = pipTwo;
    $("#pips-two").dataset.pips = pipTwo;
  }
  $("#timer").textContent = String(Math.ceil(match.time)).padStart(2, "0");
  $("#round-label").textContent = `ROUND ${String(match.round).padStart(2, "0")}`;
  $("#round-result").textContent = match.roundOver > 0
    ? match.roundWinner < 0 ? "DRAW" : `${match.roundWinner === 0 ? "JUNO" : "ROOK"} TAKES ROUND`
    : "";
  $("#match-label").textContent = mode === "online" ? `ROOM ${localRoomCode}` : "LOCAL DUEL";
}

function checkHits() {
  for (let i = 0; i < match.fighters.length; i += 1) {
    const fighter = match.fighters[i];
    if (fighter.health < previousHealth[i]) {
      const target = fighter;
      const source = match.fighters[1 - i];
      spawnImpact((target.x + source.x) / 2, target.y - 86, source.attack === "heavy");
    }
    previousHealth[i] = fighter.health;
  }
}

function frame(now) {
  const dt = Math.min(0.04, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (mode === "local") {
    if (hitStop > 0) hitStop = Math.max(0, hitStop - dt);
    else {
      stepMatch(match, [readInput(0), readInput(1)], dt);
      checkHits();
      if (match.winner !== -1) showWinner();
    }
  }
  updateParticles(dt);
  drawBackground(now);
  let renderFighters = match.fighters;
  if (mode === "online" && networkPrevious && networkCurrent) {
    const amount = Math.min(1, Math.max(0, (now - networkUpdatedAt) / 50));
    renderFighters = networkCurrent.fighters.map((current, index) => {
      const previous = networkPrevious.fighters[index];
      return {
        ...current,
        x: previous.x + (current.x - previous.x) * amount,
        y: previous.y + (current.y - previous.y) * amount,
        vx: previous.vx + (current.vx - previous.vx) * amount,
        vy: previous.vy + (current.vy - previous.vy) * amount,
      };
    });
  }
  const [first, second] = renderFighters;
  drawFighter(first, 0, now);
  drawFighter(second, 1, now);
  drawParticles();
  updateHud(dt);
  requestAnimationFrame(frame);
}

function clearKeys() {
  keys.clear();
  touchKeys.clear();
}

function beginLocal() {
  startAudio();
  ensureAmbience();
  disconnectSocket();
  mode = "local";
  match = createMatch();
  previousHealth = [100, 100];
  chipHealth = [100, 100];
  hitStop = 0;
  localRoomCode = "";
  clearKeys();
  menu.hidden = true;
  lobby.hidden = true;
  ending.hidden = true;
  touchControls.hidden = !matchMedia("(pointer: coarse)").matches;
  setHudVisible(true);
  $("#connection-label").textContent = "LOCAL SESSION";
  $("#stage-label").innerHTML = '<span class="tiny-square"></span> STAGE 01 <b>—</b> THE LAST TRAIN';
  $("#match-label").textContent = "LOCAL DUEL";
}

function openLobby() {
  startAudio();
  lobby.hidden = false;
  $("#viewport").classList.add("is-lobby");
  menu.hidden = true;
  $("#lobby-status").textContent = "Room codes are private. First player is P1.";
  $("#lobby-status").className = "lobby-status";
  $("#room-code").focus();
}

function setLobbyStatus(message, kind = "") {
  const status = $("#lobby-status");
  status.textContent = message;
  status.className = `lobby-status ${kind}`;
}

function connectRoom(action) {
  const codeInput = $("#room-code");
  let code = codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (action === "create" && !code) code = Math.random().toString(36).slice(2, 8).toUpperCase();
  if (!code || code.length < 4) {
    setLobbyStatus("Use a room code with at least 4 characters.", "error");
    return;
  }
  codeInput.value = code;
  localRoomCode = code;
  setLobbyStatus("Connecting to the fight server…");
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: action === "create" ? "create-room" : "join-room", code })));
  socket.addEventListener("message", (event) => onServerMessage(JSON.parse(event.data)));
  socket.addEventListener("close", () => {
    if (mode === "online") {
      mode = "menu";
      setLobbyStatus("Connection closed. Try making a new room.", "error");
      lobby.hidden = false;
      $("#viewport").classList.add("is-lobby");
      setHudVisible(false);
      menu.hidden = true;
      touchControls.hidden = true;
      stopAmbience();
    }
  });
  socket.addEventListener("error", () => {
    setLobbyStatus("Can't reach the game server. Ask your host to run npm start.", "error");
  });
}

function onServerMessage(message) {
  if (message.type === "room-created") {
    localRoomCode = message.code;
    $("#room-code").value = message.code;
    setLobbyStatus("Room created. Send your friend the code, then wait here.", "good");
  } else if (message.type === "waiting") {
    localRoomCode = message.code;
    $("#room-code").value = message.code;
    setLobbyStatus("Waiting for the other fighter…", "good");
  } else if (message.type === "match-started") {
    mode = "online";
    match = message.match;
    networkPrevious = message.match;
    networkCurrent = message.match;
    networkUpdatedAt = performance.now();
    myPlayerIndex = message.playerIndex;
    previousHealth = [100, 100];
    chipHealth = [100, 100];
    sendInput.last = "";
    startAudio();
    ensureAmbience();
    lobby.hidden = true;
    menu.hidden = true;
    ending.hidden = true;
    setHudVisible(true);
    touchControls.hidden = !matchMedia("(pointer: coarse)").matches;
    $("#viewport").classList.remove("is-lobby");
    $("#connection-label").textContent = "ONLINE · CONNECTED";
    $("#stage-label").innerHTML = '<span class="tiny-square"></span> PRIVATE MATCH <b>—</b> THE LAST TRAIN';
    sendInput();
  } else if (message.type === "state" && mode === "online") {
    const nextMatch = message.match;
    networkPrevious = networkCurrent;
    networkCurrent = nextMatch;
    networkUpdatedAt = performance.now();
    match = nextMatch;
    checkHits();
    if (match.winner !== -1) showWinner();
  } else if (message.type === "opponent-left") {
    mode = "menu";
    disconnectSocket();
    localRoomCode = "";
    setHudVisible(false);
    touchControls.hidden = true;
    lobby.hidden = false;
    $("#viewport").classList.add("is-lobby");
    setLobbyStatus("Your friend left the room. Create another to play again.", "error");
    stopAmbience();
  } else if (message.type === "rematch-waiting") {
    $("#winner-subtitle").textContent = "Waiting for your rival to run it back…";
    $("#rematch-button").disabled = true;
    $("#rematch-button").querySelector("span").textContent = "WAITING…";
  } else if (message.type === "error") {
    setLobbyStatus(message.message, "error");
  }
}

function sendInput() {
  if (mode !== "online" || socket?.readyState !== WebSocket.OPEN) return;
  const input = readInput(myPlayerIndex);
  const signature = JSON.stringify(input);
  const now = performance.now();
  if (signature !== sendInput.last || now - sendInput.lastTime > 100) {
    socket.send(JSON.stringify({ type: "input", input }));
    sendInput.last = signature;
    sendInput.lastTime = now;
  }
  requestAnimationFrame(sendInput);
}
sendInput.last = "";
sendInput.lastTime = 0;

function showWinner() {
  if (!ending.hidden) return;
  const winner = match.winner;
  $("#winner-title").textContent = winner === 0 ? "JUNO TAKES IT." : winner === 1 ? "ROOK TAKES IT." : "DEAD EVEN.";
  $("#winner-subtitle").textContent = mode === "online" ? "Good hands. Run it back?" : "Good hands. Run it back?";
  ending.hidden = false;
  $("#rematch-button").disabled = false;
  $("#rematch-button").querySelector("span").textContent = "RUN IT BACK";
  stopAmbience();
  tone(winner < 0 ? 196 : 392, 0.45, "triangle", 0.08, winner < 0 ? 0 : 196);
}

function disconnectSocket() {
  if (!socket) return;
  const oldSocket = socket;
  socket = null;
  oldSocket.close();
}

function returnToMenu() {
  const wasOnline = mode === "online";
  disconnectSocket();
  mode = "menu";
  match = createMatch();
  hitStop = 0;
  clearKeys();
  menu.hidden = false;
  lobby.hidden = true;
  ending.hidden = true;
  touchControls.hidden = true;
  $("#viewport").classList.remove("is-lobby");
  setHudVisible(false);
  stopAmbience();
  $("#connection-label").textContent = "LOCAL BUILD";
  $("#match-label").textContent = "FREE PLAY";
  if (wasOnline) $("#stage-label").innerHTML = '<span class="tiny-square"></span> STAGE 01 <b>—</b> THE LAST TRAIN';
}

function activateTouchButton(button, down) {
  const action = button.dataset.touch;
  const player = mode === "online" ? myPlayerIndex : Number(button.dataset.player || 0);
  const key = `${player}:${action}`;
  if (down) touchKeys.add(key);
  else touchKeys.delete(key);
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.repeat || !keyMap[event.code]) return;
  event.preventDefault();
  const [player, action] = keyMap[event.code];
  keys.add(`${player}:${action}`);
  if (mode !== "menu" && (action === "light" || action === "heavy")) playAttack(action);
});
window.addEventListener("keyup", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const binding = keyMap[event.code];
  if (!binding) return;
  event.preventDefault();
  keys.delete(`${binding[0]}:${binding[1]}`);
});
window.addEventListener("blur", clearKeys);
document.addEventListener("visibilitychange", () => { if (document.hidden) clearKeys(); });

$("#local-button").addEventListener("click", beginLocal);
$("#online-button").addEventListener("click", openLobby);
$("#create-room").addEventListener("click", () => connectRoom("create"));
$("#join-room").addEventListener("click", () => connectRoom("join"));
$("#close-lobby").addEventListener("click", () => {
  lobby.hidden = true;
  menu.hidden = false;
  $("#viewport").classList.remove("is-lobby");
  disconnectSocket();
});
$("#rematch-button").addEventListener("click", () => {
  if (mode === "online" && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "rematch" }));
  } else if (mode === "local") {
    beginLocal();
    ending.hidden = true;
  }
});
$("#menu-button").addEventListener("click", returnToMenu);
$("#sound-toggle").addEventListener("click", () => setSound(!soundEnabled));
$("#controls-toggle").addEventListener("click", () => {
  const drawer = $("#controls-drawer");
  drawer.hidden = !drawer.hidden;
  $("#controls-toggle span").textContent = drawer.hidden ? "+" : "−";
});
$("#room-code").addEventListener("keydown", (event) => {
  if (event.key === "Enter") connectRoom("join");
});
$("#touch-controls").addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-touch]");
  if (!button) return;
  event.preventDefault();
  button.setPointerCapture(event.pointerId);
  activateTouchButton(button, true);
});
$("#touch-controls").addEventListener("pointerup", (event) => {
  const button = event.target.closest("[data-touch]");
  if (button) activateTouchButton(button, false);
});
$("#touch-controls").addEventListener("pointercancel", (event) => {
  const button = event.target.closest("[data-touch]");
  if (button) activateTouchButton(button, false);
});

setHudVisible(false);
requestAnimationFrame(frame);
