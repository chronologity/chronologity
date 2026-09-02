# Chronologity Authorization Architecture

## Purpose

This document defines the authorization architecture for Chronologity.

Authentication establishes who is making a request.

Authorization determines:

> **What is this authenticated identity allowed to do or access in this context?**

Authorization applies across authoritative commands, operational queries, Timeline reads, media delivery, moderation actions, administrative capabilities, Search, Discovery, notifications, and derived read models.

Chronologity deliberately does not have a separate administrative application. Administrative authority is enforced by backend role- and permission-based authorization, even when the privileged interface is presented inside the ordinary consumer mobile application.

This document is grounded in:

- `docs/architecture/api.md`;
- `docs/architecture/authentication.md`;
- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- the canonical monorepo structure.

It defines authorization concepts, role and permission boundaries, resource ownership, relationship-based authorization, administrative authority, moderation authorization, read authorization, command authorization, Timeline/aggregator enforcement, privacy integration, blocking, permission propagation, caching, auditing, testing, and open decisions that must be finalized before implementation.

## Architectural Role

Authorization is a trusted backend decision.

```text
Authenticated identity
        ↓
Trusted request context
        ↓
Authorization policy
        ↓
resource + action + context
        ↓
allow / deny
```

The client may hide controls according to expected permissions. That improves usability, but it does not provide security.

Every protected operation must be authorized at a trusted server boundary.

## Authorization Inputs

An authorization decision may depend on:

- authenticated User ID;
- Identity ID;
- Session ID;
- role;
- explicit permission;
- resource ownership;
- resource visibility;
- social relationship;
- blocking relationship;
- moderation state;
- account state;
- Timeline scope;
- Location sensitivity;
- Event membership;
- administrative assignment;
- authentication strength;
- product-specific resource policy;
- other trusted contextual facts.

Authorization must not rely on mutable or client-supplied facts unless they are independently validated.

## Authorization Output

At its simplest:

```text
allow
deny
```

Some decisions may also return structured context, such as:

- reason code;
- required step-up authentication;
- required ownership;
- allowed visibility scope;
- redaction or precision level;
- permitted administrative actions.

Do not overload authorization with unrelated product ranking or presentation decisions.

## Authentication Versus Authorization

The distinction is strict.

```text
Authentication:
Who are you?

Authorization:
What may you do?
```

A valid Session does not imply permission to edit another User's profile, moderate content, view private Moments, access exact Location data, suspend Users, view sensitive moderation cases, use administrative tools, bypass blocking, or bypass Search/Discovery eligibility.

Likewise, an unauthenticated Viewer may still be authorized to access explicitly public content.

## Core Authorization Model

Chronologity should use a hybrid authorization model combining:

```text
Role-Based Access Control (RBAC)
        +
Resource / relationship policies
```

RBAC is appropriate for broad capabilities such as normal User, moderator, administrator, and future support/security roles if introduced.

Resource and relationship policies are required for resource ownership, Moment visibility, Timeline access, blocking, social relationships, moderation state, and exact versus coarse Location precision.

Pure RBAC is insufficient for Chronologity.

## Roles

A role groups broad platform capabilities.

Potential roles may include:

```text
user
moderator
administrator
```

Additional internal roles should be introduced only when a concrete responsibility requires them.

Avoid role proliferation.

## Permissions

Permissions represent specific capabilities.

Potential examples:

```text
moment:create
moment:edit-own
moment:delete-own

moderation:report-review
moderation:restrict-content
moderation:restore-content
moderation:suspend-user

admin:user-role-manage
admin:system-config-manage
```

Exact permission names are not finalized by this document.

The architectural rule is:

```text
roles
    ↓
grant
    ↓
permissions
```

Authorization checks should preferably depend on permissions rather than hard-coded role-name branches.

## Role Hierarchy

Chronologity should not assume a rigid inheritance chain such as:

```text
administrator > moderator > user
```

unless the permission model explicitly defines it.

Explicit permission sets are safer than implicit assumptions.

## Default User Role

Every ordinary Chronologity account should have a baseline User role/capability set.

Administrative privileges are additive and must not weaken normal privacy rules accidentally.

For example, a moderator may be able to review reported content under a moderation workflow but should not automatically receive unrestricted access to every private Moment outside that workflow.

## Administrative Authorization

Chronologity has no separate admin application.

The mobile app may expose administrative interfaces when the authenticated User has the necessary permissions.

```text
mobile UI
   ↓
client displays admin capability
   ↓
REST command
   ↓
API authentication
   ↓
backend authorization
   ↓
authoritative admin/moderation action
```

A missing client-side guard must never create a privilege escalation.

## Least Privilege

Administrative and moderation permissions must follow least privilege.

Examples:

- a moderation reviewer may inspect reported content but not manage User roles;
- a support role may view account-status metadata but not alter historical content;
- a security role may revoke Sessions without gaining arbitrary access to private media;
- a system administrator may manage infrastructure without needing product-level moderation authority.

The exact role matrix must be finalized before privileged tooling ships.

## Resource Authorization

Authorization should be expressed in terms of:

```text
subject
action
resource
context
```

For example:

```text
subject:
  User A

action:
  view

resource:
  Moment M

context:
  ownership
  visibility
  block state
  moderation state
  Timeline scope
```

This structure is more durable than scattered ad hoc conditionals.

## Resource Ownership

Ownership is one authorization input, not the whole model.

The creator/owner of a resource may have permissions such as edit, change visibility, remove, manage Comments, or manage media associations.

Ownership does not automatically grant moderation exemption, legal override, or administrative capability.

## Moment Authorization

Moment access may depend on creator ownership, visibility/audience, relationship to creator, blocking, moderation state, Event/Timeline scope, resource deletion state, and viewer role under a legitimate moderation workflow.

Moment authorization should be centralized enough to avoid each route or projection inventing slightly different rules.

## Timeline Authorization

Timeline authorization is not identical to Moment authorization.

A Timeline query may be allowed while individual Moments within the Timeline require filtering.

```text
Viewer may access Timeline scope
        ↓
retrieve candidate read rows
        ↓
apply eligibility rules
        ↓
return only authorized Moments/context
```

Timeline access must not leak unauthorized content through counts, representative thumbnails, temporal clusters, historical-significance anchors, horizontal adjacency, Event labels, Location precision, or historical jumps.

## Feed Aggregator Authorization

`apps/feed-aggregator` is a trusted read service.

It must authenticate request identity and enforce read authorization independently.

It must never trust client-supplied User IDs, role headers, visibility claims, or block state.

Request identity must come from verified authentication context.

Authorization-relevant read facts must come from trusted derived/read state or trusted backend sources.

## Authorization at Projection Time Versus Query Time

Chronologity may enforce some rules at projection time and others at query time.

Projection-time filtering can speed reads but risks staleness after privacy, role, or block changes.

Query-time filtering gives fresher policy evaluation but may be more expensive.

The architecture may combine both.

The key rule is:

> **Projection-time filtering must never be treated as permanently sufficient when authorization can change afterward.**

## Revocation

Authorization revocation is a first-class concern.

Examples include a Moment becoming private, blocking, moderation restriction, role removal, admin permission revocation, account suspension, reduced Location precision, or Timeline access withdrawal.

Revocation must propagate to all relevant derived surfaces.

## Privacy Authorization

Privacy rules are authorization rules.

Visibility is resource state; authorization is the decision.

For example:

```text
Moment visibility = followers
```

must still be evaluated with relationship state, block state, moderation state, and Viewer identity.

## Blocking

Blocking changes authorization and eligibility.

A block may affect direct profile/Moment visibility, social interaction, Search, Discovery, Timeline composition, notifications, Comments/Reactions, historical jumps, and contextual adjacency where identity/content would otherwise leak.

Blocking is distinct from moderation.

## Moderation Authorization

Moderation has two authorization dimensions:

1. who may perform moderation actions;
2. which content a moderator may inspect under a legitimate moderation workflow.

Moderator role must not imply unrestricted browsing access to private User content outside the moderation purpose.

Moderation review should be purpose-bound and auditable.

## Administrative Action Authorization

Administrative actions should require:

- authenticated Session;
- required permission;
- valid resource/context;
- potentially step-up authentication for high-risk actions;
- audit record;
- reason/context where appropriate.

## Step-Up Authentication

Authorization may require stronger authentication for high-risk actions.

```text
permission check passes
        +
authentication strength insufficient
        ↓
step-up required
```

## Role Assignment

Role assignment is itself privileged.

Only identities with explicit role-management permission may alter roles.

Role changes should be authoritative, auditable, attributable, and rapidly effective according to security consequence.

A User must not be able to grant themselves privileges.

## Direct Permission Assignment

Direct per-User permission assignment should be avoided unless a concrete use case requires it.

Role-based permission bundles are easier to reason about and audit.

## Deny Semantics

Default policy for protected actions should generally be:

```text
not explicitly allowed
        ↓
deny
```

## Policy Evaluation

Authorization policies should be deterministic for the same trusted inputs.

A policy engine may be feature-owned TypeScript policy functions, a shared authorization module, a declarative system, or another explicit mechanism.

Chronologity should avoid a heavyweight external policy engine unless complexity justifies it.

## Feature-Owned Policies

Resource-specific authorization logic should remain close to the owning feature.

A central authorization module may coordinate roles and permissions, but it should not become the only place where every domain rule lives.

## Central Permission Registry

Chronologity should maintain one canonical registry of platform permissions to avoid spelling drift and duplicate meanings.

Potential home:

```text
packages/contracts
```

if permission identifiers cross runtime boundaries.

Internal role-mapping logic may remain server-side.

## Client Permission Awareness

The mobile client may receive a safe representation of effective capabilities needed for UI rendering.

The client uses this only for presentation.

Server authorization remains authoritative.

## Role Claims in Tokens

Roles or permissions may be included in short-lived access tokens for efficiency.

If so:

- claims must expire quickly;
- sensitive actions may re-evaluate current permissions;
- role changes require bounded propagation;
- the feed aggregator must not trust stale privilege indefinitely.

A token claim is a cache of authorization state, not the source of truth.

## Authorization Read Store

Chronologity may need a fast server-side representation of current roles, permissions, account status, relationship state, and block state.

Whatever store is used must have a clear authoritative source and revocation path.

## Account State

Account state affects authorization.

Potential states include active, deactivated, suspended, deleted, or restricted.

An authenticated Session does not automatically override account-state restrictions.

## Public/Anonymous Access

Chronologity does not expose content without authentication (ADR-139).
`docs/product/moments.md:589` settles it: "every read requires a Viewer, public
Moments included", because a Block is between two accounts and a signed-out
reader would not be subject to one.

Authorization still models an explicit anonymous Viewer context rather than the
absence of one, because a request that offers no credential has to be answered
with something. What that context is entitled to is nothing.

## Search Authorization

Search must only return resources the Viewer is eligible to retrieve through that Search surface.

Search indexes must not become a privacy bypass.

## Discovery Authorization

Discovery is an amplification surface.

Eligibility may be stricter than ordinary direct access.

```text
may view directly
        ≠
may be recommended
```

## Notification Authorization

A notification may only be created or delivered if the recipient is authorized to know about the underlying activity.

At open time, the destination is reauthorized.

## Media Authorization

Media access must be bound to resource authorization.

Object-storage or CDN delivery mechanisms must not create permanent public access accidentally.

Viewing a Moment does not automatically imply permission to download the original upload.

## Location Authorization

Location information may have precision-specific authorization.

For example:

```text
public Viewer
    → city-level only

authorized owner
    → exact coordinates
```

Authorization should support permitted precision level, not just allow/deny.

## Historical Jump Authorization

Historical jumps must reauthorize the destination.

A relationship may exist internally while the destination remains unavailable to the Viewer.

## Causality Authorization

Causal relationships may be visible only when both the relationship and relevant entities are authorized.

Chronologity must avoid exposing a private or moderated Moment indirectly through a causal edge.

## Historical Significance Authorization

Historical significance must not override resource authorization.

Broad temporal zoom must exclude unauthorized anchors.

## Authorization and Caching

Authorization-sensitive caching is dangerous.

Caches must never allow one User's authorized result to leak to another.

Where viewer-sensitive cache fragmentation would be excessive, prefer caching authorization-neutral data and filtering afterward.

## Request-Scoped DataLoader Caching

In the feed aggregator, DataLoader/request caches must be request scoped unless the data is explicitly authorization-neutral.

Never reuse one Viewer’s authorization result for another Viewer.

## Authorization Consistency

Different authorization data has different consistency needs.

Security-sensitive revocation such as role removal, suspension, blocking, privacy changes, or admin-permission removal requires faster propagation than ordinary UI hints.

Consistency should be consequence-driven.

## Authorization Auditing

Privileged authorization decisions should be auditable.

Administrative/moderation actions should capture acting User, Session, permission used, target resource, action, result, timestamp, reason/context where required, and trace/correlation ID.

## Authorization Errors

Client-facing errors should distinguish unauthenticated, forbidden, not found/unavailable, and step-up required.

Privacy-sensitive resources may intentionally map forbidden access to not-found behavior to avoid existence leakage.

## Existence Hiding

For sensitive resources, Chronologity may deliberately avoid revealing whether the resource exists.

This is especially relevant for private resources, moderation cases, exact Location data, and administrative data.

## Authorization Policy Composition

Policies may compose.

For example, Moment viewing may require:

```text
resource exists
AND not deleted
AND moderation allows viewer
AND visibility allows viewer
AND not blocked
AND age/safety rules permit
```

Avoid giant global condition trees. Compose feature-specific policies.

## Policy Precedence

When multiple policies apply, deny should generally win.

Precedence rules should be explicit where policy dimensions can conflict.

## Authorization for Writes

Write authorization should occur before domain mutation.

Authorization does not replace domain invariants.

## Authorization for Reads

Read authorization may occur before querying, during query construction, after candidate retrieval, through visibility-aware projections, or through a combination.

The final result must contain only authorized information.

## Bulk Authorization

High-volume Timeline queries cannot perform one network call per Moment.

Chronologity therefore needs bulk-friendly authorization representations such as denormalized visibility metadata, relationship sets, block lists, permission scopes, audience classes, or query-time joins against read-side eligibility state.

## Authorization on Both Sides

Authorization applies to writes and to reads.

The API decides whether a mutation is permitted.

The feed aggregator decides whether derived state may be returned to this Viewer.

The semantics must remain consistent, which is why the policy lives in one place and both sides consult it.

## Reading Roles

Roles are read from authoritative state on each privileged request rather than taken from a token claim. A token claim is a cache of authorization state, and the simplest way to honour that is not to cache it: removing a role stops the next request rather than the next token refresh.

The cost is one indexed lookup on a request that already makes several.

## Authorization Events

Potential events may include:

```text
user-role-assigned
user-role-removed
permission-granted
permission-revoked
```

Direct permission events should exist only if direct grants are part of the final model.

## Role Management Ownership

Role management needs a clear authoritative owner.

Role management is owned by the dedicated `features/authorization/` boundary rather than authentication.

Authentication should not become responsible for platform permissions merely because access tokens contain role claims.

## Authorization Module Structure

The canonical API tree includes a dedicated:

```text
features/authorization/
```

module.

This feature owns authoritative role assignment, permission policy, current authorization read state, privileged role-management operations, the audit trail of every role change, and reusable platform authorization policies.

The initial canonical structure deliberately excludes arbitrary direct per-User permission grants. Roles grant permissions. Direct grants require a future explicit architecture decision.

Resource-specific policies remain close to their owning features. The authorization feature owns the platform-wide role/permission foundation rather than absorbing every domain-specific access rule.

## Role/Permission Source of Truth

The authoritative source of role assignments and permissions must be explicit.

Potentially:

```text
authoritative role tables
        ↓
authorization read model
        ↓
API + feed aggregator checks
```

The feed aggregator should not independently invent role state.

## Permission Propagation

Role and permission changes must propagate rapidly enough that revoked privilege stops working within the defined security window.

High-risk actions should re-evaluate current permission state where needed.

## Authorization and Mobile Navigation

The mobile app may conditionally expose screens/routes according to safe capability hints.

This remains presentation only.

Deep links and handcrafted API calls still hit backend authorization.

## Authorization and GraphQL Schema

GraphQL authorization logic should not be duplicated ad hoc in resolvers.

Prefer policy-aware query/composition layers and field-level authorization where one object contains mixed-sensitivity fields.

## Field-Level Authorization

Some resources may be partially visible.

Examples include a visible User profile with hidden email, city-level Location without exact coordinates, or moderation summary without evidence.

Authorization must support redaction/precision policies where product semantics require them.

## Media Derivative Authorization

Different media representations may have different permissions.

Viewing, sharing, and downloading should remain distinct where the product supports them.

## Administrative Search/Discovery

Moderators and administrators should not automatically use ordinary Search or Discovery as a backdoor to private content.

Privileged review should use explicit purpose-built moderation/admin query paths with permissions and auditing.

## Support Access

If a support role is introduced, support access must be purpose-specific and distinct from moderation/admin authority.

## Security Operations

Security-specific capabilities such as revoking Sessions or locking accounts should use distinct permissions from moderation actions.

Security authority does not automatically imply content moderation authority.

## Break-Glass Access

If emergency break-glass access is ever introduced, it must be exceptional, strongly authenticated, narrowly scoped, time-limited, heavily audited, and reviewed afterward.

## Authorization Policy Versioning

Authorization policies may evolve.

For privileged actions, it may be useful to identify which policy version governed the decision.

## Authorization Testing

Authorization requires direct, systematic testing.

Tests must cover policy behavior, command denial/allow, read filtering, Timeline authorization, DataLoader isolation, admin privileges, cache safety, blocking, moderation, Location precision, role changes, and revocation.

## Day-One Requirements

Before launch, Chronologity must define and implement:

- canonical role set;
- canonical permission registry;
- role-to-permission mapping;
- authoritative role assignment and removal;
- User baseline capabilities;
- moderator capabilities;
- administrator capabilities;
- backend authorization middleware/policy infrastructure;
- feature-owned resource policies;
- Moment visibility authorization;
- blocking authorization;
- Timeline authorization;
- feed-aggregator authorization;
- Search authorization;
- Discovery eligibility authorization;
- notification authorization;
- media authorization;
- Location precision authorization;
- moderation review authorization;
- administrative command authorization;
- privileged-action auditing;
- role/permission propagation;
- suspended/deactivated account policy;
- anonymous Viewer policy: reading history requires an account (ADR-139);
- client capability hints;
- secure denial/error semantics;
- authorization tests across API and aggregator.

## Open Architectural Questions

The following questions require explicit resolution before privileged functionality or high-volume read authorization is production-ready:

- Which roles exist at launch?
- Are `user`, `moderator`, and `administrator` sufficient?
- Is there a support role?
- Is there a security-operations role?
- What are the canonical permission identifiers?
- Which service owns role assignment?
- Where are role events stored?
- Can moderators view private reported content, and only within active moderation cases?
- Do administrators automatically have moderator permissions? Recommended default: only if explicitly assigned.
- Are direct User permission grants allowed? Recommended default: no unless a concrete need emerges.
- ~~Does launch expose public Timelines without login?~~ Answered by ADR-139: no. Reading history requires an account.
- How are blocks represented in ClickHouse/read models?
- What visibility metadata is denormalized into ClickHouse?
- What must be revalidated at query time?
- How quickly do privacy/block changes propagate to Search indexes?
- Does authorized Moment view imply original download? Recommended default: no.
- Which Location precision levels exist?
- Which actions remain available to suspended Users?
- Are roles or permissions embedded in access tokens?
- Which operations must query current role state?
- What is the acceptable propagation SLA for role/privacy/block changes?
- Which privileged actions are audited?
- Do we use TypeScript policy functions, an internal policy module, a declarative library, or an external policy engine? Recommended default: TypeScript/internal policies until complexity proves otherwise.

## Architectural Invariants

1. Authentication and authorization remain separate concerns.
2. Authorization is enforced server-side.
3. Client-side permission checks are presentation only.
4. Chronologity uses RBAC plus resource/relationship policies.
5. Pure RBAC is insufficient for private historical content.
6. Roles grant permissions; code should prefer permission checks over hard-coded role-name checks.
7. Administrative authority does not require a separate admin application.
8. Moderator/admin roles do not automatically bypass all privacy rules.
9. Least privilege applies to all privileged roles.
10. Resource ownership is one authorization input, not a universal override.
11. Moment authorization includes visibility, blocking, moderation, and context.
12. Timeline authorization must not leak hidden information through derived metadata.
13. Feed Aggregator authorization is independently enforced at a trusted boundary.
14. Client-supplied identity/role headers are never trusted.
15. Projection-time filtering alone is insufficient when authorization can later change.
16. Revocation is a first-class authorization requirement.
17. Privacy rules are authorization rules.
18. Blocking affects authorization/eligibility but is distinct from moderation.
19. Moderation review access must be purpose-bound and auditable.
20. High-risk administrative actions may require step-up authentication.
21. Role assignment is itself privileged.
22. Users cannot grant themselves elevated roles.
23. Default policy for protected actions is deny unless allowed.
24. Feature-specific resource policies remain close to owning features.
25. Canonical permission identifiers must not drift across applications.
26. Roles/permissions embedded in tokens are cached claims, not permanent truth.
27. Account state affects effective authorization.
28. Anonymous access, if supported, uses an explicit anonymous Viewer context.
29. Search authorization must not be bypassed by indexes or autocomplete.
30. Discovery eligibility may be stricter than direct access.
31. Notifications require recipient authorization.
32. Media access must remain revocable.
33. Location authorization may return permitted precision rather than only allow/deny.
34. Historical jumps reauthorize destinations.
35. Causal/significance metadata cannot expose unauthorized resources.
36. Authorization-sensitive caches must be Viewer-safe.
37. Request-scoped DataLoaders must not leak between Users.
38. Security-sensitive revocation has stricter consistency requirements than ordinary derived reads.
39. Privileged actions are auditable.
40. Sensitive resources may hide existence from unauthorized Viewers.
41. Authorization and domain invariants are both required for writes.
42. High-volume reads require bulk-friendly authorization representations.
43. Read and write authorization semantics must remain consistent.
44. Authorization checks read current authoritative state; they never replay history.
45. Role-management ownership must be explicit before implementation.
46. The dedicated `features/authorization/` module is the canonical owner of platform role assignment and permission policy.
47. Mobile navigation permissions never substitute for backend checks.
48. GraphQL authorization logic should not be duplicated ad hoc in resolvers.
49. Field-level authorization is supported where resource fields have different sensitivity.
50. View, share, and download permissions may differ.
51. Admin/Moderator Search must not become an unlogged private-data backdoor.
52. Support access, if introduced, is distinct from moderation/admin authority.
53. Break-glass access, if ever introduced, must be exceptional and heavily audited.
54. Authorization policies must be directly tested.
55. Architecture documentation must change when permission boundaries intentionally change.

## Guiding Principle

When making an authorization decision, ask:

> **Given this authenticated or anonymous Viewer, this requested action, this resource, and the current privacy, relationship, moderation, account, and role context, what is the minimum access Chronologity should permit?**

Authorization should grant only what the request requires.

Privilege should never emerge accidentally from client state, stale projections, broad role assumptions, or convenient data access.
