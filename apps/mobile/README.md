# Chronologity — mobile

The consumer application. React Native on Expo SDK 57.

It speaks REST to the authoritative API and GraphQL to the read-only Timeline
aggregator, and it holds no authority of its own: what it shows is presentation,
and every access decision is the server's (`authorization.md:833`).

## Running it

Three things have to be true before the app can do anything interesting: the
infrastructure is up, both backends are running, and the app knows where they
are.

```sh
# 1. Infrastructure and schema.
pnpm infra:up
pnpm db:migrate

# 2. Both backends, in their own terminals.
pnpm --filter @chronologity/api build && pnpm --filter @chronologity/api start
pnpm --filter @chronologity/feed-aggregator build && pnpm --filter @chronologity/feed-aggregator start

# 3. The app.
pnpm --filter @chronologity/mobile dev
```

Then press `i` for the iOS simulator (needs Xcode), `a` for an Android emulator
(needs Android Studio), or scan the QR code with Expo Go on a phone. Everything
this app uses — `expo-secure-store`, `expo-crypto`, `expo-linking` — ships in
Expo Go, so no development build is required yet.

### Configuring it

**`apps/mobile/.env`, not the repository root one.** Every other application
here reads the root `.env`; this one does not, and a shell that exports the root
file does not help either — measured, not assumed:

| Where the variables are    | Compiled into the bundle |
| -------------------------- | ------------------------ |
| `apps/mobile/.env`         | yes                      |
| the repository root `.env` | no                       |
| exported in your shell     | no                       |

Getting this wrong fails at launch with a configuration error naming the missing
variable, which is the intended behaviour: an address is never safe to guess,
because a wrong one does not fail — it succeeds against something else.

```sh
cp apps/mobile/.env.example apps/mobile/.env
```

### Which address to use

This is the most common reason a device cannot reach a machine that is plainly
serving requests:

| Running on         | Host to use                                     |
| ------------------ | ----------------------------------------------- |
| iOS simulator      | `localhost` — it shares the host's network      |
| Android emulator   | `10.0.2.2` — the emulator's alias for the host  |
| Expo Go on a phone | your machine's LAN address, e.g. `192.168.1.24` |

`localhost` on a phone is the phone. `expo start` prints the address it is
serving on — `exp://172.20.3.161:8081` or similar — and that host is the one a
phone can reach, so it is the right one to put in `.env`.

### Signing in

The sign-in screen calls `POST /auth/sessions/password`, so an account has to
exist first. There is no seeded password account — `pnpm --filter
@chronologity/api seed:history` creates Moments and people, not credentials — so
register one against the running API:

```sh
curl -X POST http://localhost:3000/auth/registrations \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.test","password":"a-sufficiently-long-password"}'
```

Email verification goes to Mailpit rather than anywhere real; open it at
http://localhost:8025 to find the link.

## What is here, and what is not

This is the bootstrap (roadmap Phase 11). It exists to prove the seams: the app
opens, signs in, remembers that Session across launches in the platform's secure
store, and reads real Moments from the aggregator.

The Timeline's actual navigation — vertical for time, horizontal for
perspective, depth into a Moment (`timeline.md:7-15`) — is Phase 12, along with
media, uploads, notifications, and moderation surfaces. What is here is one
chronological list and the wiring beneath it.

Deliberately absent, each with the decision that says why: offline support
(ADR-154, gated on `caching.md:982`), persisted GraphQL queries (ADR-154 — they
need documents that are stable, and these are not yet), a crash and performance
reporter (`observability.md:1891-1896` leaves the provider open), and biometric
unlock (ADR-155).

## Two things `expo install --check` will tell you

**`typescript` "should be updated" to `~6.0.3`.** It should not. This workspace
standardises on TypeScript 7 and every package declares it; `tsc --noEmit`, the
Metro bundle, and CI all pass on 7. The warning compares against the version
Expo ships its templates with, and following it would put a second TypeScript in
the repository to satisfy a check rather than a problem.

**Run it from here**, not from the repository root:

```sh
pnpm --filter @chronologity/mobile exec expo install --check
```

From the root it fails with "the module `expo` is not installed", because it is
not — it belongs to this application. And never use `npm` anywhere in this
repository: it cannot parse the `workspace:*` protocol pnpm uses.

## Tests

```sh
pnpm --filter @chronologity/mobile test
```

Jest rather than Vitest, alone in this repository. ADR-076 anticipated it:
`jest-expo` mocks the native half of every Expo module, and nothing else does.

Two notes for anyone writing more of them. React Native Testing Library 14 made
both `render` and `fireEvent` asynchronous, because React 19 renders
concurrently — a missing `await` shows up as an element that is not there yet.
And `SafeAreaProvider` renders nothing at all without window metrics, so tests
pass their own; `Providers` takes them as a prop for exactly that reason.
