/* Mini Hill Climb – BUILD B025 */
(() => {
  const BUILD = "B025";
  const $ = (id) => document.getElementById(id);

  const buildJs = $("buildJs");
  if (buildJs) buildJs.textContent = "BUILD " + BUILD + " · JS OK";

  const canvas = $("c");
  const ctx = canvas.getContext("2d");

  const hudSpeed = $("speed");
  const hudFuel  = $("fuel");
  const hudDist  = $("dist");

  const menu = $("menu");
  const btnStart = $("btnStart");
  const gameover = $("gameover");
  const btnBack = $("btnBack");
  const goReason = $("goReason");

  const btnGas = $("gas");
  const btnBrake = $("brake");

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width  = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener("resize", resize, {passive:true});
  resize();

  const { Engine, World, Bodies, Body, Constraint, Composite, Vector } = Matter;

  let engine, world;
  let terrain = [];
  let car = null;
  let running = false;

  let camX = 0, camY = 0;
  const gndY = 520;

  const input = { gas:false, brake:false };

  function bindHold(btn, key) {
    const down = (e) => { e.preventDefault(); e.stopPropagation(); input[key]=true; };
    const up   = (e) => { e.preventDefault(); e.stopPropagation(); input[key]=false; };
    ["pointerdown","touchstart"].forEach(ev => btn.addEventListener(ev, down, {passive:false}));
    ["pointerup","pointercancel","touchend","touchcancel","pointerleave"].forEach(ev => btn.addEventListener(ev, up, {passive:false}));
  }
  bindHold(btnGas, "gas");
  bindHold(btnBrake, "brake");
  document.addEventListener("touchstart", (e)=>{ if (e.target === btnGas || e.target === btnBrake) e.preventDefault(); }, {passive:false});

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load failed: " + src));
      img.src = src;
    });
  }
  const ASSETS = {
    body: "assets/Karosserie.PNG",
    wheel: "assets/Rad.PNG",
    torso: "assets/Koerper.PNG",
    head: "assets/Kopf.PNG",
  };
  let IMG = null;

  function resetTerrain() {
    terrain.forEach(b => World.remove(world, b));
    terrain = [];
    let x = -200;
    let y = gndY;
    const step = 60;
    const count = 80;
    for (let i=0;i<count;i++) {
      const dy = (Math.sin((i/6)) * 12) + (Math.sin((i/17)) * 22);
      const y2 = gndY + dy;
      const x2 = x + step;
      const len = Math.hypot(x2-x, y2-y);
      const ang = Math.atan2(y2-y, x2-x);
      const seg = Bodies.rectangle((x+x2)/2, (y+y2)/2, len, 18, {
        isStatic:true, friction:1.0, restitution:0.0, angle:ang
      });
      terrain.push(seg);
      x = x2; y = y2;
    }
    terrain.forEach(b => World.add(world, b));
  }

  function createCar(x, y) {
    const chassis = Bodies.rectangle(x, y, 140, 28, {
      friction: 0.9, frictionAir: 0.02, restitution: 0.0, density: 0.002
    });
    const wheelR = 22;
    const wheelA = Bodies.circle(x-48, y+22, wheelR, { friction: 1.5, restitution: 0.0, density: 0.001 });
    const wheelB = Bodies.circle(x+48, y+22, wheelR, { friction: 1.5, restitution: 0.0, density: 0.001 });

    const axA = Constraint.create({ bodyA: chassis, pointA: {x:-48, y: 18}, bodyB: wheelA, length: 0, stiffness: 0.9 });
    const axB = Constraint.create({ bodyA: chassis, pointA: {x: 48, y: 18}, bodyB: wheelB, length: 0, stiffness: 0.9 });

    const head = Bodies.circle(x-10, y-44, 10, {
      density: 0.0006, frictionAir: 0.03, restitution: 0.0,
      collisionFilter: { group: -1 }
    });
    const neck = Constraint.create({
      bodyA: chassis, pointA: {x:-8, y:-16},
      bodyB: head, pointB: {x:0, y:0},
      length: 18, stiffness: 0.35, damping: 0.12
    });

    const comp = Composite.create();
    Composite.add(comp, [chassis, wheelA, wheelB, axA, axB, head, neck]);
    World.add(world, comp);

    return {
      comp, chassis, wheelA, wheelB, head, wheelR,
      spriteScale: 0.52,
      torsoOffset: {x:-18, y:-56},
      headScale: 0.56,
      fuel: 100,
      dist: 0,
      lastX: x,
    };
  }

  function isAirborne() {
    const y = car.chassis.position.y;
    return y < gndY - 60;
  }

  function applyDrive(dt) {
    if (!car) return;
    const gas = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;
    if (running && (gas || brake)) car.fuel = Math.max(0, car.fuel - 0.012 * (gas+brake) * dt);

    const wheelTorque = 0.0018;
    const maxAng = 0.55;
    if (car.fuel <= 0) return;

    if (gas) {
      Body.setAngularVelocity(car.wheelA, Math.max(-maxAng, car.wheelA.angularVelocity - wheelTorque*dt));
      Body.setAngularVelocity(car.wheelB, Math.max(-maxAng, car.wheelB.angularVelocity - wheelTorque*dt));
    }
    if (brake) {
      Body.setAngularVelocity(car.wheelA, Math.min(maxAng, car.wheelA.angularVelocity + wheelTorque*dt));
      Body.setAngularVelocity(car.wheelB, Math.min(maxAng, car.wheelB.angularVelocity + wheelTorque*dt));
    }

    if (isAirborne()) {
      const airTorque = 0.0009;
      if (gas) Body.setAngularVelocity(car.chassis, car.chassis.angularVelocity + airTorque*dt);
      if (brake) Body.setAngularVelocity(car.chassis, car.chassis.angularVelocity - airTorque*dt);
    }
  }

  function updateHUD() {
    if (!car) return;
    const vx = car.chassis.velocity.x;
    const kmh = Math.max(0, Math.round(Math.abs(vx) * 3.6 * 2.2));
    hudSpeed.textContent = kmh + " km/h";
    hudFuel.textContent = "Fuel: " + Math.round(car.fuel) + "%";
    hudDist.textContent = Math.max(0, Math.round(car.dist)) + " m";
  }

  function setVisible(el, on) {
    if (!el) return;
    el.classList.toggle("is-visible", !!on);
  }

  function gameOver(reason="Kopf berührt") {
    running = false;
    setVisible(gameover, true);
    if (goReason) goReason.textContent = reason;
  }

  function resetGame() {
    engine = Engine.create();
    engine.gravity.y = 1.15;
    world = engine.world;

    resetTerrain();
    car = createCar(0, gndY - 80);

    camX = 0; camY = 0;
    running = true;
    setVisible(gameover, false);
  }

  function worldToScreen(p) {
    return { x: p.x - camX + window.innerWidth*0.35, y: p.y - camY + window.innerHeight*0.55 };
  }

  function drawTerrain() {
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(220,220,220,0.55)";
    ctx.beginPath();
    for (let i=0;i<terrain.length;i++) {
      const b = terrain[i];
      const v = b.vertices;
      const p1 = worldToScreen(v[0]);
      const p2 = worldToScreen(v[1]);
      if (i===0) ctx.moveTo(p1.x,p1.y);
      ctx.lineTo(p2.x,p2.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSprite(img, x, y, w, h, angle=0, alpha=1) {
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -w/2, -h/2, w, h);
    ctx.restore();
  }

  function drawCar() {
    if (!car || !IMG) return;

    const ch = car.chassis;
    const wA = car.wheelA;
    const wB = car.wheelB;

    const spCh = worldToScreen(ch.position);
    const spA = worldToScreen(wA.position);
    const spB = worldToScreen(wB.position);

    const wheelSize = car.wheelR*2 * 1.65;
    drawSprite(IMG.wheel, spA.x, spA.y, wheelSize, wheelSize, wA.angle);
    drawSprite(IMG.wheel, spB.x, spB.y, wheelSize, wheelSize, wB.angle);

    const bodyW = 260 * car.spriteScale;
    const bodyH = 120 * car.spriteScale;
    drawSprite(IMG.body, spCh.x, spCh.y - 18, bodyW, bodyH, ch.angle);

    const off = car.torsoOffset;
    const local = Vector.rotate({x:off.x, y:off.y}, ch.angle);
    const tp = worldToScreen({x: ch.position.x + local.x, y: ch.position.y + local.y});
    const torsoW = 120 * car.spriteScale;
    const torsoH = 150 * car.spriteScale;
    drawSprite(IMG.torso, tp.x, tp.y, torsoW, torsoH, ch.angle);

    const hp = car.head.position;
    const seatLocal = Vector.rotate({x: -6, y: -46}, ch.angle);
    const seatWorld = {x: ch.position.x + seatLocal.x, y: ch.position.y + seatLocal.y};
    const blend = 0.35;
    const hx = hp.x*(1-blend) + seatWorld.x*blend;
    const hy = hp.y*(1-blend) + seatWorld.y*blend;

    const shp = worldToScreen({x:hx, y:hy});
    const headW = 80 * car.headScale;
    const headH = 80 * car.headScale;
    drawSprite(IMG.head, shp.x, shp.y, headW, headH, ch.angle*0.15);
  }

  function render() {
    ctx.clearRect(0,0,window.innerWidth,window.innerHeight);
    drawTerrain();
    drawCar();
  }

  let last = performance.now();
  function tick(now) {
    const dtMs = Math.min(33, now - last);
    last = now;
    const dt = dtMs / 16.666;

    if (running) {
      applyDrive(dt);
      Engine.update(engine, dtMs);

      camX = car.chassis.position.x;
      camY = car.chassis.position.y - 80;

      const dx = car.chassis.position.x - car.lastX;
      if (dx > 0) car.dist += dx * 0.02;
      car.lastX = car.chassis.position.x;

      if (car.head.position.y > car.chassis.position.y + 48) {
        gameOver("Kopf berührt");
      }
      updateHUD();
    }

    render();
    requestAnimationFrame(tick);
  }

  function startGame() {
    setVisible(menu, false);
    resetGame();
  }
  function backToMenu() {
    running = false;
    setVisible(gameover, false);
    setVisible(menu, true);
  }

  ["pointerdown","touchstart","click"].forEach(ev => {
    btnStart.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); startGame(); }, {passive:false});
    btnBack.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); backToMenu(); }, {passive:false});
  });

  (async () => {
    const [body,wheel,torso,head] = await Promise.all([
      loadImg(ASSETS.body),
      loadImg(ASSETS.wheel),
      loadImg(ASSETS.torso),
      loadImg(ASSETS.head),
    ]);
    IMG = {body,wheel,torso,head};

    engine = Engine.create();
    engine.gravity.y = 1.15;
    world = engine.world;
    resetTerrain();
    car = createCar(0, gndY - 80);
    running = false;

    requestAnimationFrame(tick);
  })();

})();
