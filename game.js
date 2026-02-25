
/* Mini Hill Climb – BUILD B015
   - Sprite sizes/offsets tuned so graphics match physics better.
   - Uses .PNG assets in /assets (case-sensitive on GitHub Pages)
   - Keeps debug sprite status lines.
*/

const { Engine, World, Bodies, Body, Constraint, Events } = Matter;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });
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

// -------- Sprites (robust) --------
const SPRITES = {
  body:  { img:null, ok:false, loadedFrom:null },
  wheel: { img:null, ok:false, loadedFrom:null },
  torso: { img:null, ok:false, loadedFrom:null },
  head:  { img:null, ok:false, loadedFrom:null },
};

const CANDIDATES = {
  body:  ["assets/Karosserie.PNG","assets/Karosserie.png","./assets/Karosserie.PNG","./assets/Karosserie.png"],
  wheel: ["assets/Rad.PNG","assets/Rad.png","./assets/Rad.PNG","./assets/Rad.png"],
  torso: ["assets/Koerper.PNG","assets/Koerper.png","./assets/Koerper.PNG","./assets/Koerper.png"],
  head:  ["assets/Kopf.PNG","assets/Kopf.png","./assets/Kopf.PNG","./assets/Kopf.png"],
};

function loadImage(path){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ok:true, img, path });
    img.onerror = () => resolve({ ok:false, img:null, path });
    img.src = path;
  });
}

async function loadSprite(key){
  for (const p of (CANDIDATES[key] || [])){
    const r = await loadImage(p);
    if (r.ok){
      SPRITES[key].ok = true;
      SPRITES[key].img = r.img;
      SPRITES[key].loadedFrom = p;
      return true;
    }
  }
  return false;
}

async function loadAllSprites(){
  await Promise.all(Object.keys(SPRITES).map(k => loadSprite(k)));
}
loadAllSprites();

function drawSpriteStatus(){
  ctx.save();
  ctx.font = "12px system-ui, -apple-system";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = [
    `body: ${SPRITES.body.ok ? "OK" : "MISS"}${SPRITES.body.loadedFrom ? " ("+SPRITES.body.loadedFrom+")" : ""}`,
    `wheel: ${SPRITES.wheel.ok ? "OK" : "MISS"}${SPRITES.wheel.loadedFrom ? " ("+SPRITES.wheel.loadedFrom+")" : ""}`,
    `torso: ${SPRITES.torso.ok ? "OK" : "MISS"}${SPRITES.torso.loadedFrom ? " ("+SPRITES.torso.loadedFrom+")" : ""}`,
    `head: ${SPRITES.head.ok ? "OK" : "MISS"}${SPRITES.head.loadedFrom ? " ("+SPRITES.head.loadedFrom+")" : ""}`,
  ];
  let y = 58;
  for (const ln of lines){ ctx.fillText(ln, 12, y); y += 14; }
  ctx.restore();
}

// -------- Visual tuning (sprites vs physics) --------
// Physics bodies keep their sizes; sprites are drawn with these VISUAL sizes.
const VIS = {
  chassisW: 210, chassisH: 112,     // taller body (was 56)
  wheelD: 64,
  torsoW: 44, torsoH: 72,
  headD: 46,
  chassisOff: { x: 0, y: -22 },    // lift art a bit (taller sprite)
  wheelOff:   { x: 0, y: -6 },
  torsoOff:   { x: -10, y: 26 },   // push driver down into the car
  headOff:    { x: -10, y: 18 },
};

// -------- Params --------
let fuel = 1.0;
const fuelDrainPerSec = 0.008;

const motorTorque = 0.0025;
const maxAngular  = 0.45;

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
  const spawnY = groundY - 52;

  const chassis = Bodies.rectangle(x, spawnY, 120, 28, {
    density: 0.003,
    friction: 0.6,
    label: "CHASSIS"
  });

  const wheelA = Bodies.circle(x - 34, spawnY + 22, 20, {
    density: 0.002,
    friction: 1.2,
    label: "WHEEL"
  });
  const wheelB = Bodies.circle(x + 34, spawnY + 22, 20, {
    density: 0.002,
    friction: 1.2,
    label: "WHEEL"
  });

  const suspA = Constraint.create({
    bodyA: chassis,
    pointA: { x:-34, y: 18 },
    bodyB: wheelA,
    length: 22,
    stiffness: 0.45,
    damping: 0.15
  });
  const suspB = Constraint.create({
    bodyA: chassis,
    pointA: { x: 34, y: 18 },
    bodyB: wheelB,
    length: 22,
    stiffness: 0.45,
    damping: 0.15
  });

  const torso = Bodies.rectangle(x - 10, spawnY + 6, 18, 40, {
    density: 0.0006,
    friction: 0.2,
    label: "TORSO"
  });

  const torsoMount = Constraint.create({
    bodyA: chassis,
    pointA: { x: -6, y: 2 },
    bodyB: torso,
    pointB: { x:0, y: 16 },
    length: 2,
    stiffness: 1.0,
    damping: 0.35
  });

  const head = Bodies.circle(x - 10, spawnY - 18, 12, {
    isSensor: true,
    label: "HEAD"
  });

  const neck = Constraint.create({
    bodyA: torso,
    pointA: { x:0, y:-14 },
    bodyB: head,
    pointB: { x:0, y: 0 },
    length: 1,
    stiffness: 1.0,
    damping: 0.5
  });

  World.add(world, [chassis, wheelA, wheelB, suspA, suspB, torso, torsoMount, head, neck]);
  return { chassis, wheelA, wheelB, suspA, suspB, torso, torsoMount, head, neck };
}

function isWheel(body){ return body && body.label === "WHEEL"; }
function isGround(body){ return body && body.label === "GROUND"; }
function isHead(body){ return body && body.label === "HEAD"; }

Events.on(engine, "collisionStart", (evt) => {
  if (!car) return;
  for (const pair of evt.pairs){
    const a = pair.bodyA, b = pair.bodyB;
    if ((isWheel(a) && isGround(b)) || (isWheel(b) && isGround(a))) wheelGroundContacts++;
    if (state === STATE.PLAY){
      const headHitGround = (isHead(a) && isGround(b)) || (isHead(b) && isGround(a));
      const headHitAnyStatic = (isHead(a) && b.isStatic) || (isHead(b) && a.isStatic);
      if (headHitGround || headHitAnyStatic){ triggerGameOver("Kopf berührt"); return; }
    }
  }
});

Events.on(engine, "collisionEnd", (evt) => {
  if (!car) return;
  for (const pair of evt.pairs){
    const a = pair.bodyA, b = pair.bodyB;
    if ((isWheel(a) && isGround(b)) || (isWheel(b) && isGround(a))) wheelGroundContacts = Math.max(0, wheelGroundContacts - 1);
  }
});

function triggerGameOver(reason){
  if (state !== STATE.PLAY) return;
  state = STATE.GAMEOVER;
  input.gas = false; input.brake = false;
  goReasonEl.textContent = reason || "Game Over";
  show(gameOverEl);
}

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
  hide(menuEl); hide(gameOverEl);
  state = STATE.PLAY;
  resetWorld();
}
function backToMenu(){
  state = STATE.MENU;
  input.gas = false; input.brake = false;
  show(menuEl); hide(gameOverEl);
  car = null;
}

btnStart.addEventListener("click", (e)=>{ e.preventDefault(); startGame(); });
btnBack.addEventListener("click", (e)=>{ e.preventDefault(); backToMenu(); });

show(menuEl);

// -------- Loop --------
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
let lastTs = performance.now();

function step(ts){
  const dt = Math.max(0, Math.min(0.033, (ts-lastTs)/1000));
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
      if (input.gas)   Body.setAngularVelocity(car.chassis, clamp(car.chassis.angularVelocity - dW, -airAngularClamp, airAngularClamp));
      if (input.brake) Body.setAngularVelocity(car.chassis, clamp(car.chassis.angularVelocity + dW, -airAngularClamp, airAngularClamp));
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

function worldToScreen(p){ return { x: (p.x - camera.x), y: (p.y - camera.y) }; }

function drawSpriteCenteredRot(img, x, y, w, h, angle, off){
  ctx.save();
  ctx.translate(x + (off?.x||0), y + (off?.y||0));
  ctx.rotate(angle);
  ctx.drawImage(img, -w/2, -h/2, w, h);
  ctx.restore();
}

function render(){
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

  ctx.strokeStyle = "rgba(255,255,255,0.40)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i=0;i<terrainPoints.length;i++){
    const s = worldToScreen(terrainPoints[i]);
    if (i===0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  drawSpriteStatus();
  if (!car) return;

  const cp  = worldToScreen(car.chassis.position);
  const wpA = worldToScreen(car.wheelA.position);
  const wpB = worldToScreen(car.wheelB.position);
  const hp  = worldToScreen(car.head.position);

  const chassisW = VIS.chassisW, chassisH = VIS.chassisH;
  const wheelD = VIS.wheelD;
  const torsoW = VIS.torsoW, torsoH = VIS.torsoH;
  const headD = VIS.headD;

  if (SPRITES.body.ok)  drawSpriteCenteredRot(SPRITES.body.img,  cp.x,  cp.y,  chassisW, chassisH, car.chassis.angle, VIS.chassisOff);

  // Render-only torso locked to chassis (no physics body)
  if (SPRITES.torso.ok){
    const torsoAnchor = { x: cp.x, y: cp.y };
    // seat position relative to chassis art
    drawSpriteCenteredRot(SPRITES.torso.img, torsoAnchor.x, torsoAnchor.y, VIS.torsoW, VIS.torsoH, car.chassis.angle, VIS.torsoOff);
  }
  if (SPRITES.wheel.ok){
    drawSpriteCenteredRot(SPRITES.wheel.img, wpA.x, wpA.y, wheelD, wheelD, car.wheelA.angle, VIS.wheelOff);
    drawSpriteCenteredRot(SPRITES.wheel.img, wpB.x, wpB.y, wheelD, wheelD, car.wheelB.angle, VIS.wheelOff);
  }
    if (SPRITES.head.ok)  drawSpriteCenteredRot(SPRITES.head.img,  hp.x,  hp.y,  headD, headD, car.head.angle, VIS.headOff);
}

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
  if (el) el.addEventListener("contextmenu", (e)=>e.preventDefault());
});

requestAnimationFrame(step);
