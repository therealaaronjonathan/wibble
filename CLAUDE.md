# Wibble

Mobile-first PWA that mirrors one person's Freestyle Libre glucose, makes
quick logging effortless, and shows a daily note of appreciation. Type 1
diabetes companion, not a medical device: it must never suggest a dose.

- `README.md` — overview, architecture, local setup, deploy.
- `PRD.md` — v1 product spec (2026-06). Later features are in `CHANGELOG.md`.
- `CHANGELOG.md` — what actually shipped and the decisions behind it.
- `docs/iob-calculation-spec.md` — insulin-on-board math.

Conventions: `npm run lint` (tsc) and `npm test` (vitest) must pass. Keep a
single `fractionRemaining` in `src/iob.ts`. Patient identity comes from
`.env.local` (see `.env.example`), never from source.
