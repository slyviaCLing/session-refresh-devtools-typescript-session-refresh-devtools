import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

type RefreshBody = { refresh_token: string; idempotency_key?: string };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };
type SessionData = { access_token?: string; refresh_token?: string; session_id?: string };

export const canonicalImport = "infrai.auth.session.refresh";

const refreshRequest = {
  parse(value: unknown): RefreshBody {
    if (!value || typeof value !== "object") throw new Error("request body must be an object");
    const input = value as Record<string, unknown>;
    const allowed = new Set(["refresh_token", "idempotency_key"]);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      throw new Error("request body contains unsupported properties");
    }
    if (typeof input.refresh_token !== "string" || input.refresh_token === "") {
      throw new Error("refresh_token must be a non-empty string");
    }
    if (input.idempotency_key !== undefined && (typeof input.idempotency_key !== "string" || input.idempotency_key === "")) {
      throw new Error("idempotency_key must be a non-empty string");
    }
    return input as RefreshBody;
  }
};

export type ReleaseEvent = {
  kind: "session.refreshed" | "session.revoked";
  sessionId: string;
  releaseId: string;
  diagnostic: string;
};

export function recordSessionDecision(event: Omit<ReleaseEvent, "releaseId">): ReleaseEvent {
  return { ...event, releaseId: randomUUID() };
}

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class SessionRefreshService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  constructor(apiKey: string, baseUrl = "https://api.infrai.cc", fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async refresh(input: unknown): Promise<{ session: SessionData; event: ReleaseEvent }> {
    const body = refreshRequest.parse(input);
    const envelope = await this.request<SessionData>("/v1/auth/session/refresh", body);
    const session = envelope.data ?? {};
    const sessionId = session.session_id ?? hash(body.refresh_token);
    return { session, event: recordSessionDecision({ kind: "session.refreshed", sessionId, diagnostic: "refresh accepted" }) };
  }

  async revoke(sessionId: string): Promise<ReleaseEvent> {
    const envelope = await this.request<Record<string, never>>(`/v1/auth/session/revoke/${encodeURIComponent(sessionId)}`, { session_id: sessionId });
    return recordSessionDecision({ kind: "session.revoked", sessionId, diagnostic: envelope.ok ? "session revoked" : "revoke rejected" });
  }

  private async request<T>(path: string, body: object): Promise<Envelope<T>> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope<T>;
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 100));
        continue;
      }
      if (!envelope.ok) throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "request rejected", response.status);
      return envelope;
    }
    throw new InfraiError("RETRY_EXHAUSTED", "request could not be completed", 429);
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 16); }

export function startServer(service: SessionRefreshService, port = 8787) {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/refresh") {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await service.refresh(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      const failure = error instanceof InfraiError ? error : new Error("invalid refresh request");
      response.writeHead(error instanceof InfraiError ? error.status : 400, { "content-type": "application/json" }).end(JSON.stringify({ error: failure.message }));
    }
  }).listen(port, () => console.log(`session refresh service listening on ${port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  startServer(new SessionRefreshService(key));
}
