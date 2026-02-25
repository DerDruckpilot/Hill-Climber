/* Mini Hill Climb – BUILD B024 – SMOKE TEST */
window.__BUILD__ = "BUILD B024";

(function() {
  const buildJs = document.getElementById("buildJs");
  if (buildJs) buildJs.textContent = window.__BUILD__ + " · JS OK";

  const btnStart = document.getElementById("btnStart");
  const menu = document.getElementById("menu");
  const sub = document.getElementById("menuSub");
  const canvas = document.getElementById("c");
  const distEl = document.getElementById("dist");

  function hide(el) { if (el) el.classList.remove("is-visible"); }

  let dist = 0;
  let timer = null;

  function start() {
    if (sub) sub.textContent = "start() OK – Gameplay-Init folgt als Nächstes";
    hide(menu);
    if (timer) clearInterval(timer);
    timer = setInterval(()=>{
      dist += 1;
      if (distEl) distEl.textContent = dist + " m";
    }, 100);
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const w = canvas.width = window.innerWidth;
      const h = canvas.height = window.innerHeight;
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = "rgba(0,255,0,0.9)";
      ctx.font = "20px system-ui,-apple-system";
      ctx.fillText("SMOKE TEST OK ("+window.__BUILD__+")", 20, 80);
    }
  }

  ["pointerdown","touchstart","click"].forEach(ev => {
    if (!btnStart) return;
    btnStart.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); start(); }, {passive:false});
  });

})();
