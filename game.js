
// --- Tap helper (iOS-safe): pointerup + click fallback ---
function bindTap(el, handler){
  if(!el) return;
  const fire = (ev)=>{ try{ handler(ev); } catch(e){ console.error(e); throw e; } };
  // iOS: 'click' can be suppressed if touch events call preventDefault somewhere.
  el.addEventListener("pointerup", fire, {passive:true});
  el.addEventListener("touchend", fire, {passive:true});
  el.addEventListener("click", fire);
}
/* Mini Hill Climb – BUILD B032-STARTQUEUE
   - Chassis + 2 wheels with constraints
   - Torso is render-only (no physics)
   - Head is sensor attached to chassis (very low wobble)
*/
(() => {
  "use strict";

  const BUILD = "BUILD B032-STARTQUEUE";
  const $ = (id) => document.getElementById(id);

  // DOM
  const canvas   = $("c");
  const buildTxt = $("buildText");
  const statusTxt= $("statusText");
  const menu     = $("menu");
  const gameover = $("gameover");
  const goReason = $("goReason");

  const btnStart = $("btnStart");
  const btnBack  = $("btnBack");
  const btnGas   = $("btnGas");
  const btnBrake = $("btnBrake");

  const speedText= $("speedText");
  const fuelText = $("fuelText");
  const distText = $("distText");

  buildTxt.textContent = BUILD;

  // Matter
  const { Engine, World, Bodies, Body, Constraint, Events, Vector } = Matter;
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = 1.15;
  const world = engine.world;

  // Canvas
  const ctx = canvas.getContext("2d", { alpha: true });

  function resize() {
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.width  = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width  = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  // Camera
  const cam = { x: 0, y: 0 };
  const view = () => ({ w: innerWidth, h: innerHeight });

  // Assets (case-sensitive paths!)
  const assets = {
    car:   new Image(),
    wheel: new Image(),
    torso: new Image(),
    head:  new Image(),
  };
  assets.car.src   = "./assets/Karosserie.PNG";
  assets.wheel.src = "./assets/Rad.PNG";
  assets.torso.src = "./assets/Koerper.PNG";
  assets.head.src  = "./assets/Kopf.PNG";

  function loadImage(img) {
    return new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Asset konnte nicht geladen werden: " + img.src));
    });
  }

  let ASSET_SCALE = 1.0;

  async function loadAssets() {
    statusTxt.textContent = "Assets werden geladen…";
    await Promise.all([
      loadImage(assets.car),
      loadImage(assets.wheel),
      loadImage(assets.torso),
      loadImage(assets.head),
    ]);

    const targetWheelR = 28; // px in world space
    const wheelRpx = Math.max(8, Math.floor(Math.min(assets.wheel.width, assets.wheel.height) / 2));
    ASSET_SCALE = targetWheelR / wheelRpx;

    statusTxt.textContent = "Assets OK – Start!";
  }

  // Ground
  const ground = [];
  const GROUND_Y = 460;
  const SEG_W = 120;
  const AMP = 70;
  const NOISE = () => (Math.random() * 2 - 1);

  function makeGround(fromX, toX) {
    let x = fromX;
    let lastY = GROUND_Y;
    while (x < toX) {
      const y = GROUND_Y + NOISE() * AMP;

      const midX = x + SEG_W * 0.5;
      const midY = (y + lastY) * 0.5;

      const dx = SEG_W;
      const dy = y - lastY;
      const angle = Math.atan2(dy, dx);
      const len = Math.sqrt(dx*dx + dy*dy);

      const thickness = 18;
      const body = Bodies.rectangle(midX, midY, len, thickness, {
        isStatic: true,
        friction: 1.0,
        restitution: 0.0,
        angle,
        label: "ground",
      });

      ground.push(body);
      World.add(world, body);

      x += SEG_W;
      lastY = y;
    }
  }

  function clearGround() {
    ground.forEach(b => World.remove(world, b));
    ground.length = 0;
  }

  // Vehicle
  let chassis, w1, w2, ax1, ax2, headSensor;
  let fuel = 100;
  let distance = 0;
  let started = false;
let appReady = false;
let pendingStart = false;

  let dead = false;

  // Input
  const input = { gas: false, brake: false };

  function bindHold(btn, key) {
    const set = (v) => { input[key] = v; };

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      set(true);
    });
    btn.addEventListener("pointerup", (e) => { e.preventDefault(); set(false); });
    btn.addEventListener("pointercancel", (e) => { e.preventDefault(); set(false); });
  }

  bindHold(btnGas, "gas");
  bindHold(btnBrake, "brake");

  // iOS: don't scroll/zoom from touches on controls
  ["touchstart","touchmove","touchend"].forEach(ev => {
    document.addEventListener(ev, (e) => {
      if (e.target === btnGas || e.target === btnBrake || e.target === btnStart || e.target === btnBack) {
        e.preventDefault();
      }
    }, { passive: false });
  });

  function spawnVehicle(x, y) {
    const wheelR = 28;
    const chW = 190;
    const chH = 44;

    chassis = Bodies.rectangle(x, y, chW, chH, {
      friction: 0.6,
      restitution: 0.0,
      density: 0.0022,
      label: "chassis",
    });

    const wheelFriction = 1.5;
    w1 = Bodies.circle(x - 62, y + 34, wheelR, {
      friction: wheelFriction,
      restitution: 0.0,
      density: 0.0016,
      label: "wheel",
    });
    w2 = Bodies.circle(x + 62, y + 34, wheelR, {
      friction: wheelFriction,
      restitution: 0.0,
      density: 0.0016,
      label: "wheel",
    });

    const stiffness = 0.75;
    const damping = 0.10;

    ax1 = Constraint.create({
      bodyA: chassis, pointA: { x: -62, y: 22 },
      bodyB: w1,
      length: 0,
      stiffness,
      damping,
    });
    ax2 = Constraint.create({
      bodyA: chassis, pointA: { x: 62, y: 22 },
      bodyB: w2,
      length: 0,
      stiffness,
      damping,
    });

    // Make chassis/wheels non-colliding with each other
    const group = Body.nextGroup(true);
    [chassis, w1, w2].forEach(b => b.collisionFilter.group = group);

    // Head sensor (no collision with car group, but can hit ground)
    headSensor = Bodies.circle(x - 14, y - 18, 14, {
      isSensor: true,
      density: 0.00001,
      label: "head",
      collisionFilter: { group: -1 },
    });

    const headLink = Constraint.create({
      bodyA: chassis, pointA: { x: -18, y: -10 },
      bodyB: headSensor,
      length: 2,
      stiffness: 0.95,
      damping: 0.22,
    });

    World.add(world, [chassis, w1, w2, ax1, ax2, headSensor, headLink]);

    Body.setAngle(chassis, 0.03);
  }

  function clearVehicle() {
    [chassis, w1, w2, ax1, ax2, headSensor].forEach(b => { if (b) World.remove(world, b); });
    chassis = w1 = w2 = ax1 = ax2 = headSensor = null;
  }

  function resetGame() {
    dead = false;
    fuel = 100;
    distance = 0;
    input.gas = input.brake = false;

    clearVehicle();
    clearGround();

    makeGround(-800, 3500);
    spawnVehicle(120, 260);

    cam.x = 0;
    cam.y = 0;
  }

  function showMenu() {
    menu.classList.add("is-visible");
    gameover.classList.remove("is-visible");
  }
  function hideMenu() {
    menu.classList.remove("is-visible");
  }
  function showGameOver(reason) {
    goReason.textContent = reason || "Game Over";
    gameover.classList.add("is-visible");
  }

  btnStart.addEventListener("click", () => {
    started = true;
    hideMenu();
    resetGame();
  });

  btnBack.addEventListener("click", () => {
    showMenu();
  });

  // Head vs ground => game over
  Events.on(engine, "collisionStart", (ev) => {
    if (!started || dead) return;
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const headHit =
        (a.label === "head" && b.label === "ground") ||
        (b.label === "head" && a.label === "ground");
      if (headHit) {
        dead = true;
        showGameOver("Kopf berührt");
        showMenu();
        break;
      }
    }
  });

  // Loop
  let lastT = performance.now();

  function step(t) {
    const dt = Math.min(33, t - lastT);
    lastT = t;

    if (started && chassis && !dead) {
      // Drive forces
      const torque = 0.00055;
      const brakeTorque = 0.00062;

      if (fuel > 0) {
        if (input.gas) {
          Body.applyForce(w1, w1.position, { x:  torque, y: 0 });
          Body.applyForce(w2, w2.position, { x:  torque, y: 0 });
          fuel = Math.max(0, fuel - dt * 0.0018);
        }
        if (input.brake) {
          Body.applyForce(w1, w1.position, { x: -brakeTorque, y: 0 });
          Body.applyForce(w2, w2.position, { x: -brakeTorque, y: 0 });
          fuel = Math.max(0, fuel - dt * 0.0012);
        }
      }

      // Simple air pitch (heuristic)
      const airborne = Math.abs(w1.velocity.y) > 0.8 && Math.abs(w2.velocity.y) > 0.8;
      if (airborne) {
        const airTorque = 0.00045;
        if (input.gas)   Body.applyForce(chassis, chassis.position, { x: 0, y: -airTorque });
        if (input.brake) Body.applyForce(chassis, chassis.position, { x: 0, y:  airTorque });
      }

      // Camera follow
      cam.x = chassis.position.x - view().w * 0.32;
      cam.y = Math.min(0, chassis.position.y - 260);

      // Extend ground
      const maxX = ground.length ? Math.max(...ground.map(b => b.bounds.max.x)) : 0;
      if (chassis.position.x + 1500 > maxX) {
        makeGround(maxX - 200, maxX + 2600);
      }

      // HUD
      const kmh = Math.max(0, Math.round(chassis.velocity.x * 3.6));
      speedText.textContent = String(kmh);
      fuelText.textContent = String(Math.round(fuel));
      distance = Math.max(distance, chassis.position.x - 120);
      distText.textContent = String(Math.max(0, Math.round(distance)));
    }

    Engine.update(engine, dt);

    render();
    requestAnimationFrame(step);
  }

  // Render helpers
  function drawSprite(img, x, y, angle, sx, sy, ax = 0.5, ay = 0.5) {
    if (!img || !img.complete) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -img.width * ax, -img.height * ay);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    ctx.save();
    ctx.translate(-cam.x, -cam.y);

    // Ground visual (simple line)
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    for (let i = 0; i < ground.length; i++) {
      const b = ground[i];
      const min = b.bounds.min;
      const max = b.bounds.max;
      if (i === 0) ctx.moveTo(min.x, b.position.y);
      ctx.lineTo(max.x, b.position.y);
    }
    ctx.stroke();

    if (chassis && w1 && w2) {
      const wheelScale = ASSET_SCALE;
      drawSprite(assets.wheel, w1.position.x, w1.position.y, w1.angle, wheelScale, wheelScale);
      drawSprite(assets.wheel, w2.position.x, w2.position.y, w2.angle, wheelScale, wheelScale);

      const carScale = ASSET_SCALE * 1.45;
      drawSprite(assets.car, chassis.position.x, chassis.position.y + 6, chassis.angle, carScale, carScale, 0.5, 0.52);

      // Torso render-only: fixed in seat
      const torsoScale = ASSET_SCALE * 1.15;
      const seatLocal = Vector.create(-18, -20);
      const seatWorld = Vector.add(chassis.position, Vector.rotate(seatLocal, chassis.angle));
      drawSprite(assets.torso, seatWorld.x, seatWorld.y, chassis.angle * 0.12, torsoScale, torsoScale, 0.50, 0.70);

      // Head from sensor (minimal wobble)
      const headScale = ASSET_SCALE * 1.05;
      drawSprite(assets.head, headSensor.position.x, headSensor.position.y, 0, headScale, headScale, 0.50, 0.55);
    }

    ctx.restore();
  }

  // Boot
  (async () => {
    try {
      await loadAssets();
      showMenu();
      requestAnimationFrame(step);
      appReady = true;
      if (pendingStart) { pendingStart = false; startNow(); }
    } catch (e) {
      const t = $("fatalText");
      const f = $("fatal");
      if (t && f) {
        t.textContent = String(e && e.message ? e.message : e);
        f.classList.add("is-visible");
      } else {
        console.error(e);
      }
    }
  })();
})();
