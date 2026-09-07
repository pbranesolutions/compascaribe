import "./style.css";
import "./chat.css";
import "./beach.css";
import "./chat.js";

const header = document.querySelector(".site-header");
let frame = 0;
function update() {
  frame = 0;
  header.classList.toggle("scrolled", window.scrollY > 24);
}
window.addEventListener(
  "scroll",
  () => {
    if (!frame) frame = requestAnimationFrame(update);
  },
  { passive: true },
);
document.querySelector("#year").textContent = new Date().getFullYear();
update();
