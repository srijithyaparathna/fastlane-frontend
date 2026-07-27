# FastLane Frontend

A dashboard for the FastLane pre-consensus attestation chain. It connects to the
node directly over WebSocket (via `@polkadot/api`) for live reads and signing,
and to the FastLane REST API for convenience queries.

- **Stack:** React 19, TanStack Start + Router, Vite, Tailwind, Radix UI.
- **Live:** https://pre-consensus-attestation-pallet-fastlane.projectfreedom.io/

---

## Running

```bash
bun install          # or npm install
bun run dev          # vite dev server

# Production (how it is deployed): served by wrangler, managed by pm2
pm2 restart fastlane-frontend   # picks up src/ changes (wrangler dev serves from source)
```

`wrangler dev` listens on `127.0.0.1:3000`; nginx proxies the public host to it.
Because it serves from source, a `pm2 restart` is enough to ship a code change —
no separate build step is required for the running deployment.

---

## Connection layer — `src/lib/fastlane.ts`

- `NODE_WS` — chain WebSocket endpoint; `getApi()` returns a memoised `ApiPromise`.
- `API_BASE` — FastLane REST API base (`/api`).
- `statusInfo(status)` — maps a status string to a label/colour/emoji
  (Submitted ⏳ / PreConsensed ✅ / Finalised 🏆 / Expired 💀).
- `accountName(address)`, `truncate()`, `randomHash()`, `copy()` — UI helpers.

### Phase 2 (§14) helpers
- `fetchAggregate(api, payloadId)` → `{ signerBitmap, digest, count } | null` —
  the compact aggregate that survives finalisation.
- `aggregateSigners(api, aggregate)` → `string[]` — authority addresses whose
  bitmap bit is set, resolved against the live authority set.
- `fetchInclusions(api, payloadId)` → `InclusionCommitment[]` — authorities'
  finalise-by-deadline promises.
- `inclusionMsgHash(api, payloadId, deadline)` → the exact bytes an authority
  signs for a commitment: `blake2_256(payloadId ++ "INCLUDE" ++ deadline)`.

---

## State — `src/hooks/useFastLane.tsx`

`FastLaneProvider` / `useFastLane()` expose:

- `api`, `state` (`connecting|connected|disconnected`), `block`, `chain`.
- `accounts`, `selected`, `setSelected` — dev keyring accounts (Alice…Ferdie).
- Polkadot.js **extension** support: `connectWallet`, `login`, `logout`,
  `extAddresses`, `loggedIn`.
- `getSigner(address)` → `{ type: "keypair", pair }` (dev seed) or
  `{ type: "extension", injector }`. Used to sign & send transactions.
- `events` — a live feed of recent FastLane events (see `useFastLaneEvents`).

---

## Routes — `src/routes/`

| Route | Purpose |
|-------|---------|
| `/` | Overview / landing. |
| `/submit` | Submit a new payload (`fastlane.submit`). |
| `/tracker` | Inspect a payload: details, attestations, **aggregate**, **inclusion commitments**, finalize. |
| `/events` | Live event feed. |
| `/bonds` | Authority bonds (`post_bond`). |
| `/setup` | Committee / threshold setup. |
| `/login` | Polkadot.js extension sign-in. |

---

## Payload Tracker (`/tracker`) — Phase 2 UI

Looking up a payload id shows, in addition to details and per-authority
attestations:

1. **Signature Aggregate** card — signature count, `signerBitmap`, `digest`, and
   the resolved list of signing authorities. Present once the payload reached
   threshold; remains visible after finalisation (the raw signatures are pruned
   on-chain but the aggregate is retained).
2. **Inclusion Commitments** card — lists existing commitments and, while the
   payload is `PreConsensed`, offers a **Commit Inclusion** action: enter a
   deadline block, and the selected authority's dev key signs
   `inclusionMsgHash(...)` and submits `fastlane.commitInclusion`.

> ⚠️ **Commit Inclusion requires a dev keypair** (an authority's `//Name` seed),
> not an extension account — only a raw sr25519 signature over the message hash
> verifies on-chain; extension `signRaw` wraps the payload and would fail.
>
> ℹ️ **Timing.** Payloads stay `PreConsensed` for `FinalizeDelay` blocks
> (`= 10`, ~60s) before auto-finalising, so commit within that window — after it,
> the payload is `Finalised` and the action returns `NotPreConsensed`. See the
> pallet reference (`docs/PALLET_REFERENCE.md` §9.1/§9.3) for the deferred-
> finalisation design.

---

## How the pieces connect

```
Browser (this app)
  ├── @polkadot/api  ──ws──▶  FastLane node (reads, signs & sends extrinsics)
  └── fetch(API_BASE) ─http─▶ FastLane REST API ──ws──▶ same node
```

Writes (submit, attest, finalize, commit_inclusion) go **directly** to the chain
through `@polkadot/api` using `getSigner`. The REST API is used for convenient
aggregated reads and server-side-signed helpers.
