import assert from "node:assert/strict";
import test from "node:test";
import { SessionRefreshService } from "./session_refresh_service.ts";

test("a successful rotation produces a refreshed release event", async () => {
  const calls: RequestInit[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    calls.push(init as RequestInit);
    return new Response(JSON.stringify({ ok: true, data: { access_token: "new-access", refresh_token: "next-refresh", session_id: "sess-42" }, metadata: {} }), { status: 200 });
  };
  const service = new SessionRefreshService("test-key", "https://example.test", fetcher);
  const result = await service.refresh({ refresh_token: "old-refresh" });
  assert.equal(result.event.kind, "session.refreshed");
  assert.equal(result.event.sessionId, "sess-42");
  assert.equal(calls[0].method, "POST");
  assert.match(String(calls[0].body), /refresh_token/);
});
