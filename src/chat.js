import { washRequest } from "./shoreline.js";
const form = document.querySelector("#idea-form");
const input = document.querySelector("#idea-input");
const submit = document.querySelector("#idea-submit");
const log = document.querySelector("#chat-log");
const status = document.querySelector("#chat-status");
const handoff = document.querySelector("#brief-handoff");
const email = document.querySelector("#email-brief");
const history = [];
let continuation = null;
let busy = false;
let finished = false;

function briefText() {
  return `Hello Compás Caribe,\n\nI'd like to explore this project:\n\n${history
    .filter((m) => m.role === "You")
    .map((m) => m.text)
    .join("\n\n")}\n\n${
    history.some((m) => m.role !== "You")
      ? "Project exploration (AI-assisted, not an agreed scope or quote):\n" +
        history
          .filter((m) => m.role !== "You")
          .map((m) => m.text)
          .join("\n\n")
      : ""
  }\n\nMy name:\nCompany:\nBest way to reach me:`;
}
function updateHandoff() {
  handoff.hidden = false;
  // Keep mailto drafts compact; Copy brief retains the complete conversation.
  const idea = history.find((m) => m.role === "You")?.text || "";
  const summary = history.filter((m) => m.role !== "You").at(-1)?.text || "";
  const draft = `Hello Compás Caribe,\n\nMy idea: ${idea.slice(0, 400)}\n\nProject exploration (not an agreed scope or quote): ${summary.slice(0, 450)}\n\nI can share the full conversation.\n\nName:\nCompany:\nBest way to reach me:`;
  email.href = `mailto:hello@compascaribe.com?subject=${encodeURIComponent("Let’s explore a project")}&body=${encodeURIComponent(draft)}`;
}
function append(role, text) {
  history.push({ role, text });
  const message = document.createElement("div");
  message.className = `chat-message ${role === "You" ? "from-visitor" : "from-assistant"}`;
  const label = document.createElement("span");
  label.className = "message-role";
  label.textContent = role;
  const body = document.createElement("p");
  body.textContent = text;
  message.append(label, body);
  log.append(message);
  log.scrollTop = log.scrollHeight;
}
function setBusy(value) {
  busy = value;
  input.disabled = value || finished;
  submit.disabled = value || finished;
  form.setAttribute("aria-busy", String(value));
  submit.querySelector("span").textContent = value ? "Thinking…" : "Send";
}

document.querySelectorAll("[data-idea]").forEach((button) =>
  button.addEventListener("click", () => {
    input.value = button.dataset.idea;
    input.focus();
  }),
);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || finished) return;
  const message = input.value.trim();
  if (!message) return;
  if (new TextEncoder().encode(message).length > 800) {
    status.textContent = "Please keep your idea to a few short sentences.";
    return;
  }
  setBusy(true);
  // Preserve the input while the wave arrives, then reveal the saved conversation.
  if (!history.length) await washRequest(input);
  document.querySelector(".conversation-hero").classList.add("is-active");
  document.querySelector("#conversation").hidden = false;
  document.querySelector("#idea-suggestions").hidden = true;
  if (history.at(-1)?.role !== "You" || history.at(-1)?.text !== message)
    append("You", message);
  input.value = "";
  setBusy(true);
  status.textContent = "Considering your idea…";
  updateHandoff();
  try {
    const response = await fetch("/api/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        continuation,
        website: document.querySelector("#website-field").value,
      }),
      signal: AbortSignal.timeout(23000),
    });
    const data = await response.json();
    if (!response.ok) {
      status.textContent =
        data.message ||
        "The assistant couldn’t respond. You can still email your idea to us.";
      finished = data.handoff !== false;
      // Keep retryable validation/rate-limit text in the composer, without a hidden retry.
      if (!finished) input.value = message;
    } else {
      if (
        typeof data.reply !== "string" ||
        typeof data.continuation !== "string"
      )
        throw new Error("Invalid response");
      continuation = data.continuation;
      append("Compás Caribe", data.reply);
      finished = Boolean(data.done);
      status.textContent = finished
        ? "A good starting point. Our team can help with the next step."
        : "";
    }
  } catch {
    finished = true;
    status.textContent =
      "The connection didn’t come through. Your idea is still here — email it to our team.";
  } finally {
    updateHandoff();
    setBusy(false);
    if (finished) form.hidden = true;
    else input.focus({ preventScroll: true });
    log.scrollTop = log.scrollHeight;
  }
});

document.querySelector("#copy-brief").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(briefText());
    status.textContent =
      "Brief copied. You can paste it into an email to hello@compascaribe.com.";
  } catch {
    status.textContent =
      "Copy isn’t available here. Use Email this brief to open the draft in your email app.";
  }
});

// Enable the composer only after its guarded submit handler is installed.
input.disabled = false;
submit.disabled = false;
