# Project: Chronologity

Timeline-first platform for preserving and navigating personal and shared history as chronological Moments, with historical context, deterministic navigation rather than algorithmic feed ranking, and privacy as a foundational property.

A Moment is an experience, not a media file, and not every Moment is public. Chronologity is not primarily a photo-storage application or a short-form video platform (`docs/product/vision.md`).

## Sources of Truth

- Current user instructions take precedence
- Canonical product specifications: `docs/product/`
- Canonical architecture: `docs/architecture/`
- Canonical terminology: `docs/glossary.md`
- Canonical repository structure: `docs/architecture/monorepo.md`
- Use this file for implementation preferences and high-level guardrails, not as a replacement for canonical docs
- If code conflicts with canonical docs, follow the docs unless the user explicitly changes the decision
- If canonical docs conflict materially, surface the conflict before making an architectural assumption

## Monorepo

- Package manager: pnpm
- Build orchestration: Turborepo
- Language: TypeScript
- Applications:
  - `apps/api`: Fastify REST API and backend workers
  - `apps/feed-aggregator`: read-only GraphQL Timeline composition
  - `apps/mobile`: React Native/Expo consumer application
  - `apps/web`: Gatsby public/marketing website
- Shared packages:
  - `packages/api-client`
  - `packages/config`
  - `packages/contracts`
  - `packages/eslint-config`
  - `packages/tsconfig`
- There is NO separate admin application
- Administrative/moderation UI belongs in the consumer app and uses server-enforced role-based authorization
- Do not create files merely to populate the canonical tree; create files when they acquire real responsibility

## Development Order

- Build in application dependency order, not vertical slices across every application
- Sequence:
  1. Root workspace foundation
  2. Shared tooling packages
  3. Local infrastructure
  4. Shared runtime packages
  5. API
  6. Timeline/read projections
  7. Feed aggregator
  8. Client contract stabilization
  9. Mobile application
  10. Gatsby web application
  11. Full-system hardening
  12. Production infrastructure and release
- API-first does not mean API-immutable
- Refine API/feed contracts when mobile implementation exposes deficiencies
- Do not prematurely bootstrap applications whose development phase has not begun

## Code Style

- TypeScript strict mode
- Avoid `any`; use precise types or `unknown` with validation/narrowing
- Use `kebab-case` for files and directories unless a framework requires otherwise
- Use canonical domain terminology from `docs/glossary.md`
- Do not create barrel files solely for re-exports
- Import from the module that owns the symbol
- Colocate tests with implementation unless canonical docs specify otherwise
- Use dependency injection at meaningful infrastructure/application boundaries
- Domain logic must not instantiate infrastructure clients directly
- Use runtime validation at untrusted boundaries
- Prefer explicit domain concepts over generic abstractions
- Add JSDoc documentation comments to all functions
- Each requires a description, `@param` for every parameter, `@returns`, and `@throws` for every error a caller can encounter
- Do not write types in tags; TypeScript already states them, and a tag that repeats a type can only disagree with it
- Tags should carry what the signature cannot: constraints, units, ownership, which failures throw, and what an ambiguous return value means
- Documentation comments should explain purpose, important inputs/outputs, invariants, side effects, and non-obvious behavior where applicable
- Do not add comments that merely restate the implementation
- Tests are exempt: a test's name is its description
- `eslint-plugin-jsdoc` enforces this, including that `@param` names match the signature

## Testing

- Add unit tests for every function containing a decision: branching, validation, mapping, calculation, or policy
- Those unit tests must exercise every code path in the function
- Include success, failure, boundary, and branching cases as applicable
- Infrastructure boundaries whose behavior belongs to the database, broker, or framework are proven by integration tests instead, since unit-testing them would require mocking away the very behavior under test
- Security and authorization logic requires negative-path tests
- Use integration tests when correctness depends on real infrastructure semantics
- Do not mock away the infrastructure behavior the test is intended to prove
- Use contract tests for REST, GraphQL, Integration Events, and external adapters
- Reserve end-to-end tests for critical cross-system flows
- Never claim a test or check passed unless it was actually run successfully

## Database Migrations

- Prefix every migration filename with a timestamp
- Use a sortable UTC timestamp format, e.g. `20260815025500-create-users-table.sql`
- Separate the timestamp and the name with a hyphen, and use kebab-case for the name
- Never create untimestamped migration files
- Migrations must be deterministic and safe for the deployment strategy defined by the architecture
- Do not rewrite already-deployed migrations; create a new migration instead

## Product Invariants

- The Timeline is chronological, not algorithmically ranked
- Vertical navigation represents chronology
- Horizontal navigation represents contextual perspective/grouping
- Depth navigation enters a Moment and its media/details
- A Moment may contain an unlimited number of images and videos at the product level
- Keep technical operations bounded through pagination, batching, and bounded requests
- Videos are limited to 90 seconds
- Enforce video duration authoritatively server-side
- Video autoplay is on by default with sound; users can disable autoplay in settings
- Moment chronology uses occurrence time, not upload/insertion time
- Historical Moments may be backfilled into their correct chronological positions
- Respect the product's immutable-history semantics and dedicated correction/privacy/deletion rules

## Required Day-One Features

- Temporal zoom is a day-one Timeline feature
- Historical jumps are a day-one Timeline feature
- Do not classify either as post-MVP or future work
- Implement server/read-model support rather than recreating historical aggregation in mobile
- Historical destinations must always be reauthorized for the current Viewer

## Removed / Rejected Concepts

- NEVER introduce a separate admin application
- NEVER reintroduce Sub-Moments
- NEVER reintroduce scene detection or automatic scene splitting
- NEVER replace chronological Timeline ordering with algorithmic ranking
- NEVER treat client-side authorization as authoritative
- NEVER treat ClickHouse as domain authority
- NEVER use EventStoreDB as the general Timeline query database
- Do not add Redis as a foundational dependency without a measured, approved need
- Do not introduce microservices solely for organizational aesthetics

## API Architecture

- Framework: Fastify
- Follow the feature-based canonical tree in `docs/architecture/monorepo.md`
- Maintain a dedicated `features/authorization/` module
- Use CQRS where command/query separation is useful; avoid ceremonial abstractions
- Use Event Sourcing only for domains explicitly designed for it
- EventStoreDB stores canonical event streams for event-sourced aggregates
- PostgreSQL owns relational/application/read responsibilities assigned by architecture
- Kafka carries asynchronous Integration Events
- ClickHouse stores Timeline/read projections assigned by architecture
- Events are immutable and deliberately versioned
- Use optimistic concurrency for event-sourced aggregates
- Avoid unsafe dual writes
- Consumers must be idempotent where delivery can be repeated
- Projections must support replay/rebuild and preserve privacy/deletion guarantees

## Feed Aggregator

- `apps/feed-aggregator` is read-only
- Use GraphQL for Timeline/read composition
- Do not place domain writes or write aggregates in the feed aggregator
- Do not duplicate API business logic
- Keep Timeline composition and historical aggregation out of mobile
- Use deterministic opaque cursor pagination
- Do not use offset pagination for Timeline navigation
- Bound GraphQL page sizes and query complexity
- Apply Viewer-aware privacy and authorization to all reads

## Mobile

- Framework: React Native with Expo
- Bootstrap with appropriate current Expo tooling when the mobile phase begins
- Reconcile generated files with the canonical monorepo
- Keep the application Timeline-first
- Consume authoritative API/feed contracts rather than duplicating backend logic
- Use secure platform storage for sensitive authentication material
- Client-side validation and authorization checks are UX aids, never authority

## Web

- Framework: Gatsby
- `apps/web` is the public/marketing web application unless canonical product docs say otherwise
- Do not turn it into a second consumer application
- Do not turn it into an admin application
- Bootstrap with appropriate current Gatsby tooling when its phase begins

## Media

- Prefer direct object-storage uploads rather than proxying large media through the API
- API authorizes/registers uploads and verifies finalization
- Server-side metadata is authoritative
- Never trust client-provided MIME type or duration as authoritative
- Media processing workers must be retryable and idempotent
- Media processing includes required metadata extraction/transcoding, not scene detection

## Authentication and Authorization

- Authentication and authorization are separate concerns
- Enforce authorization server-side
- Client role/permission checks only control presentation
- Test IDOR and cross-user access attempts
- Default to deny when security-sensitive authorization state is ambiguous
- Deep links, URLs, and cursors never permanently confer access; reauthorize current state

## Privacy and Security

- Privacy affects API authorization, projections, feeds, media, notifications, caches, and other read models
- Replay/rebuild must not resurrect inaccessible or erased data
- Validate all untrusted input
- Use least-privilege credentials
- Never commit secrets or `.env` files
- Runtime-validate environment configuration
- Do not log secrets or sensitive data
- Bound request sizes, pagination, uploads, and GraphQL complexity
- Preserve audit evidence for privileged operations

## Historical Significance and Causality

- Historical significance is not a simple engagement score
- Follow `docs/product/historical-significance.md`
- Prefer precomputed/derived significance over expensive synchronous Timeline computation
- Preserve provenance and algorithm/version information for derived results
- Keep authoritative causal relationships distinct from speculative/inferred relationships
- AI/model inference must not silently become authoritative

## Caching and Search

- Optimize measured bottlenecks before adding caching
- Prefer query/code improvements, indexes/data layout, and batching before distributed caching
- Request-scoped DataLoader/batching is appropriate in the feed aggregator
- Cross-request caching must preserve Viewer privacy and authorization
- Do not add Redis preemptively
- Follow the canonical search architecture
- Do not add Elasticsearch/OpenSearch merely because search exists

## Local Infrastructure

- Initial local services:
  - PostgreSQL
  - EventStoreDB
  - Kafka
  - ClickHouse
- Add S3-compatible object storage when media implementation requires it
- Keep `.env.example` synchronized with required configuration
- Verify actual service connectivity, not merely that containers are running

## Dependencies

- Add dependencies at the narrowest owning package/application
- Do not accumulate application dependencies in the root package
- Prefer platform/framework capabilities before adding libraries
- Avoid dependencies for trivial utilities
- Check current official documentation for version-sensitive APIs
- Do not replace established architectural technologies without explicit approval

## Verification

- After changes, run the narrowest relevant checks first
- Typical order:
  - targeted unit tests
  - package/application tests
  - typecheck
  - lint
  - build
  - integration tests when warranted
- Use pnpm workspace filtering when appropriate
- Before completion, report:
  - what changed
  - important implementation/architecture decisions
  - checks actually run
  - unresolved or intentionally deferred work

## Documentation

- Do not restore completion statuses to `docs/README.md`
- Do not add `Relationship to *` or `Relates to *` sections
- Update canonical docs when implementation changes a documented architectural/product decision
- Do not create a new documentation phase before implementation
- When implementing a major subsystem, reread its corresponding file under `docs/product/` or `docs/architecture/`

## Working Principles

- Exercise strong technical judgment; do not blindly agree with poor implementation choices
- Challenge changes that violate canonical invariants, duplicate responsibility, weaken security/privacy, or introduce premature complexity
- Do not reopen settled decisions without a concrete technical reason
- Do not ask questions already answered by canonical documentation
- Prefer the smallest coherent implementation that fully solves the current task
- Avoid unrelated refactors
- Prefer clear ownership boundaries and deterministic, replayable behavior
- Favor measured needs over speculative infrastructure
