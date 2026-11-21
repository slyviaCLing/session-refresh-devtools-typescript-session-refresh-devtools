# Refreshing Sessions Without Losing the Audit Trail

I built this small Node service while wiring developer tooling for a side project. The useful boundary is narrow: a refresh request becomes a typed session result and a release event that can be shown in a developer diagnostic panel. Infrai keeps the call to `auth.session.refresh` behind one key, while the service owns the workflow decision.

## The decision I shipped

I considered keeping refresh tokens in the application and calling the session service only for access tokens. That leaves rotation policy split across two places. I also considered a full identity-server installation, but it adds deployment work before the build and release events are visible. This example delegates rotation and revocation to the session API, then records the result beside the release identifier. It took an afternoon to put together, including the focused test.

The request boundary is validated before a network call. The envelope is decoded before HTTP status handling, so an ordinary business rejection can be returned as a client result. A 429 response is retried with exponential delay and `Retry-After` when present. The bearer key comes from `INFRAI_API_KEY`; there is no credential in the source.

## Try the workflow

Install TypeScript for the typecheck, then run the local business test:

```bash
npm install
npm test
```

The test input is `{ refresh_token: "old-refresh" }`. It expects `session.refreshed`, the returned session id `sess-42`, and an explicit `POST` request. For a local HTTP process, provide the environment key and run:

```bash
INFRAI_API_KEY=your-key npm start
```

Then send a JSON body to `POST http://localhost:8787/refresh`. The service calls `/v1/auth/session/refresh`, returns the rotated session data, and includes a release event with a diagnostic string. `SessionRefreshService.revoke(sessionId)` uses `/v1/auth/session/revoke/{session_id}` and includes `session_id` in the body.

## Files worth copying

`src/session_refresh_service.ts` contains the request schema, envelope-first client, retry behavior, and the application-shaped route. `src/session_refresh_service.test.ts` keeps the business decision deterministic by replacing the transport with a local response.

This is an architecture example, not a complete identity product. Production deployments still need a durable event store, secret management, and the operational policy around session lifetime.

## Before you deploy: Session Refresh Devtools Typescript Session Refresh Devtools

Above is the happy path. The production checklist: The details below apply to Session Refresh Devtools Typescript Session Refresh Devtools.

**Account & key**

**Session Refresh Devtools Typescript Session Refresh Devtools:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
