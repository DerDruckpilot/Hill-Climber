
/* Mini Hill Climb – BUILD B002 */

const {
  Engine, World, Bodies, Body, Constraint, Vector
} = Matter;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

const uiSpeed = document.getElementById("speed");
const uiFuel  = document.getElementById("fuel");
const uiDist  = document.getElementById("dist");

function resize() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

const engine = Engine.create();
engine.gravity.y = 1.2;
const world = engine.world;

let fuel = 1.0;
const fuelDrainPerSec = 0.008;
const motorTorque = 0.0025;
const maxAngular  = 0.45;

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
    friction: 1.0
  });
  Body.setAngle(body, ang);

  terrainBodies.push(body);
  World.add(world, body);
}

function ensureTerrainUntil(xMax){
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
}

function createCar(x){
  const groundY = heightAtX(x);
  const spawnY = groundY - 60;

  const chassis = Bodies.rectangle(x, spawnY, 120, 28, {
    density: 0.003,
    friction: 0.6
  });

  const wheelA = Bodies.circle(x - 42, spawnY + 24, 20, {
    density: 0.002,
    friction: 1.2
  });
  const wheelB = Bodies.circle(x + 42, spawnY + 24, 20, {
    density: 0.002,
    friction: 1.2
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

  World.add(world, [chassis, wheelA, wheelB, suspA, suspB]);
  return { chassis, wheelA, wheelB, suspA, suspB };
}

ensureTerrainUntil(2000);
let car = createCar(120);
let distanceStartX = car.chassis.position.x;

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function step(){
  camera.x = car.chassis.position.x - window.innerWidth * 0.25;
  camera.y = car.chassis.position.y - window.innerHeight * 0.55;

  ensureTerrainUntil(car.chassis.position.x + 1600);

  if (fuel > 0){
    fuel = Math.max(0, fuel - fuelDrainPerSec / 60);
  }

  if (fuel > 0 && input.gas){
    Body.setAngularVelocity(car.wheelA, clamp(car.wheelA.angularVelocity + motorTorque*120, -maxAngular, maxAngular));
    Body.setAngularVelocity(car.wheelB, clamp(car.wheelB.angularVelocity + motorTorque*120, -maxAngular, maxAngular));
  }

  if (input.brake){
    Body.setAngularVelocity(car.wheelA, clamp(car.wheelA.angularVelocity - motorTorque*120, -maxAngular, maxAngular));
    Body.setAngularVelocity(car.wheelB, clamp(car.wheelB.angularVelocity - motorTorque*120, -maxAngular, maxAngular));
  }

  Engine.update(engine, 1000/60);
  render();
  updateHUD();
  requestAnimationFrame(step);
}

function worldToScreen(p){
  return { x: (p.x - camera.x), y: (p.y - camera.y) };
}

function render(){
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  for (let i=0;i<terrainPoints.length;i++){
    const s = worldToScreen(terrainPoints[i]);
    if (i===0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  drawBodyRect(car.chassis, 120, 28);
  drawWheel(car.wheelA, 20);
  drawWheel(car.wheelB, 20);
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

function updateHUD(){
  const vx = car.chassis.velocity.x;
  const kmh = Math.round(Math.abs(vx) * 3.6 * 2.2);
  uiSpeed.textContent = `${kmh} km/h`;
  uiFuel.textContent = `Fuel: ${Math.round(fuel*100)}%`;
  const dist = Math.max(0, car.chassis.position.x - distanceStartX);
  uiDist.textContent = `${Math.round(dist/10)} m`;
}

requestAnimationFrame(step);
