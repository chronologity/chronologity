# Chronologity Authentication Architecture

## Purpose

This document defines the authentication architecture for Chronologity.

Authentication establishes **who** is making a request and which active session or credential context backs that identity.

Authorization answers a different question:

> **What is that authenticated identity allowed to do?**

Those concerns must remain separate.

This document is grounded in the canonical `apps/api` architecture and the existing `features/auth` structure established in `docs/architecture/monorepo.md` and `docs/architecture/api.md`.

It defines:

- identity boundaries;
- session boundaries;
- login/authentication flows;
- refresh/revocation behavior;
- external identity-provider integration;
- two-factor authentication boundaries;
- request authentication;
- token/session lifecycle;
- logout semantics;
- security-sensitive storage rules;
- auditability;
- recovery;
- failure handling;
- client responsibilities;
- and the relationship between authentication state and downstream read services.

It does not define the complete role/permission model. That belongs in `docs/architecture/authorization.md`.

---

# Architectural Role

Chronologity authentication is responsible for establishing trusted request identity.

Conceptually:

```text
Unauthenticated client
        ↓
Authentication flow
        ↓
Identity verified
        ↓
Session established
        ↓
Credentials issued
        ↓
Subsequent request
        ↓
Credentials validated
        ↓
Authenticated request context
```

The output of authentication is not "permission."

It is a trusted statement such as:

```text
userId
identityId
sessionId
authentication method
authentication strength
credential issuance metadata
```

Authorization layers then decide whether that identity may perform the requested action.

---

# Canonical Authentication Feature

The canonical API structure includes:

```text
features/authentication/
├── authentication.routes.ts
├── authentication.policy.ts
├── authentication.rate-limits.ts
├── authentication.types.ts
├── identity.service.ts
├── identity.repository.ts
├── session.service.ts
└── session.repository.ts
```

The architecture treats **Identity** and **Session** as separate concepts.

That separation is foundational.

---

# Identity

## Definition

An **Identity** represents the durable authentication identity associated with a Chronologity account.

Identity may include or reference:

- primary email;
- linked external identity providers;
- verification state;
- passwordless or magic-link capability;
- two-factor configuration;
- authentication recovery state;
- account-level security metadata.

Identity is not the same thing as a User profile.

Conceptually:

```text
Identity
    ↓
establishes who may authenticate

User
    ↓
represents the Chronologity account/profile
```

The final relationship between `Identity` and `User` should remain one-to-one unless a future product decision explicitly introduces another model.

---

# Session

## Definition

A **Session** represents a bounded authenticated login context.

A Session should have stable identity independent of the access token currently used to represent it.

Conceptually:

```text
Identity
   ↓
creates
   ↓
Session
   ↓
represented by
   ↓
access + refresh credentials
```

The Session is the authoritative revocation boundary.

This allows Chronologity to distinguish:

- one device/session from another;
- one refresh chain from another;
- current versus revoked access;
- global account revocation versus single-session revocation.

---

# Identity Versus User

The canonical monorepo currently contains both:

```text
features/auth/
features/users/
```

The architecture must preserve a clean boundary.

## Authentication Identity

Owns:

- login credentials;
- verified authentication channels;
- external identity-provider bindings;
- two-factor configuration;
- session creation;
- session revocation;
- authentication recovery.

## User Account

Owns:

- profile information;
- username/display identity;
- account-facing product state;
- product preferences where appropriate;
- activation/deactivation where product-owned rather than purely security-owned.

If both features currently contain email-related operations, those operations must be semantically reconciled before implementation.

The default architectural direction should be:

```text
authentication email ownership
        → Identity

public/profile contact presentation
        → User only if product semantics require it
```

Do not duplicate canonical email ownership across both features.

---

# Authentication Methods

Chronologity may support one or more authentication mechanisms.

The canonical auth structure indicates possible support for:

- email-based authentication;
- magic links;
- OAuth identity providers;
- two-factor authentication;
- session refresh;
- session revocation.

The exact launch subset should be finalized before implementation.

The architecture must support adding or removing providers without changing core Session semantics.

---

# Email Authentication

If email is used as an authentication identifier, Chronologity should require verified control of the address before treating it as a trusted authentication factor.

Potential flows may include:

```text
email
  ↓
verification / magic link / credential challenge
  ↓
verified identity
  ↓
session creation
```

Email address normalization must be deliberate.

Chronologity should not invent aggressive normalization rules that could collapse distinct real addresses incorrectly.

---

# Magic Links

If magic-link authentication ships, magic links must be:

- single-use;
- time-limited;
- cryptographically unguessable;
- bound to the intended authentication flow;
- invalidated after use;
- protected against replay;
- safe against URL leakage where practical.

A magic link should not itself become a long-lived Session credential.

Conceptually:

```text
single-use login artifact
        ↓
verified
        ↓
session created
        ↓
artifact invalidated
```

---

# OAuth / External Identity Providers

External identity providers may be linked to an Identity.

Examples may include Apple, Google, or another explicitly supported provider.

The architecture must distinguish:

```text
provider identity
        ↓
linked to
        ↓
Chronologity Identity
```

Provider identifiers must not replace Chronologity identity IDs.

Chronologity remains authoritative for:

- account linkage state;
- provider-link lifecycle;
- provider unlinking;
- Session creation;
- revocation;
- authorization.

External providers prove control of an external identity.

They do not determine Chronologity permissions.

---

# Provider Linking

Linking a provider to an existing Chronologity Identity must require strong confirmation that the currently authenticated User intends to create that association.

Provider linkage must not be inferred merely because two providers return the same email address.

Email equivalence is not sufficient proof of identity equivalence.

Potential secure flow:

```text
authenticated Chronologity session
        ↓
initiate provider linking
        ↓
provider authorization
        ↓
validated provider identity
        ↓
explicit link command
        ↓
identity event
```

---

# Provider Unlinking

Unlinking must never accidentally leave the User unable to authenticate unless the product explicitly allows a recoverable lockout state.

Before unlinking the last usable authentication method, Chronologity should require:

- another verified method;
- explicit confirmation;
- or a documented recovery path.

---

# Two-Factor Authentication

Two-factor authentication strengthens authentication but does not create a separate identity.

The architecture should model two-factor state as part of the Identity security model.

Potential concepts include:

- enrollment;
- verification;
- recovery codes;
- disablement;
- step-up challenge;
- trusted-session state where explicitly supported.

The exact factor type is not chosen by this document.

---

# Authentication Strength

Chronologity should be able to distinguish the authentication strength of a Session where future actions may require step-up authentication.

For example:

```text
normal authenticated session
        ↓
high-risk action
        ↓
step-up authentication required
```

Potential high-risk actions may include:

- changing primary authentication email;
- disabling two-factor authentication;
- deleting the account;
- changing critical security settings;
- certain administrative actions.

Step-up requirements belong jointly to authentication and authorization policy.

---

# Session Creation

A Session is created only after successful authentication.

Conceptually:

```text
verified identity
      ↓
SessionService.issue
      ↓
sessions row, written with its audit record
      ↓
session ID
      ↓
credentials issued
```

Session creation should record enough authoritative metadata to support:

- revocation;
- security auditing;
- active-session queries;
- refresh-token rotation;
- abnormal-session investigation;
- logout.

Avoid storing excessive device fingerprinting data unless a concrete security purpose justifies it.

---

# Access Credentials

Access credentials should be short-lived.

They establish:

```text
this request
belongs to
this authenticated Session
```

They should include only the minimum claims needed to authenticate requests efficiently.

Do not embed mutable authorization policy directly into long-lived access tokens unless revocation/update semantics are explicitly handled.

Examples of data that may be reasonable:

- subject / User ID;
- identity/session ID;
- issuance time;
- expiration;
- token identifier;
- issuer/audience;
- authentication-strength indicator where needed.

Roles/permissions should not be assumed permanently current merely because they were embedded at token issuance.

---

# Refresh Credentials

Refresh credentials allow a Session to obtain new short-lived access credentials.

They are higher-value secrets than ordinary access tokens.

The architecture should support refresh-token rotation.

Conceptually:

```text
refresh credential N
        ↓
validated
        ↓
new access credential
        +
refresh credential N+1
        ↓
refresh credential N invalidated
```

Reuse of an already-rotated refresh credential should be treated as a potential compromise signal.

The exact response—such as revoking the entire Session—should be defined explicitly.

---

# Session Revocation

The canonical auth structure includes session revocation behavior.

Chronologity should support at least:

```text
revoke one session
revoke all sessions
```

Potential triggers include:

- explicit logout;
- device/session management;
- passwordless/account-security changes where required;
- two-factor security change;
- suspicious refresh-token reuse;
- account deactivation;
- account deletion;
- administrative/security enforcement.

Revocation must be authoritative.

A client deleting its local token is not sufficient logout semantics.

---

# Logout

Logout should revoke the active Session or its refresh capability at the authoritative backend.

Conceptually:

```text
client requests logout
        ↓
RevokeSession
        ↓
authoritative session state updated
        ↓
client deletes local credentials
```

If the network request fails, the client should still clear local credentials for local safety, but the Session may remain valid server-side until expiration/revocation.

That distinction should be handled explicitly in UX and recovery behavior.

---

# Logout Everywhere

A security-sensitive action should allow the User to revoke all active Sessions.

Conceptually:

```text
RevokeAllSessions(identity/user)
```

The current Session may either be included or excluded according to explicit product behavior.

Do not leave the semantics ambiguous.

---

# Session Expiration

Expiration and revocation are different.

```text
expired
    → naturally outside allowed lifetime

revoked
    → explicitly invalidated before natural expiration
```

The system should preserve that distinction for auditing and User-facing session management.

---

# Request Authentication

## Primary API

Every protected request to `apps/api` passes through the authentication plugin.

Conceptually:

```text
request
  ↓
extract credentials
  ↓
validate token/session
  ↓
construct auth context
  ↓
route/handler
```

Request authentication should fail closed.

If credentials cannot be validated reliably, the request must not become authenticated by default.

---

# Feed Aggregator Authentication

`apps/feed-aggregator` needs enough trusted identity context to enforce Timeline read visibility.

It is **not** a second authentication authority.

Two acceptable architectural patterns are possible:

### Pattern A: Shared token verification

The aggregator validates the same access credential format using shared verification configuration/keys.

### Pattern B: Trusted identity propagation

An upstream trusted boundary authenticates the request and forwards signed/internal identity context.

Whichever approach is chosen must preserve:

- independent server-side validation;
- session identity;
- revocation expectations;
- least privilege;
- no reliance on client-supplied identity headers.

The focused authorization architecture must define how read permissions are evaluated once identity is established.

---

# Mobile Credential Storage

The mobile application must treat Session credentials as secrets.

Refresh credentials should use platform-secure storage mechanisms.

Access credentials may be held in memory and/or secure storage depending on final lifecycle requirements.

Do not store long-lived authentication secrets in:

- plain AsyncStorage;
- logs;
- analytics payloads;
- Redux debugging output;
- crash reports;
- URLs;
- ordinary plaintext files.

---

# Web Authentication

The Gatsby public website is not the primary authenticated Chronologity product.

If the web application needs limited authenticated flows, their security model must be deliberate.

Do not assume mobile token-storage mechanisms map safely onto the browser.

A future full web product client would require browser-specific authentication design, likely favoring secure HTTP-only cookie/session patterns or another carefully designed browser flow.

---

# Credential Transmission

Authentication credentials must be transmitted only over TLS.

Sensitive credentials should not be placed in:

- query parameters;
- route paths;
- referrer-visible URLs;
- analytics events.

Authorization headers or secure cookies should be used according to the client architecture.

---

# Token Signing and Verification

If JWTs are used for access credentials, Chronologity should prefer asymmetric signing where operationally appropriate.

This allows:

```text
API / auth issuer
        ↓ private signing key

API / feed aggregator / trusted verifiers
        ↓ public verification key
```

Key rotation must be supported.

The exact key-management service and algorithm belong in security implementation documentation.

---

# Token Revocation Strategy

Short-lived access tokens reduce the need for immediate per-request central revocation checks.

However, some high-risk revocations may require faster enforcement.

Chronologity must explicitly decide whether:

- access tokens remain valid until short expiration;
- session revocation is checked on protected requests;
- a revocation cache/list is used;
- authorization-sensitive operations perform stronger Session validation.

The answer may vary by operation.

Do not assume one universal mechanism is optimal.

---

# Session Read Model

Chronologity should expose a User-facing active-session view.

Useful fields may include:

- session identifier;
- approximate device/client type where available;
- creation time;
- last activity time where deliberately tracked;
- current session indicator;
- expiration;
- revoked/active status.

Avoid exposing highly detailed device fingerprinting unless it materially improves security.

Session read state may be projected from authoritative Session history.

---

# Auditability

Security-sensitive authentication events should be auditable.

Potential events include:

- identity created;
- email verified;
- provider linked;
- provider unlinked;
- two-factor enabled;
- two-factor disabled;
- session created;
- session refreshed;
- session revoked;
- all sessions revoked;
- suspicious refresh reuse detected;
- recovery action completed.

Audit records must avoid storing raw credentials.

---

# Privacy

Authentication data is highly sensitive.

Chronologity must minimize replication of:

- email addresses;
- provider identifiers;
- device information;
- IP addresses;
- refresh credentials;
- authentication metadata.

Do not include raw access or refresh tokens in:

- outbox messages;
- Kafka messages;
- logs;
- traces;
- analytics.

Where an authentication record needs to reference a security artifact, store a hash rather than the artifact. Only the SHA-256 of a refresh credential is kept, so reading the database does not confer the ability to refresh.

---

# Where Authentication State Lives

PostgreSQL, authoritatively, like every other feature (ADR-092).

`sessions` decides whether a Session may authenticate a request (ADR-094). The
earlier design read that from replayed history, on the reasoning that a lagging
projection could otherwise leave a revoked Session working. There is no lagging
projection: revocation is written synchronously in the request that causes it,
so reading the row is fresher than replaying ever was — and it takes an extra
store off the hot path of every authenticated request.

Auditability, which was the strongest argument for an event log, is served by
`auth_audit_events`. It is written in the same transaction as the change it
describes, so it records what happened rather than what was attempted and rolled
back. It is also queryable and erasable, which an append-only log is not.

Refresh-token rotation is the one place where concurrency genuinely matters, and
it is a single conditional update: the presented credential must still be the
current one, the Session unrevoked and unexpired. Zero rows means reuse or a
lost race, and reuse ends the Session rather than merely refusing the request.

---

# Authentication Changes Worth Naming

Potential categories include:

```text
identity-created
identity-email-added
identity-email-verified
identity-email-removed
identity-primary-email-changed
oauth-provider-linked
oauth-provider-unlinked
two-factor-enabled
two-factor-disabled

session-created
session-refreshed
session-revoked
session-expired
all-sessions-revoked
```

Exact event names and payloads must be finalized in `docs/events/`.

Events represent accepted past-tense facts.

They must not contain raw secrets.

---

# Authentication Commands

Potential command categories include:

```text
CreateIdentity
AddIdentityEmail
VerifyIdentityEmail
RemoveIdentityEmail
SetPrimaryIdentityEmail
LinkOAuthProvider
UnlinkOAuthProvider
EnableTwoFactor
DisableTwoFactor

CreateSession
RefreshSession
RevokeSession
ExpireSession
RevokeAllSessions
```

Commands represent intent.

Handlers enforce authentication-specific invariants before producing authoritative state changes.

---

# Verification Artifacts

Email verification tokens, magic-link tokens, OAuth state parameters, two-factor challenges, and similar temporary artifacts are operational secrets.

They must not be modelled as durable records, and must never reach the outbox or Kafka.

Appropriate storage may include:

- short-lived relational records;
- cryptographically verifiable self-contained tokens where safe;
- ephemeral cache/store with explicit TTL;
- another bounded security store.

The architecture must support:

- expiration;
- one-time use;
- invalidation;
- replay protection.

---

# Email Verification

Email verification state should be authoritative.

The verification token is temporary.

The resulting fact is durable.

Conceptually:

```text
verification token
        ↓
validated
        ↓
IdentityEmailVerified
```

The event records the verified state, not the secret token.

---

# Account Recovery

Recovery mechanisms are security-critical and should not be designed as an afterthought.

Any recovery path must avoid becoming weaker than the normal authentication path.

Recovery may require combinations of:

- verified email;
- recovery codes;
- existing trusted Session;
- provider identity;
- support-assisted process under tightly controlled policy.

Exact recovery behavior must be documented before launch.

---

# Brute-Force and Abuse Protection

Authentication endpoints require abuse controls.

Potential mechanisms include:

- rate limiting;
- per-identity throttling;
- per-IP or network heuristics;
- progressive challenge;
- cooldowns;
- provider-specific limits;
- anomaly detection.

Rate limiting must avoid making identity enumeration easier.

Error responses should not unnecessarily reveal whether an email or provider account exists.

---

# Enumeration Resistance

Authentication responses should avoid materially different behavior that reveals account existence when that information is sensitive.

For example, a magic-link request may respond generically:

```text
If an eligible account exists, authentication instructions will be sent.
```

Exact wording belongs in product/API documentation.

Timing behavior should also avoid obvious enumeration leaks where practical.

---

# Two-Factor Recovery

If two-factor authentication ships, recovery must be planned before enrollment is offered.

Potential mechanisms include:

- single-use recovery codes;
- trusted authenticated Session;
- verified recovery process.

Recovery codes must be:

- generated securely;
- stored only in protected/hashed form where possible;
- shown only at appropriate enrollment/recovery moments;
- revocable/regenerable.

---

# Suspicious Session Behavior

Chronologity may detect suspicious behavior such as:

- refresh-token reuse;
- impossible session transitions;
- credential use after revocation;
- provider-link anomalies.

Security actions may include:

- revoking the Session;
- revoking all Sessions;
- requiring reauthentication;
- requiring step-up authentication;
- notifying the User.

Detection systems should not silently modify product authorization beyond their defined security response.

---

# Authentication Notifications

Security-relevant changes may generate mandatory notifications.

Examples may include:

- new Session created;
- email changed;
- OAuth provider linked;
- two-factor enabled/disabled;
- all Sessions revoked.

These notifications are security communications, not social engagement notifications.

Their delivery policy may differ from ordinary notification preferences.

---

# Account Deactivation

Account deactivation should have explicit authentication consequences.

A deactivated account should generally not be able to establish new Sessions.

Existing Session behavior must be defined.

The safer default is:

```text
deactivation
    ↓
revoke active Sessions
    ↓
prevent new authentication
```

unless product semantics require another reversible suspended state.

---

# Account Deletion

Account deletion must coordinate authentication state.

At minimum:

```text
delete account
    ↓
revoke Sessions
    ↓
disable authentication methods
    ↓
apply identity-data deletion/retention policy
```

No storage strategy is an excuse to retain unnecessary authentication personal data forever.

The exact deletion model belongs in privacy/data architecture.

---

# Moderation Suspension

A moderation suspension may affect authorization, authentication, or both.

Two distinct models are possible:

### Authenticated but restricted

The User may log in and see suspension/appeal status but cannot use normal product capabilities.

### Authentication disabled

The User cannot establish an ordinary Session.

Chronologity should prefer the first model where the User needs access to appeal/account-management workflows.

The final behavior belongs jointly to moderation, authentication, and authorization architecture.

---

# Role Changes

Roles and permissions belong to authorization, but authentication must not assume role claims embedded in a token remain current forever.

If roles are encoded in access tokens for performance, they must have:

- short-lived validity;
- revocation/update strategy;
- or authoritative permission re-evaluation on sensitive actions.

Authentication establishes identity.

Authorization establishes current privilege.

---

# Service-to-Service Authentication

Internal backend communication may eventually require service identity.

Examples:

- media callback endpoints;
- projection writers;
- internal worker calls;
- external provider webhooks.

Service authentication must remain distinct from User authentication.

Do not reuse User access tokens as internal service credentials.

Potential mechanisms include:

- mTLS;
- signed service tokens;
- cloud workload identity;
- HMAC-signed callbacks;
- provider-specific webhook verification.

Exact mechanisms belong in security and deployment architecture.

---

# Webhooks and Provider Callbacks

External provider callbacks must be authenticated according to provider capabilities.

Examples:

- OAuth callback state validation;
- transcoder callbacks;
- storage notifications;
- email-provider webhooks;
- push-provider callbacks.

The API must not trust a callback merely because it reaches a private-looking route.

---

# Authentication Error Semantics

Authentication failures should distinguish internally between causes such as:

- missing credentials;
- invalid credentials;
- expired credential;
- revoked Session;
- invalid refresh credential;
- refresh reuse;
- unverified identity;
- two-factor required;
- disabled account.

Client-facing errors should expose only what is useful and safe.

Exact error codes belong in `docs/api/errors.md`.

---

# Clock and Expiration

Authentication depends heavily on time.

Chronologity must use a consistent server-side clock source for:

- access-token expiration;
- refresh-token expiration;
- magic-link expiration;
- verification-token expiration;
- session expiration;
- two-factor challenge expiration.

Clients may display expiration information, but server time remains authoritative.

Small clock-skew allowances may be appropriate for signed tokens.

---

# Key Rotation

Signing and encryption keys must be rotatable without requiring an immediate whole-system redeployment.

If JWT signing is used, token headers should support key identifiers.

Trusted services should be able to verify credentials signed by currently valid and recently rotated keys according to policy.

Compromised-key rotation procedures belong in operations/security documentation.

---

# Secrets

Authentication secrets include:

- signing private keys;
- OAuth client secrets;
- provider credentials;
- encryption keys;
- token pepper/secret material;
- webhook secrets.

Secrets must be supplied through secure runtime secret management.

They must not live in:

- source control;
- mobile bundles;
- Gatsby public bundles;
- shared packages;
- logs.

---

# Authentication and Caching

Authentication results may be cached only with careful revocation semantics.

Caching should never allow:

```text
revoked Session
        ↓
continues indefinitely because cached as valid
```

Short-lived verification caches may be acceptable.

The cache lifetime must be compatible with security requirements.

---

# Authentication and Eventual Consistency

Authentication has stricter consistency requirements than many derived product reads.

A Session revocation must not wait arbitrarily for an eventually consistent Timeline projection before becoming effective at an authentication boundary.

Therefore:

```text
authoritative Session state
        ↓
security-critical request validation
```

must use a mechanism whose staleness is bounded appropriately.

The precise implementation is a focused security decision.

---

# Authentication and the Feed Aggregator

The feed aggregator may use short-lived authenticated identity context for Timeline reads.

It must not independently:

- create Sessions;
- refresh Sessions;
- revoke Sessions;
- link providers;
- perform account recovery;
- change authentication state.

If a request's credentials are invalid or insufficient, the aggregator fails authentication and the client uses the authoritative API authentication flow.

---

# Authentication and Mobile Offline State

A mobile client may retain local UI/session state during transient network failure.

It must not assume that a locally stored credential proves the Session is still valid server-side.

When connectivity returns, protected server operations revalidate authentication normally.

Offline product functionality must not turn stale credentials into offline authorization for sensitive operations.

---

# Session Device Metadata

Chronologity may store limited metadata to help Users identify active Sessions.

Potential fields:

- client platform;
- app version;
- approximate device label;
- creation time;
- last successful authentication time;
- coarse location if explicitly justified.

Precise IP/location tracking should not be introduced casually.

Security value must justify privacy cost.

---

# Data Retention

Authentication data retention must be explicit.

Categories include:

- active Session state;
- revoked Session metadata;
- identity-provider linkage;
- verification state;
- temporary verification artifacts;
- security audit events;
- IP/device metadata;
- authentication logs.

Retention should minimize personal data while preserving necessary security/audit capability.

---

# Testing

Authentication requires strong automated test coverage.

## Policy tests

Unit tests, exhaustive, no infrastructure:

- address normalisation;
- whether a Session is usable, at and either side of its expiry;
- why a refresh was refused, and which refusal ends the Session;
- where a link of each purpose sends someone.

## Identity service tests

Verify:

- Session creation;
- refresh;
- rotation;
- revocation;
- expiration;
- revoke-all behavior;
- invalid post-revocation transitions.

## Token tests

Verify:

- issuance;
- validation;
- expiration;
- issuer/audience validation;
- key rotation;
- invalid signatures;
- revoked-session behavior where applicable.

## Refresh-rotation tests

Verify:

- valid refresh;
- old-token invalidation;
- reuse detection;
- Session revocation policy after reuse.

## Route tests

Verify:

- authentication requirements;
- validation;
- generic enumeration-safe responses;
- two-factor challenge responses;
- error mapping.

## Integration tests

Verify real behavior for:

- two simultaneous refreshes, where exactly one must win;
- revocation racing a refresh;
- PostgreSQL temporary-token storage;
- OAuth callback validation;
- signing-key configuration;
- Session revocation propagation.

## Security tests

Include:

- replay attempts;
- token tampering;
- expired tokens;
- stolen refresh-token reuse;
- provider-link attacks;
- identity enumeration;
- session fixation;
- open redirect protection in OAuth/magic-link flows.

---

# Day-One Requirements

Before launch, Chronologity must explicitly support and document:

- canonical Identity/User relationship;
- canonical Session model;
- launch authentication methods;
- email-verification behavior;
- Session creation;
- short-lived access credentials;
- refresh credentials;
- refresh rotation;
- Session revocation;
- logout;
- logout-all-sessions;
- account deactivation authentication behavior;
- account deletion authentication behavior;
- moderation-suspension authentication behavior;
- request authentication in the API;
- request authentication in the feed aggregator;
- mobile secure credential storage;
- enumeration resistance;
- rate limiting;
- credential expiration;
- key rotation;
- secrets management;
- security audit events;
- authentication-related notifications;
- recovery behavior;
- integration tests and security tests.

If two-factor authentication is offered at launch, launch also requires:

- enrollment;
- verification;
- recovery codes or equivalent recovery;
- disablement;
- step-up semantics where used;
- recovery testing.

If OAuth is offered at launch, launch also requires:

- provider registration;
- state/nonce validation;
- linking;
- unlinking;
- account-collision handling;
- provider-token security;
- callback testing.

---

# Open Architectural Questions

The following questions require explicit resolution before implementation hardens authentication behavior.

## Launch Methods

- Does day one use email + magic link?
- Does day one support password authentication?
- Which OAuth providers ship?
- Does two-factor authentication ship on day one?
- Are passkeys/WebAuthn in scope initially or later?

## Identity Model

- Is there exactly one Identity per User?
- Can multiple verified emails belong to one Identity?
- Can one email belong to more than one Identity?
- Which feature definitively owns email?
- What remains in `features/users` regarding email after reconciliation?

## Session Model

- What is the maximum Session lifetime?
- What is the access-token lifetime?
- What is the refresh-token lifetime?
- Does refresh activity extend Session lifetime?
- Are Sessions absolute-lifetime bounded?
- How many concurrent Sessions may a User maintain?

## Credentials

- Are access tokens JWTs?
- If so, which signing algorithm is used?
- Are refresh tokens opaque random secrets?
- How are refresh tokens stored server-side?
- Are they hashed?
- How are refresh-token families represented?
- How is reuse detection implemented?

## Revocation

- Does ordinary access-token validation check Session revocation?
- Or are access tokens trusted until short expiration?
- Which operations require stronger live Session validation?
- How quickly must logout-all become effective across API and feed aggregator?
- Is there a distributed revocation cache?

## Mobile

- Which Expo/native secure storage mechanism is used?
- Are refresh credentials stored only in secure storage?
- Are access credentials memory-only?
- How does app restart restore Session state?
- How is biometric device unlock related to Chronologity authentication, if at all?
- Does biometric unlock merely protect local credential access?

## OAuth

- Which provider identifier is considered canonical?
- How are provider email changes handled?
- What happens when two provider identities claim the same verified email?
- Is account linking always explicit?
- What happens when the last provider is unlinked?
- Are provider access/refresh tokens ever retained after login? Prefer not unless required by product functionality.

## Magic Links

- What is token lifetime?
- Are links single-use?
- How is replay prevented?
- Are links bound to a device/session attempt?
- What redirect destinations are permitted?
- How are universal/app links implemented safely?

## Two-Factor

- Which factor type is used?
- TOTP?
- WebAuthn/passkeys?
- Another method?
- How many recovery codes?
- How are recovery codes stored?
- Which actions require step-up?
- Are Sessions marked with authentication strength?

## Recovery

- What is the account-recovery path if the User loses every factor?
- Is support-assisted recovery allowed?
- What evidence is sufficient?
- How do we prevent social-engineering recovery attacks?

## Security Notifications

- Which authentication events trigger mandatory notifications?
- Can Users disable them? The recommended default is no for security-critical notices.
- Which channel is used if push is disabled?
- Is email mandatory for critical identity changes?

## Deactivation and Suspension

- Does deactivation revoke all Sessions immediately?
- Can deactivated Users authenticate to reactivate?
- Can suspended Users authenticate solely to view appeal/account status?
- Does permanent ban disable authentication entirely?

## Feed Aggregator

- Does the aggregator validate JWTs directly?
- Does it need a Session-revocation lookup?
- How are key rotations propagated?
- How does it behave when the auth subsystem is temporarily unavailable?

## Audit

- Which authentication events are retained?
- For how long?
- Is IP address retained?
- Is User-agent/device metadata retained?
- How do Users view their own login history?
- How are suspicious-login events represented?

## Privacy

- How is identity deletion and erasure implemented?
- How are old provider identifiers handled after unlinking/deletion?
- What authentication audit data may legally/security-wise be retained?

These decisions should be finalized in this architecture layer or corresponding ADRs before authentication code is treated as production-ready.

---

# Architectural Invariants

1. Authentication establishes identity; authorization establishes permission.
2. Identity and User are distinct architectural concepts.
3. Session is the authoritative login/revocation boundary.
4. Access credentials are short-lived.
5. Refresh credentials are treated as high-value secrets.
6. Refresh rotation should be supported.
7. Credential reuse/replay must be detectable where practical.
8. Logout must revoke authoritative Session state, not merely clear client storage.
9. Logout-all must be supported.
10. The API is the authoritative authentication service.
11. The feed aggregator may validate identity context but does not manage Sessions.
12. The mobile client is not an authentication authority.
13. Authentication secrets are never stored in ordinary client storage.
14. Raw tokens never appear in the outbox or in Kafka.
15. Raw tokens never appear in logs, traces, analytics, or Kafka.
16. External provider identity does not replace Chronologity Identity.
17. Provider linking requires explicit secure confirmation.
18. Matching provider email addresses do not automatically prove identity equivalence.
19. Unlinking must not accidentally create unrecoverable account lockout.
20. Two-factor state belongs to authentication security, not authorization roles.
21. Step-up authentication may be required for high-risk actions.
22. Server time is authoritative for credential expiration.
23. Authentication endpoints require abuse/rate-limit protections.
24. Authentication responses should resist account enumeration.
25. Temporary verification artifacts are short-lived and replay-resistant.
26. Verification tokens are not durable historical domain facts.
27. Security-sensitive authentication changes are auditable.
28. Authentication data replication is minimized.
29. Authentication publishes no Integration Events; its accountability requirement is met by a relational audit trail that erasure can reach.
30. Account deactivation/deletion must define Session consequences explicitly.
31. Moderation suspension must define authentication behavior explicitly.
32. Roles/permissions are not assumed permanently current solely because they appear in an access token.
33. Service-to-service credentials are distinct from User credentials.
34. Provider callbacks/webhooks require independent verification.
35. Revocation consistency requirements are stricter than ordinary derived-read eventual consistency.
36. Authentication caches must have revocation-compatible lifetimes.
37. Key rotation must be supported.
38. Secrets are supplied through secure runtime secret management.
39. Authentication flows must be accessible and usable with assistive technologies.
40. Authentication implementation must be covered by domain, integration, and security-focused tests.

---

# Guiding Principle

When designing authentication, ask:

> **What is the minimum trusted evidence Chronologity needs to establish who this requester is, create a revocable Session, and preserve that trust without turning credentials, providers, or client state into permanent sources of authority?**

Authentication should establish identity cleanly.

Authorization should decide what that identity may do.
