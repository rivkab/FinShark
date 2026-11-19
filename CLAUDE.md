# FinShark

Local-first household financial evidence archive: import financial PDFs, record
numbers from them with exact provenance (document, page, box), verify them,
query them deterministically, and back everything up as one encrypted file.

**`docs/DESIGN.md` is the source of truth.** Read §0, §2 and the §14 decisions
log before changing anything structural. If code and design disagree, raise it;
don't silently diverge.

## Hard rules

- **No network.** The core never makes outbound requests. Do not add HTTP
  clients, telemetry, update checks, CDNs or remote fonts. The server binds to
  127.0.0.1 only.
- **No floats for money.** Money is integer minor units (`bigint` in TS,
  `INTEGER` in SQLite) plus an ISO 4217 currency. Exact decimals (exchange rates,
  shares) are strings computed with `decimal.js`. Never `Number` arithmetic on
  money, never `REAL` columns for money.
- **Never silently produce an answer.** Unverified, missing, conflicting or
  converted values are always surfaced, never dropped or guessed.
- **Append-only where the schema says so** (`facts`, `fact_sources`,
  `fact_events`, `query_snapshots`, `extraction_runs`). Corrections create new
  rows. See comments in `server/src/db/migrations/001_initial.sql`.
- **Never edit an applied migration.** Schema changes are new numbered files.
- **Dependencies are a privacy risk.** Don't add packages without a clear need;
  pin exact versions; install scripts are disabled (`.npmrc`). Prefer Node built-ins.
- **No real financial documents in the repo.** Test PDFs are generated with
  `server/src/testing/pdf-fixture.ts` and contain fake data only. Never commit vaults,
  `.db` files or backups.
- Deterministic code: extractors and the query engine take the clock, IDs and
  randomness as inputs where outputs depend on them, so tests are reproducible.

## Stack

- Node 24 (`.nvmrc`), TypeScript run directly by Node (type stripping). Only
  erasable syntax: no `enum`, no `namespace`, no constructor parameter properties.
  Relative imports use the `.ts` extension.
- SQLite via built-in `node:sqlite` (`DatabaseSync`). Plain SQL, no ORM.
- Server: Fastify. Web: Vite + React. PDFs: `pdfjs-dist` on both sides.
- Backups: `age-encryption` + `tar-stream`. Decimals: `decimal.js`.
- Tests: Vitest, colocated as `*.test.ts`.

## Layout

```
shared/src/      types used by server and web (money, query definitions, API types)
server/src/
  db/            migrations, migration runner, seed data, DB access
  vault/         vault layout, create/open, lock, integrity checks
  documents/     import pipeline, text layer, duplicates
  backup/        create / verify / restore encrypted backups
  devdata/       generated development vault (`npm run seed-dev`)
  http/          Fastify app, localhost security, API routes
  main.ts        entry point
web/src/         React app
docs/DESIGN.md   design and decisions log
spikes/          throwaway experiments, not part of the app
```

## Commands

```
FINSHARK_VAULT=~/FinShark-vault npm start   # use the app (from the release checkout, see below): builds web, serves it at http://127.0.0.1:4780
npm test            # vitest, all workspaces
npm run typecheck   # tsc -b
npm run dev:server  # development: node --watch (restarts on source changes, new login token each time)
npm run dev:web     # development: Vite dev server, proxies /api to the server on port 4780
npm run seed-dev    # (re)create dev-vault/ with generated data; -- --vault <path> for another
```

The server uses port 4780 by default. If it is taken, it falls back to a random free
loopback port and says so. `FINSHARK_PORT=n` forces a port (error if unavailable; also
read by `dev:web` for its proxy target).

Use `nvm use` first if `node -v` isn't 24.

## Development and release (DESIGN D22)

Develop against generated data; run real data only from released code.

- **This checkout is for development.** Leave `FINSHARK_VAULT` unset: the server uses
  `dev-vault/`. `npm run seed-dev` resets it to a known household. Run dev on another port
  so it doesn't collide with the release app: `FINSHARK_PORT=4781 npm run dev:server` and
  `FINSHARK_PORT=4781 npm run dev:web`.
- **The real vault lives outside the repo** (e.g. `~/FinShark-vault`) and is opened by a
  release checkout, a worktree detached at `main`:
  ```
  git worktree add --detach ~/FinShark-release main
  cd ~/FinShark-release && nvm use && npm ci
  FINSHARK_VAULT=~/FinShark-vault npm run make-app     # FinShark.app runs this checkout
  ```
- **To release:** merge to `main` (optionally `git tag vN`), back up the real vault from the
  app, then `git -C ~/FinShark-release checkout --detach main && (cd ~/FinShark-release && npm ci)`
  and reopen FinShark.app. Rolling back means checking out the older commit *and* restoring
  the backup, since the newer migrations have already run.
- **The guard:** the server refuses to create or open a vault without `"dev": true` in
  `vault.json` unless HEAD is on `main` and the working tree is clean. Never point dev code at
  the real vault; `FINSHARK_ALLOW_UNRELEASED=1` exists for emergencies only.

## Terminology

- **Vault**: the data directory (`finance.db` + `documents/` + ...).
- **Concept**: a registered kind of number (`balance.ending`), see DESIGN §2.4.
- **Fact**: one value of a concept, with period, status and sources.
- **Query definition**: the JSON form of a question (DESIGN §4; earlier drafts
  call it "query IR").
- UI chrome is English; data labels follow the source's language (DESIGN §14 D3).
