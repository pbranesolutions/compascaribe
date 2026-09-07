import {
  MODEL,
  MAX_TURNS,
  MAX_OUTPUT_TOKENS,
  MAX_CONTEXT_BYTES,
  BriefError,
  readPayload,
  systemPrompt,
  boundedReply,
  byteLength,
  importSigningKey,
  signSession,
  readSession,
  hashVisitor,
} from "./policy.js";
import { RESERVE_SQL, ALLOWANCE_SQL } from "./queries.js";

const messages = {
  too_long: "Please keep your message to a few short sentences.",
  invalid_request: "Please send a short description of your project.",
  invalid_session:
    "This conversation has expired. You can still email your brief to our team.",
  session_limit:
    "We have a useful starting point. Email your brief and we can take it further.",
  visitor_limit:
    "Let’s continue this with our team. You can email your idea directly.",
  daily_limit:
    "The assistant is taking a break. Our team can still help by email.",
  slow_down: "Give that a moment, then send your next message.",
  unavailable:
    "The assistant couldn’t respond just now. Your idea is still here, and you can email it to our team.",
};
function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (url.pathname !== "/api/brief") return json({ error: "not_found" }, 404);
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  // Browser origin checks are a CSRF control, not the cost-control boundary.
  if (request.headers.get("origin") !== url.origin)
    return json({ error: "forbidden" }, 403);
  try {
    if (env.BRIEF_ENABLED !== "true") throw new BriefError("unavailable", 503);
    const { message, continuation } = await readPayload(request);
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const key = await importSigningKey(
      await env.BRIEF_DB.prepare(
        "SELECT value FROM brief_keys WHERE id=1",
      ).first("value"),
    );
    const ip = await hashVisitor(
      request.headers.get("CF-Connecting-IP") || "local-preview",
      day,
      key,
    );
    const state = await readSession(continuation, key, ip, now);
    if (state.turn >= MAX_TURNS) throw new BriefError("session_limit", 429);
    const turn = state.turn + 1;
    const modelMessages = [
      { role: "system", content: systemPrompt(turn) },
      ...state.history,
      { role: "user", content: message },
    ];
    if (byteLength(JSON.stringify(modelMessages)) > MAX_CONTEXT_BYTES)
      throw new BriefError("session_limit", 429);

    // A conditional database insert reserves ALL quotas atomically before inference.
    // Failed inference, replay, and concurrent requests never get free retries.
    {
      const reservations = await env.BRIEF_DB.batch([
        env.BRIEF_DB.prepare(
          "DELETE FROM brief_usage WHERE created_at < ?",
        ).bind(now - 7 * 86400000),
        env.BRIEF_DB.prepare(RESERVE_SQL).bind(
          crypto.randomUUID(),
          state.id,
          ip,
          day,
          turn,
          now,
        ),
      ]);
      if (!reservations[1].results?.length) {
        const counts = await env.BRIEF_DB.prepare(ALLOWANCE_SQL)
          .bind(day, ip, state.id, turn)
          .first();
        const code =
          counts.daily >= 100
            ? "daily_limit"
            : counts.visitor >= 8
              ? "visitor_limit"
              : counts.session >= 4
                ? "session_limit"
                : counts.replay
                  ? "invalid_session"
                  : "slow_down";
        throw new BriefError(code, 429);
      }
    }

    // One inference per reservation. No tools, automatic retries, or fallback models.
    const result = await env.AI.run(
      MODEL,
      {
        messages: modelMessages,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.35,
        stream: false,
      },
      { signal: AbortSignal.timeout(18000) },
    );
    const reply = boundedReply(result.response);
    const next = {
      ...state,
      turn,
      history: [
        ...state.history,
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ],
    };
    return json({
      reply,
      continuation: await signSession(next, key),
      done: turn === MAX_TURNS,
    });
  } catch (error) {
    const code = error instanceof BriefError ? error.code : "unavailable";
    // Do not log prompts, continuation tokens, provider errors, or message bodies.
    if (code === "unavailable")
      console.warn(JSON.stringify({ event: "brief_unavailable" }));
    return json(
      {
        error: code,
        message: messages[code] || messages.unavailable,
        handoff: !["too_long", "invalid_request", "slow_down"].includes(code),
      },
      error instanceof BriefError ? error.status : 503,
    );
  }
}
