import "./style.css";
import "./chat.css";
import "./chat.js";

const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(pointer: fine)");
const sculpture = document.querySelector(".sculpture");
const rings = [...document.querySelectorAll(".ring")];
const header = document.querySelector(".site-header");
for (const ring of rings) {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 12; i++) {
    const surface = document.createElement("i");
    surface.style.setProperty("--depth", `${i * 1.1}px`);
    fragment.append(surface);
  }
  ring.replaceChildren(fragment);
}
let frame = 0;
let pointer = 0;
function render() {
  frame = 0;
  header.classList.toggle("scrolled", window.scrollY > 24);
  if (motion.matches) return;
  const progress = Math.min(1, window.scrollY / window.innerHeight);
  rings.forEach((ring, i) => {
    ring.style.transform = `rotateX(${[54, -42, 58][i] + progress * 25}deg) rotateY(${[-24, 51, 22][i] + pointer}deg) rotateZ(${[-28, 34, -42][i] + progress * 150}deg)`;
  });
}
function requestRender() {
  if (!frame) frame = requestAnimationFrame(render);
}
window.addEventListener("scroll", requestRender, { passive: true });
window.addEventListener("resize", requestRender, { passive: true });
document.querySelector(".hero-stage").addEventListener(
  "pointermove",
  (event) => {
    if (motion.matches || !finePointer.matches) return;
    pointer = (event.clientX / window.innerWidth - 0.5) * 8;
    requestRender();
  },
  { passive: true },
);
motion.addEventListener("change", () => {
  rings.forEach((r) => r.removeAttribute("style"));
  requestRender();
});
document.querySelector("#year").textContent = new Date().getFullYear();
requestRender();
