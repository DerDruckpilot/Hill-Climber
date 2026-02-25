
/* Mini Hill Climb – BUILD B008
   - Uses pixel-art sprites from ./assets/
     Karosserie.png, Rad.png, Koerper.png, Kopf.png
   - Fallback to simple shapes if sprites not loaded yet.
*/

const { Engine, World, Bodies, Body, Constraint, Events } = Matter;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

// Pixel look: don't blur sprites
ctx.imageSmoothingEnabled = false;

const uiSpeed = document.getElementById("speed");
const uiFuel  = document.getElementById("fuel");
const uiDist  = document.getElementById("dist");

const menuEl = document.getElementById("menu");
const gameOverEl = document.getElementById("gameover");
const goReasonEl = document.getElementById("goReason");
const btnStart = document.getElementById("btnStart");
const btnBack  = document.getElementById("btnBack");

function show(el){ el.classList.add("is-visible"); }
function hide(el){ el.classList.remove("is-visible"); }

function resize() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
resize();

const STATE = { MENU:"menu", PLAY:"play", GAMEOVER:"gameover" };
let state = STATE.MENU;

const engine = Engine.create();
engine.gravity.y = 1.2;
const world = engine.world;

// -------- Sprites --------
const SPRITES = {
  body: { path: "./assets/Karosserie.png", img: null, ok:false },
  wheel:{ path: "./assets/Rad.png",        img: null, ok:false },
  torso:{ path: "./assets/Koerper.png",    img: null, ok:false },
  head: { path: "./assets/Kopf.png",       img: null, ok:false },
};
let spritesReady = false;

function loadImage(path){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ok:true, img });
    img.onerror = () => resolve({ ok:false, img:null });
    img.src = path;
  });
}

async function loadSprites(){
  const keys = Object.keys(SPRITES);
  const results = await Promise.all(keys.map(k => loadImage(SPRITES[k].path)));
  results.forEach((r, i) => {
    const k = keys[i];
    SPRITES[k].ok = r.ok;
    SPRITES[k].img = r.img;
  });
  spritesReady = keys.every(k => SPRITES[k].ok);
  // Even if not all loaded, we still run with fallbacks.
}

loadSprites();

// -------- Params --------
let fuel = 1.0;
const fuelDrainPerSec = 0.008;

const motorTorque = 0.0025;
const maxAngular  = 0.45;

// Air control (dt-scaled)
const airAngularPerSec = 0.55;
const airAngularClamp  = 0.55;

const terrainStep = 28;
const terrainAmp  = 120;
const terrainBase = 320;
const segmentThickness = 26;

const camera = { x: 0, y: 0 };
const input = { gas:false, brake:false };

function bindHold(btn, prop) {
  const down = (e) => { e.preventDefault(); input[prop]=true; };
  const up   = (e) => { e.preventDefault(); input[prop]=false; };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
}
bindHold(document.getElementById("gas"), "gas");
bindHold(document.getElementById("brake"), "brake");
document.addEventListener("touchmove", (e)=>e.preventDefault(), { passive:false });

// -------- Terrain --------
let terrainPoints = [];
let terrainBodies = [];
let seed = 1337;

function noise1D(t){
  const x = Math.sin(t * 12.9898 + seed) * 43758.5453;
  return x - Math.floor(x);
}
function smoothNoise(t){
  const i = Math.floor(t);
  const f = t - i;
  const a = noise1D(i);
  const b = noise1D(i+1);
  const u = f*f*(3-2*f);
  return a*(1-u) + b*u;
}
function heightAtX(x){
  const n = smoothNoise(x/260);
  const n2 = smoothNoise(x/90) * 0.35;
  return terrainBase + (n*2-1)*terrainAmp + (n2*2-1)*terrainAmp*0.35;
}

function addTerrainSegment(p1, p2){
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const mid = { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 };
  const ang = Math.atan2(dy, dx);

  const body = Bodies.rectangle(mid.x, mid.y, len+6, segmentThickness+14, {
    isStatic: true,
    friction: 1.0,
    label: "GROUND"
  });
  Body.setAngle(body, ang);

  terrainBodies.push(body);
  World.add(world, body);
}

function ensureTerrainUntil(xMax, doCleanup = true){
  if (terrainPoints.length === 0){
    terrainPoints.push({ x:-400, y: heightAtX(-400) });
    terrainPoints.push({ x:0, y: heightAtX(0) });
    addTerrainSegment(terrainPoints[0], terrainPoints[1]);
  }

  while (terrainPoints[terrainPoints.length-1].x < xMax){
    const last = terrainPoints[terrainPoints.length-1];
    const nx = last.x + terrainStep;
    const ny = heightAtX(nx);
    const np = { x:nx, y:ny };
    terrainPoints.push(np);
    addTerrainSegment(last, np);
  }

  if (!doCleanup) return;

  const cutoff = camera.x - 1200;
  while (terrainPoints.length > 6 && terrainPoints[1].x < cutoff){
    terrainPoints.shift();
    const b = terrainBodies.shift();
    if (b) World.remove(world, b);
  }
}

// -------- Car + Driver --------
let car = null;
let distanceStartX = 0;
let wheelGroundContacts = 0;

function createCar(x){
  const groundY = heightAtX(x);
  const spawnY = groundY - 60;

  const chassis = Bodies.rectangle(x, spawnY, 120, 28, {
    density: 0.003,
    friction: 0.6,
    label: "CHASSIS"
  });

  const wheelA = Bodies.circle(x - 42, spawnY + 24, 20, {
    density: 0.002,
    friction: 1.2,
    label: "WHEEL"
  });
  const wheelB = Bodies.circle(x + 42, spawnY + 24, 20, {
    density: 0.002,
    friction: 1.2,
    label: "WHEEL"
  });

  const suspA = Constraint.create({
    bodyA: chassis,
    pointA: { x:-42, y: 18 },
    bodyB: wheelA,
    length: 22,
    stiffness: 0.45,
    damping: 0.15
  });
  const suspB = Constraint.create({
    bodyA: chassis,
    pointA: { x: 42, y: 18 },
    bodyB: wheelB,
    length: 22,
    stiffness: 0.45,
    damping: 0.15
  });

  // driver placement (B007)
  const torso = Bodies.rectangle(x + 2, spawnY - 18, 18, 40, {
    density: 0.0006,
    friction: 0.2,
    label: "TORSO"
  });

  const torsoMount = Constraint.create({
    bodyA: chassis,
    pointA: { x: 6, y:-10 },
    bodyB: torso,
    pointB: { x:0, y: 16 },
    length: 2,
    stiffness: 1.0,
    damping: 0.35
  });

  const head = Bodies.circle(x + 2, spawnY - 46, 12, {
    isSensor: true,
    label: "HEAD"
  });

  const neck = Constraint.create({
    bodyA: torso,
    pointA: { x:0, y:-20 },
    bodyB: head,
    pointB: { x:0, y: 0 },
    length: 1,
    stiffness: 1.0,
    damping: 0.5
  });

  World.add(world, [chassis, wheelA, wheelB, suspA, suspB, torso, torsoMount, head, neck]);

  return { chassis, wheelA, wheelB, suspA, suspB, torso, torsoMount, head, neck };
}

function removeCar(){
  if (!car) return;
  World.remove(world, [car.chassis, car.wheelA, car.wheelB, car.suspA, car.suspB, car.torso, car.torsoMount, car.head, car.neck]);
  car = null;
}

// -------- Collisions --------
function isWheel(body){ return body && body.label === "WHEEL"; }
function isGround(body){ return body && body.label === "GROUND"; }
function isHead(body){ return body && body.label === "HEAD"; }

Events.on(engine, "collisionStart", (evt) => {
  if (!car) return;
  for (const pair of evt.pairs){
    const a = pair.bodyA;
    const b = pair.bodyB;

    if ((isWheel(a) && isGround(b)) || (isWheel(b) && isGround(a))){
      wheelGroundContacts++;
    }

    if (state === STATE.PLAY){
      const headHitGround = (isHead(a) && isGround(b)) || (isHead(b) && isGround(a));
      const headHitAnyStatic = (isHead(a) && b.isStatic) || (isHead(b) && a.isStatic);
      if (headHitGround || headHitAnyStatic){
        triggerGameOver("Kopf berührt");
        return;
      }
    }
  }
});

Events.on(engine, "collisionEnd", (evt) => {
  if (!car) return;
  for (const pair of evt.pairs){
    const a = pair.bodyA;
    const b = pair.bodyB;
    if ((isWheel(a) && isGround(b)) || (isWheel(b) && isGround(a))){
      wheelGroundContacts = Math.max(0, wheelGroundContacts - 1);
    }
  }
});

function triggerGameOver(reason){
  if (state !== STATE.PLAY) return;
  state = STATE.GAMEOVER;
  input.gas = false; input.brake = false;
  goReasonEl.textContent = reason || "Game Over";
  show(gameOverEl);
}

// -------- Game Flow --------
function resetWorld(){
  World.clear(world, false);

  terrainPoints = [];
  terrainBodies = [];
  wheelGroundContacts = 0;
  fuel = 1.0;

  const spawnX = 120;
  const groundY = heightAtX(spawnX);

  camera.x = spawnX - window.innerWidth * 0.25;
  camera.y = groundY - window.innerHeight * 0.55;

  ensureTerrainUntil(2000, false);

  car = createCar(spawnX);
  distanceStartX = car.chassis.position.x;

  camera.x = car.chassis.position.x - window.innerWidth * 0.25;
  camera.y = car.chassis.position.y - window.innerHeight * 0.55;
}

function startGame(){
  hide(menuEl);
  hide(gameOverEl);
  state = STATE.PLAY;
  resetWorld();
}

function backToMenu(){
  state = STATE.MENU;
  input.gas = false; input.brake = false;
  show(menuEl);
  hide(gameOverEl);
  removeCar();
}

btnStart.addEventListener("click", (e) => { e.preventDefault(); startGame(); });
btnBack.addEventListener("click", (e) => { e.preventDefault(); backToMenu(); });

show(menuEl);

// -------- Loop --------
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
let lastTs = performance.now();

function step(ts){
  const dt = Math.max(0, Math.min(0.033, (ts - lastTs)/1000));
  lastTs = ts;

  if (state === STATE.PLAY && car){
    camera.x = car.chassis.position.x - window.innerWidth * 0.25;
    camera.y = car.chassis.position.y - window.innerHeight * 0.55;

    ensureTerrainUntil(car.chassis.position.x + 1600, true);

    if (fuel > 0) fuel = Math.max(0, fuel - fuelDrainPerSec * dt);

    if (fuel > 0 && input.gas){
      Body.setAngularVelocity(car.wheelA, clamp(car.wheelA.angularVelocity + motorTorque*120, -maxAngular, maxAngular));
      Body.setAngularVelocity(car.wheelB, clamp(car.wheelB.angularVelocity + motorTorque*120, -maxAngular, maxAngular));
    }
    if (input.brake){
      Body.setAngularVelocity(car.wheelA, clamp(car.wheelA.angularVelocity - motorTorque*120, -maxAngular, maxAngular));
      Body.setAngularVelocity(car.wheelB, clamp(car.wheelB.angularVelocity - motorTorque*120, -maxAngular, maxAngular));
    }

    const airborne = wheelGroundContacts === 0;
    if (airborne){
      const dW = airAngularPerSec * dt;
      if (input.gas){
        Body.setAngularVelocity(car.chassis, clamp(car.chassis.angularVelocity - dW, -airAngularClamp, airAngularClamp));
      }
      if (input.brake){
        Body.setAngularVelocity(car.chassis, clamp(car.chassis.angularVelocity + dW, -airAngularClamp, airAngularClamp));
      }
    }

    Engine.update(engine, 1000/60);

    if (fuel <= 0) triggerGameOver("Kein Fuel");
  } else {
    Engine.update(engine, 1000/60);
  }

  render();
  updateHUD();
  requestAnimationFrame(step);
}

// -------- Render helpers --------
function worldToScreen(p){
  return { x: (p.x - camera.x), y: (p.y - camera.y) };
}

function drawSpriteCenteredRot(img, x, y, w, h, angle){
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Draw image into desired size (pixel-art; smoothing disabled)
  ctx.drawImage(img, -w/2, -h/2, w, h);
  ctx.restore();
}

function render(){
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

  // terrain line
  ctx.strokeStyle = "rgba(255,255,255,0.40)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i=0;i<terrainPoints.length;i++){
    const s = worldToScreen(terrainPoints[i]);
    if (i===0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  if (!car) return;

  // Car sprites (fallback to shapes if missing)
  const cp = worldToScreen(car.chassis.position);
  const wpA = worldToScreen(car.wheelA.position);
  const wpB = worldToScreen(car.wheelB.position);
  const tp = worldToScreen(car.torso.position);
  const hp = worldToScreen(car.head.position);

  // IMPORTANT: sizes must match physics sizes
  const chassisW = 120, chassisH = 28;
  const wheelD = 40;
  const torsoW = 18, torsoH = 40;
  const headD = 24;

  // Body (Karosserie)
  if (SPRITES.body.ok) drawSpriteCenteredRot(SPRITES.body.img, cp.x, cp.y, chassisW, chassisH, car.chassis.angle);
  else drawBodyRect(car.chassis, chassisW, chassisH);

  // Torso / Head
  if (SPRITES.torso.ok) drawSpriteCenteredRot(SPRITES.torso.img, tp.x, tp.y, torsoW, torsoH, car.torso.angle);
  else drawTorso(car.torso, torsoW, torsoH);

  if (SPRITES.head.ok) drawSpriteCenteredRot(SPRITES.head.img, hp.x, hp.y, headD, headD, car.head.angle);
  else drawHead(car.head, headD/2);

  // Wheels
  if (SPRITES.wheel.ok) {
    drawSpriteCenteredRot(SPRITES.wheel.img, wpA.x, wpA.y, wheelD, wheelD, car.wheelA.angle);
    drawSpriteCenteredRot(SPRITES.wheel.img, wpB.x, wpB.y, wheelD, wheelD, car.wheelB.angle);
  } else {
    drawWheel(car.wheelA, wheelD/2);
    drawWheel(car.wheelB, wheelD/2);
  }
}

function drawBodyRect(body, w, h){
  const p = worldToScreen(body.position);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(body.angle);
  ctx.fillStyle = "#e9eefc";
  ctx.fillRect(-w/2, -h/2, w, h);
  ctx.restore();
}
function drawTorso(body, w, h){
  const p = worldToScreen(body.position);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(body.angle);
  ctx.fillStyle = "rgba(233,238,252,0.92)";
  ctx.fillRect(-w/2, -h/2, w, h);
  ctx.restore();
}
function drawWheel(body, r){
  const p = worldToScreen(body.position);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(body.angle);
  ctx.beginPath();
  ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle = "#e9eefc";
  ctx.fill();
  ctx.restore();
}
function drawHead(body, r){
  const p = worldToScreen(body.position);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.beginPath();
  ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle = "rgba(233,238,252,0.92)";
  ctx.fill();
  ctx.restore();
}

// -------- HUD --------
function updateHUD(){
  if (!car || state !== STATE.PLAY){
    uiSpeed.textContent = `0 km/h`;
    uiFuel.textContent = `Fuel: ${Math.round(fuel*100)}%`;
    uiDist.textContent = `0 m`;
    return;
  }

  const vx = car.chassis.velocity.x;
  const kmh = Math.round(Math.abs(vx) * 3.6 * 2.2);
  uiSpeed.textContent = `${kmh} km/h`;
  uiFuel.textContent = `Fuel: ${Math.round(fuel*100)}%`;

  const dist = Math.max(0, car.chassis.position.x - distanceStartX);
  uiDist.textContent = `${Math.round(dist/10)} m`;
}

["btnStart","btnBack","gas","brake"].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("contextmenu", (e) => e.preventDefault());
});

requestAnimationFrame(step);
