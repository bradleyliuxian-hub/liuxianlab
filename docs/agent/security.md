# security

Read when a task touches auth, sessions, uploads, downloads, paths, or secrets.

- Auth: `requireAuth` in `server.js` (JSON 401 for `/api/*`, redirect `/login`).
- State-changing routes also pass `sameOriginForStateChange`.
- Never add public signup; never weaken Helmet/CSP/rate-limit/session.
- Private artifacts are served only via owner-scoped APIs, path derived
  server-side from a UUID; no client-supplied paths.
- Protected data (never commit/print/copy): `.env`, `data/users.json`,
  `sessions/`, `storage/`, `.mineru/`, logs, keys/tokens/cookies.
- Never hardcode secrets, domains, or absolute local paths.

Authority: `AGENTS.md` §3 and `server.js`.
