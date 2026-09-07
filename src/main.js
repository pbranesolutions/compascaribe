import "./style.css";

const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(pointer: fine)");
const hero = document.querySelector(".hero");
const stage = document.querySelector(".hero-stage");
const firstCopy = document.querySelector(".hero-copy");
const nextCopy = document.querySelector(".hero-next");
const sculpture = document.querySelector(".sculpture");
const rings = [...document.querySelectorAll(".ring")];
const header = document.querySelector(".site-header");
const scrollWheel = document.querySelector(".scroll-wheel i");
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// Stacked, masked surfaces give each bearing a physical edge without a renderer.
for (const ring of rings) {
  const fragment = document.createDocumentFragment();
  for (let layer = 0; layer < 12; layer++) {
    const surface = document.createElement("i");
    surface.style.setProperty("--depth", `${layer * 1.1}px`);
    fragment.append(surface);
  }
  ring.replaceChildren(fragment);
}

let frame = 0;
let progress = 0;
let pointerX = 0;
let pointerY = 0;
let currentX = 0;
let currentY = 0;
let scrollRange = 1;
let heroTop = 0;
const restingAngles = [
  [54, -24, -28],
  [-42, 51, 34],
  [58, 22, -42],
];
const alignedAngles = [
  [66, 0, 160],
  [66, 0, 260],
  [66, 0, 330],
];

function measure() {
  scrollRange = Math.max(1, hero.offsetHeight - stage.offsetHeight);
  heroTop = hero.offsetTop;
  requestRender();
}

function render() {
  frame = 0;
  const scrollY = window.scrollY;
  header.classList.toggle("scrolled", scrollY > 24);
  if (motionPreference.matches) return;

  const target = clamp((scrollY - heroTop) / scrollRange);
  progress += (target - progress) * 0.14;
  currentX += (pointerX - currentX) * 0.12;
  currentY += (pointerY - currentY) * 0.12;
  if (Math.abs(target - progress) < 0.0001) progress = target;
  const fade = clamp((progress - 0.27) / 0.25);
  firstCopy.style.opacity = `${1 - fade}`;
  firstCopy.style.visibility = fade >= 0.999 ? "hidden" : "visible";
  firstCopy.style.transform = `translateY(${-fade * 25}px)`;
  firstCopy.inert = fade > 0.9;
  const reveal = clamp((progress - 0.43) / 0.25);
  nextCopy.style.opacity = `${reveal}`;
  nextCopy.style.visibility = reveal > 0 ? "visible" : "hidden";
  nextCopy.style.transform = `translateY(${(1 - reveal) * 25}px)`;
  stage.style.setProperty("--progress", progress.toFixed(4));
  sculpture.style.setProperty("--pointer-x", `${currentX}deg`);
  sculpture.style.setProperty("--pointer-y", `${currentY}deg`);
  scrollWheel.style.transform = `translateY(${progress * 4}px)`;

  rings.forEach((ring, index) => {
    const angles = restingAngles[index].map(
      (angle, axis) => angle + (alignedAngles[index][axis] - angle) * progress,
    );
    ring.style.transform = `rotateX(${angles[0]}deg) rotateY(${angles[1]}deg) rotateZ(${angles[2]}deg)`;
  });
  // Stop scheduling frames when the interaction settles.
  if (
    Math.abs(target - progress) > 0.0001 ||
    Math.abs(pointerX - currentX) > 0.01 ||
    Math.abs(pointerY - currentY) > 0.01
  )
    requestRender();
}

function requestRender() {
  if (!frame) frame = requestAnimationFrame(render);
}

function setMotionMode() {
  document.documentElement.classList.toggle(
    "motion-ready",
    !motionPreference.matches,
  );
  if (motionPreference.matches) {
    for (const element of [
      firstCopy,
      nextCopy,
      sculpture,
      stage,
      scrollWheel,
      ...rings,
    ])
      element.removeAttribute("style");
    firstCopy.inert = false;
    pointerX = pointerY = currentX = currentY = progress = 0;
  }
  measure();
}

window.addEventListener("scroll", requestRender, { passive: true });
window.addEventListener("resize", measure, { passive: true });
window.addEventListener("pageshow", measure);
motionPreference.addEventListener("change", setMotionMode);
stage.addEventListener(
  "pointermove",
  (event) => {
    if (motionPreference.matches || !finePointer.matches) return;
    pointerX = (event.clientX / window.innerWidth - 0.5) * 9;
    pointerY = (event.clientY / window.innerHeight - 0.5) * -7;
    requestRender();
  },
  { passive: true },
);
stage.addEventListener("pointerleave", () => {
  pointerX = pointerY = 0;
  requestRender();
});

// Native links preserve browser history, keyboard use, and ordinary scrolling.
document.querySelectorAll('a[href="#top"]').forEach((link) => {
  link.addEventListener("click", () => {
    firstCopy.inert = false;
  });
});
document.querySelector("#year").textContent = new Date().getFullYear();
setMotionMode();
