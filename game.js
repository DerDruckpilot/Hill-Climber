/* Mini Hill Climb – Matter.js Prototyp
   - prozedurales Terrain
   - Fahrzeug (Chassis + 2 Räder + Federung)
   - Kamera-Follow
   - Touch Gas/Bremse
*/

const {
  Engine, World, Bodies, Body, Composite, Constraint,
  Vector, Events
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
engine.gravity.y = 1.2; // "Erde-ish"
const world = engine.world;

// ====== Spielparameter ======
let fuel = 1.0;                // 1.0 = 100%
const fuelDrainPerSec = 0.008; // drain
const motorTorque = 0.0019;    // Rad-Drehmoment
const brakeDamp   = 0.10;      // "Bremse" durch Drehdämpfung
const maxAngular  = 0.35;      // max wheel angular velocity
const terrainStep = 40;        // px Abstand zwischen Punkten
const terrainAmp  = 120;       // Hügelhöhe
const terrainBase = 320;       // Baseline
const segmentThickness = 18;   // Kollisions-"Dicke"

// ====== Kamera ======
const camera = {
  x: 0,
  y: 0,
  zoom: 1
};

// ====== Input ======
const input = { gas:false, brake:false };
const btnGas = document.getElementById("gas");
const btnBrake = document.getElementById("brake");

function bindHold(btn, key, prop) {
  const down = (e) => { e.preventDefault(); input[prop]=true; };
  const up   = (e) => { e.preventDefault(); input[prop]=false; };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);

  window.addEventListener("keydown", (e)=> { if(e.key===key) input[prop]=true; });
  window.addEventListener("keyup",   (e)=> { if(e.key===key) input[prop]=false; });
}
bindHold(btnGas, "ArrowRight", "gas");
bindHold(btnBrake, "ArrowLeft", "brake");

// iOS: verhindert Scroll/Zoom-Gesten
document.addEventListener("touchmove", (e)=>e.preventDefault(), { passive:false });

// ====== Terrain (prozedural) ======
let terrainPoints = [];
let terrainBodies = [];
let seed = 1337;

function noise1D(t){
  // sehr simple "Value noise": deterministisch & glatt genug
  const x = Math.sin(t * 12.9898 + seed) * 43758.5453;
  return x - Math.floor(x); // 0..1
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

  // etwas dicker + minimal länger, damit Segmente überlappen
  const body = Bodies.rectangle(mid.x, mid.y, len + 6, segmentThickness + 14, {
    isStatic: true,
    friction: 1.0,
    restitution: 0.0
  });

  // Winkel sicher setzen (nicht nur per options)
  Body.setAngle(body, ang);

  // "Caps" an Segment-Enden gegen Lücken
  const capR = (segmentThickness + 14) * 0.35;
  const cap1 = Bodies.circle(p1.x, p1.y, capR, { isStatic: true, friction: 1.0, restitution: 0.0 });
  const cap2 = Bodies.circle(p2.x, p2.y, capR, { isStatic: true, friction: 1.0, restitution: 0.0 });

  terrainBodies.push(body, cap1, cap2);
  World.add(world, [body, cap1, cap2]);
}

function ensureTerrainUntil(xMax){
  // Stelle sicher, dass Terrain bis xMax existiert
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

  // Aufräumen: entferne Terrain weit links hinter der Kamera
  const cutoff = camera.x - 1200;
  while (terrainPoints.length > 4 && terrainPoints[1].x < cutoff){
    terrainPoints.shift(); // Punkt entfernen
    const b = terrainBodies.shift(); // dazugehöriger Body
    if (b) World.remove(world, b);
  }
}

// ====== Fahrzeug ======
function createCar(x, y){
  const chassis = Bodies.rectangle(x, y, 120, 28, {
    density: 0.003,
    friction: 0.6,
    restitution: 0.0
  });

  const wheelA = Bodies.circle(x - 42, y + 24, 20, {
    density: 0.002,
    friction: 1.2,
    restitution: 0.0
  });
  const wheelB = Bodies.circle(x + 42, y + 24, 20, {
    density: 0.002,
    friction: 1.2,
    restitution: 0.0
  });

  // Federung: Constraint + "Dämpfung" über stiffness/damping
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

let car = createCar(120, 200);

// ====== Game Loop / Physik ======
let lastTs = performance.now();
let distanceStartX = car.chassis.position.x;

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function step(ts){
  const dt = clamp((ts - lastTs) / 1000, 0.0, 0.033);
  lastTs = ts;

  // Kamera folgt dem Chassis
  camera.x = car.chassis.position.x - window.innerWidth * 0.25;
  camera.y = car.chassis.position.y - window.innerHeight * 0.55;

  // Terrain nach rechts nachladen
  ensureTerrainUntil(car.chassis.position.x + 1600);

  // Fuel
  if (fuel > 0){
    fuel = Math.max(0, fuel - fuelDrainPerSec * dt);
  }

  // Motor/Brake auf beide Räder
  if (fuel > 0 && input.gas){
    // Drehe Räder vorwärts (Richtung abhängig vom Boden)
    Body.setAngularVelocity(car.wheelA, clamp(car.wheelA.angularVelocity + motorTorque*120, -maxAngular, maxAngular));
    Body.setAngularVelocity(car.wheelB, clamp(car.wheelB.angularVelocity + motorTorque*120, -maxAngular, maxAngular));
  } else if (input.brake){
    // "Bremse": dämpfe Rotation
    Body.setAngularVelocity(car.wheelA, car.wheelA.angularVelocity * (1 - brakeDamp));
    Body.setAngularVelocity(car.wheelB, car.wheelB.angularVelocity * (1 - brakeDamp));
  }

  // Physik tick: fixe steps für Stabilität
  const fixed = 1000/60;
  Engine.update(engine, fixed);

  // Reset falls du zu sehr abschmierst
  const angle = car.chassis.angle;
  const vy = car.chassis.velocity.y;
  if (car.chassis.position.y > 2000 || Math.abs(angle) > 2.6 || vy > 40){
    World.remove(world, [car.chassis, car.wheelA, car.wheelB, car.suspA, car.suspB]);
    car = createCar(car.chassis.position.x + 60, 200);
    fuel = 1.0;
    distanceStartX = car.chassis.position.x;
  }

  render();
  updateHUD();
  requestAnimationFrame(step);
}

function worldToScreen(p){
  return {
    x: (p.x - camera.x),
    y: (p.y - camera.y)
  };
}

function render(){
  // Hintergrund
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

  // „Himmel“-Gradient light
  const g = ctx.createLinearGradient(0,0,0,window.innerHeight);
  g.addColorStop(0, "#101a33");
  g.addColorStop(1, "#070912");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

  // Terrain zeichnen (Linie)
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.40)";
  ctx.beginPath();
  for (let i=0;i<terrainPoints.length;i++){
    const s = worldToScreen(terrainPoints[i]);
    if (i===0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  // Terrain „Füllung“ unter der Linie (für Optik)
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  for (let i=0;i<terrainPoints.length;i++){
    const s = worldToScreen(terrainPoints[i]);
    if (i===0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.lineTo(worldToScreen(terrainPoints[terrainPoints.length-1]).x, window.innerHeight + 50);
  ctx.lineTo(worldToScreen(terrainPoints[0]).x, window.innerHeight + 50);
  ctx.closePath();
  ctx.fill();

  // Fahrzeug zeichnen
  drawBodyRect(car.chassis, 120, 28);
  drawWheel(car.wheelA, 20);
  drawWheel(car.wheelB, 20);

  // Federungslinien
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  drawConstraint(car.suspA);
  drawConstraint(car.suspB);
}

function drawBodyRect(body, w, h){
  const p = worldToScreen(body.position);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(body.angle);
  ctx.fillStyle = "rgba(233,238,252,0.90)";
  ctx.fillRect(-w/2, -h/2, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(-w/2, -h/2, w, 6);
  ctx.restore();
}

function drawWheel(body, r){
  const p = worldToScreen(body.position);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(body.angle);
  ctx.fillStyle = "rgba(233,238,252,0.92)";
  ctx.beginPath();
  ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fill();

  // Speiche
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0,0);
  ctx.lineTo(r,0);
  ctx.stroke();

  ctx.restore();
}

function drawConstraint(c){
  const a = c.bodyA ? Vector.add(c.bodyA.position, c.pointA) : c.pointA;
  const b = c.bodyB ? Vector.add(c.bodyB.position, c.pointB) : c.pointB;
  const sa = worldToScreen(a);
  const sb = worldToScreen(b);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
}

function updateHUD(){
  // Speed approx (x)
  const vx = car.chassis.velocity.x;
  const kmh = Math.round(Math.abs(vx) * 3.6 * 2.2); // „gamey“ Faktor
  uiSpeed.textContent = `${kmh} km/h`;

  uiFuel.textContent = `Fuel: ${Math.round(fuel*100)}%`;

  const dist = Math.max(0, car.chassis.position.x - distanceStartX);
  uiDist.textContent = `${Math.round(dist/10)} m`;
}

// Startterrain vorbereiten
ensureTerrainUntil(2000);

// Start
requestAnimationFrame(step);
