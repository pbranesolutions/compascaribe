const hero = document.querySelector(".conversation-hero");
const canvas = document.querySelector(".shore-wave");
const photo = new Image();
photo.src = "/shoreline.webp";
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// A single user-triggered swash. No idle animation or extra network/model calls.
export function washRequest(input) {
  if (reduced.matches) return Promise.resolve();
  const stage = canvas.parentElement;
  const bounds = stage.getBoundingClientRect();
  const box = input.getBoundingClientRect();
  const width = bounds.width;
  const height = bounds.height;
  const scale = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve();
  ctx.scale(scale, scale);
  const echo = document.createElement("p");
  echo.className = "sand-echo";
  echo.setAttribute("aria-hidden", "true");
  echo.textContent = input.value;
  Object.assign(echo.style, {
    left: `${box.left - bounds.left}px`,
    top: `${box.top - bounds.top}px`,
    width: `${box.width}px`,
    font: getComputedStyle(input).font,
    maxHeight: `${box.height}px`,
    overflow: "hidden",
  });
  stage.append(echo);
  hero.classList.add("is-washing");
  const origin = height * 0.52;
  const reach = Math.min(height * 0.93, box.bottom - bounds.top + 70);
  const start = performance.now();
  const duration = 3100;
  return new Promise((resolve) => {
    function draw(now) {
      const t = Math.min(1, (now - start) / duration);
      const surge =
        t < 0.46
          ? Math.sin(((t / 0.46) * Math.PI) / 2)
          : Math.pow(Math.cos((((t - 0.46) / 0.54) * Math.PI) / 2), 1.4);
      const edge = origin + (reach - origin) * surge;
      const fade = Math.min(1, t * 9, (1 - t) * 9);
      ctx.clearRect(0, 0, width, height);
      const points = [];
      for (let x = -10; x <= width + 10; x += 6) {
        points.push([
          x,
          edge +
            Math.sin(x * 0.012 + t * 3) * 13 +
            Math.sin(x * 0.043 - t * 5) * 4,
        ]);
      }
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(width + 10, 0);
      for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(...points[i]);
      ctx.closePath();
      ctx.clip();
      const water = ctx.createLinearGradient(0, 0, 0, edge);
      water.addColorStop(0, "#246d78");
      water.addColorStop(0.52, "#4faba9");
      water.addColorStop(1, "#88bcb1");
      ctx.fillStyle = water;
      ctx.fillRect(0, 0, width, height);
      if (photo.complete && photo.naturalWidth) {
        ctx.globalAlpha = fade * 0.76;
        ctx.drawImage(
          photo,
          0,
          photo.naturalHeight * 0.12,
          photo.naturalWidth,
          photo.naturalHeight * 0.2,
          0,
          -t * 30,
          width,
          edge + 40,
        );
      }
      ctx.globalAlpha = fade * 0.28;
      for (let row = 0; row < 20; row++) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 12) {
          const y =
            edge -
            row * 22 +
            Math.sin(x * 0.016 + row + t * 5) * (3 + row * 0.3);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "#d9f4e5";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
      for (let band = 0; band < 4; band++) {
        ctx.beginPath();
        points.forEach(([x, y], i) => {
          const py = y - band * 5 + Math.sin(x * 0.11 + band) * 2;
          i ? ctx.lineTo(x, py) : ctx.moveTo(x, py);
        });
        ctx.strokeStyle = `rgba(249,255,240,${fade * (0.62 - band * 0.11)})`;
        ctx.lineWidth = 7 - band;
        ctx.stroke();
      }
      // Fine lace bubbles break up the edge instead of a solid cartoon line.
      for (let i = 0; i < Math.ceil(width / 3); i++) {
        const x = (i * 37.7) % width;
        const y =
          edge +
          Math.sin(x * 0.012 + t * 3) * 13 +
          Math.sin(x * 0.043 - t * 5) * 4 -
          (i % 13) * 1.8;
        ctx.beginPath();
        ctx.arc(x, y, 0.7 + (i % 5) * 0.65, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,243,${fade * 0.65})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      const pull = Math.max(0, (t - 0.38) / 0.5);
      echo.style.transform = `translateY(${-pull * height * 0.31}px) scale(${1 - pull * 0.2})`;
      echo.style.opacity = String(Math.max(0, 1 - pull * 2));
      echo.style.filter = `blur(${pull * 6}px)`;
      if (t < 1 && !reduced.matches) requestAnimationFrame(draw);
      else {
        ctx.clearRect(0, 0, width, height);
        echo.remove();
        hero.classList.remove("is-washing");
        resolve();
      }
    }
    requestAnimationFrame(draw);
  });
}
