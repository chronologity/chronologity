# Chronologity Monorepo Architecture

## Purpose

This document defines the canonical repository topology for Chronologity and the ownership rules that govern code placement inside the monorepo.

The detailed directory trees in this document are grounded in the canonical monorepo dump established for Chronologity and amended by the finalized product specifications. Superseded structural concepts are removed so that the trees describe the repository we intend to build rather than an earlier historical snapshot.

The governing precedence is:

```text
Finalized product specifications
        ↓ determine
Canonical monorepo architecture
        ↓ constrains
Focused architecture documentation
        ↓ constrains
Implementation
```

## Repository Principles

Chronologity is a pnpm TypeScript monorepo organized around four deployable applications, shared contract/tooling packages, repository-level automation, local infrastructure, and documentation.

The monorepo is a development and governance boundary. It is not a runtime boundary. Applications must communicate through explicit HTTP, GraphQL, or event contracts rather than importing implementation code from another application.

There is deliberately **no separate administrative application**. Administrative and moderation experiences live in the consumer mobile application when appropriate, while every privileged operation is protected by backend-enforced role-based authorization.

The repository favors:

- feature-oriented organization;
- kebab-case filenames;
- colocated unit tests;
- explicit imports;
- no barrel files unless a deliberate package-level public API requires one;
- shared contracts rather than shared application internals;
- clear ownership of authoritative versus derived state;
- and application boundaries that remain real despite physical colocation in one repository.

---

# Canonical Repository Topology

The canonical repository structure two levels deep from the root is:

```text
chronologity/
├── apps/
│   ├── api/
│   ├── feed-aggregator/
│   ├── mobile/
│   └── web/
├── packages/
│   ├── api-client/
│   ├── config/
│   ├── contracts/
│   ├── eslint-config/
│   ├── timeline-derivation/
│   └── tsconfig/
├── docs/
│   ├── architecture/
│   ├── product/
│   ├── README.md
│   └── glossary.md
├── scripts/
│   ├── generate-event.sh
│   └── generate-feature.sh
├── docker/
│   ├── clickhouse/
│   └── postgres/
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
```

## Root Responsibilities

### `apps/`

Contains the four deployable Chronologity applications:

```text
apps/
├── api/
├── feed-aggregator/
├── mobile/
└── web/
```

No `apps/admin/` application exists or should be introduced without an explicit architecture decision that reverses the current product direction.

### `packages/`

Contains cross-application contracts and repository-wide tooling/configuration that genuinely belong to more than one deployable application.

The canonical shared packages are:

```text
packages/
├── api-client/
├── config/
├── contracts/
├── eslint-config/
├── timeline-derivation/
└── tsconfig/
```

### `docs/`

Contains the required product and architecture specifications plus the documentation index and glossary. `docs/README.md` governs the canonical documentation inventory. Additional focused documentation areas may be introduced alongside implementation when a concrete need exists, but they are not part of the required preimplementation repository structure.

### `scripts/`

Contains repository-level generators and automation that operate across applications or packages.

### `docker/`

Contains local infrastructure configuration for ClickHouse, Kafka, PostgreSQL, and object storage.

### Root configuration

The root pnpm workspace, TypeScript configuration, package manifest, lockfile, and repository README coordinate the monorepo as a whole.

---

# Application Boundaries

## `apps/api`

`apps/api` is the authoritative Fastify + TypeScript backend.

It owns domain invariants, authorization, authentication workflows, authoritative state in PostgreSQL, operational REST endpoints, uploads, notifications, moderation decisions, and projection definitions/update logic.

It is feature-oriented. Within a feature the layering is route → service → repository, with pure policy modules holding rules that are worth stating on their own (ADR-091).

The canonical structural baseline is:

```text
apps/
└── api/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── vitest.integration.config.ts
    ├── README.md
    ├── migrations/
    │   └── <timestamp>-<description>.sql
    └── src/
        ├── main.ts
        ├── server/
        │   ├── app.ts
        │   ├── server.ts
        │   ├── register-routes.ts
        │   └── register-plugins.ts
        ├── config/
        │   ├── env.ts
        │   ├── app-config.ts
        │   ├── auth-config.ts
        │   └── database-config.ts
        ├── plugins/
        │   ├── auth.plugin.ts
        │   ├── cors.plugin.ts
        │   ├── helmet.plugin.ts
        │   ├── rate-limit.plugin.ts
        │   ├── request-context.plugin.ts
        │   └── validation.plugin.ts
        ├── lib/
        │   ├── database/
        │   │   ├── postgres.ts
        │   │   ├── transaction.ts
        │   │   ├── migrations.ts
        │   │   └── outbox.ts
        │   ├── messaging/
        │   │   ├── kafka.ts
        │   │   ├── producer.ts
        │   │   ├── consumer.ts
        │   │   └── topics.ts
        │   ├── logger/
        │   │   └── logger.ts
        │   ├── errors/
        │   │   ├── domain-error.ts
        │   │   ├── not-found-error.ts
        │   │   ├── unauthorized-error.ts
        │   │   ├── concurrency-conflict-error.ts
        │   │   └── validation-error.ts
        │   ├── ids/
        │   └── time/
        ├── types/
        │   ├── event-metadata.ts
        │   └── request-context.ts
        ├── testing/
        │   └── <shared integration-test harness>
        ├── integrations/
        │   ├── email/
        │   ├── storage/
        │   ├── metadata/
        │   └── places/
        ├── projections/
        │   └── <projector + projection repository per read model>
        ├── workers/
        │   ├── outbox-publisher/
        │   ├── media/
        │   └── projections/
        └── features/
            ├── authentication/
            ├── authorization/
            ├── users/
            ├── moments/
            ├── uploads/
            ├── locations/
            ├── real-world-events/
            ├── social-graph/
            ├── reactions/
            ├── comments/
            ├── causality/
            ├── historical-significance/
            ├── moderation/
            ├── notifications/
            └── health/
```

### The feature template

Every feature takes the same shape. `locations` is shown in full because it is the shortest complete example; the rest differ only in how many files each part needs.

```text
features/locations/
├── location.routes.ts
├── location.service.ts
├── location.service.integration.test.ts
├── location.repository.ts
├── location.policy.ts
├── location.policy.test.ts
├── location.types.ts
└── location.integration.test.ts
```

- `*.routes.ts` — Fastify registration, schemas, status codes, and preHandlers. Calls services and nothing else.
- `*.service.ts` — a class. Orchestrates one use case per method, owns the transaction, and enqueues any integration event inside it. Methods are named for what they do without repeating the noun the class already carries: `record`, `finalize`, `updateHandle`.
- `*.model.ts` — the feature's tables as TypeORM entities, one class per table, beside the code that uses them (ADR-099). The migrations own the schema; these describe it.
- `*.repository.ts` — a class holding the queries, written against those entities. Reads take the DataSource; writes take a transaction, so the transaction stays visible at the call site.
- `*.policy.ts` — pure functions. Where the rules live, and the layer that gets exhaustive unit tests.
- `*.types.ts` — feature-local types. Types crossing the API boundary belong in `packages/contracts`.
- `*.schemas.ts` — only when a feature needs a request shape no client shares. Otherwise validation comes from `packages/contracts`.

This is a default shape, not a checklist. A feature omits any file it has no real responsibility for; `health/` is a single routes file and correctly so.

### Where the tests go

- Rules are proven by unit tests against the policy module. These need no infrastructure and run in milliseconds.
- Services are proven by integration tests against real PostgreSQL. A service orchestrates repositories, so unit-testing it would mean substituting the database — and a hand-written fake proves only that the service works against the fake.
- Repositories get their own tests when they contain query composition, row mapping, or transactional behaviour worth isolating. A one-line pass-through is covered adequately by the feature's integration test.

### API placement rules

The major directory meanings are:

- `src/server/` owns Fastify composition and server startup.
- `src/config/` owns API-local configuration. Environment validation stays here rather than in a shared package: the API's environment is the API's business.
- `src/plugins/` owns Fastify plugins.
- `src/lib/` owns infrastructure-facing primitives used across API features.
- `src/integrations/` owns explicit external-system adapters.
- `src/projections/` owns read-model projectors and their repositories.
- `src/workers/` owns processes that run outside the HTTP runtime.
- `src/testing/` owns the shared integration-test harness.
- `src/features/` owns domain/application behavior by feature.
- Tests are colocated next to the implementation files they protect.

The API has no controller layer. With `fastify-type-provider-zod` the route handler already receives a validated, typed request, so a class between the route and the service would translate nothing (ADR-091).

Business rules must not accumulate in route handlers. A route that needs a rule reaches into a service to find it.

Commands and queries are not separated. A method that changes state and a method that reads it sit on the same service class.

Dependencies are wired by hand at the composition root in `main.ts`. There is no container.

---

## `apps/mobile`

`apps/mobile` is the primary Chronologity consumer product built with React Native and Expo.

It owns Timeline interaction, Moment creation and viewing, media upload and playback, user/account experiences, reactions, notifications, moderation/reporting experiences, and role-authorized administrative interfaces.

It consumes REST contracts from the authoritative API and GraphQL from the read-only Timeline aggregator.

The canonical structural baseline is:

```text
apps/
└── mobile/
    ├── package.json
    ├── tsconfig.json
    ├── app.json
    ├── babel.config.js
    ├── metro.config.js
    ├── .env.example
    ├── README.md
    ├── assets/
    │   ├── fonts/
    │   ├── icons/
    │   ├── images/
    │   ├── splash/
    │   └── videos/
    ├── scripts/
    │   ├── generate-screen.sh
    │   └── generate-feature.sh
    └── src/
        ├── index.ts
        ├── app/
        │   ├── App.tsx
        │   ├── providers.tsx
        │   ├── navigation/
        │   │   ├── root.navigator.tsx
        │   │   ├── auth.navigator.tsx
        │   │   ├── main-tabs.navigator.tsx
        │   │   ├── modal.navigator.tsx
        │   │   └── linking.ts
        │   ├── theme/
        │   │   ├── colors.ts
        │   │   ├── spacing.ts
        │   │   ├── typography.ts
        │   │   ├── radius.ts
        │   │   └── theme.ts
        │   └── config/
        │       ├── env.ts
        │       ├── feature-flags.ts
        │       └── app-config.ts
        ├── lib/
        │   ├── api/
        │   │   ├── client.ts
        │   │   ├── auth-client.ts
        │   │   ├── timelines-client.ts
        │   │   ├── moments-client.ts
        │   │   ├── uploads-client.ts
        │   │   ├── reactions-client.ts
        │   │   ├── notifications-client.ts
        │   │   └── moderation-client.ts
        │   ├── graphql/
        │   │   ├── client.ts
        │   │   ├── queries/
        │   │   │   ├── get-timeline-head.query.ts
        │   │   │   ├── get-timeline-slice.query.ts
        │   │   │   ├── get-timeline-around-moment.query.ts
        │   │   │   ├── get-timeline-by-location.query.ts
        │   │   │   ├── get-timeline-by-user.query.ts
        │   │   │   ├── get-timeline-by-tag.query.ts
        │   │   │   └── get-timeline-by-network.query.ts
        │   │   └── fragments/
        │   │       ├── moment.fragment.ts
        │   │       ├── timeline.fragment.ts
        │   │       └── notification.fragment.ts
        │   ├── storage/
        │   │   ├── secure-storage.ts
        │   │   ├── async-storage.ts
        │   │   └── cache-keys.ts
        │   ├── media/
        │   │   ├── image-picker.ts
        │   │   ├── video-picker.ts
        │   │   ├── media-permissions.ts
        │   │   ├── upload-queue.ts
        │   │   └── presigned-upload.ts
        │   ├── timeline/
        │   │   ├── cursor.ts
        │   │   ├── scroll-state.ts
        │   │   ├── timeline-layout.ts
        │   │   ├── depth-navigation.ts
        │   │   └── adjacency.ts
        │   ├── analytics/
        │   │   ├── analytics.ts
        │   │   └── events.ts
        │   ├── notifications/
        │   │   ├── push-permissions.ts
        │   │   ├── register-device-token.ts
        │   │   └── local-notifications.ts
        │   ├── auth/
        │   │   ├── session.ts
        │   │   ├── magic-link.ts
        │   │   └── oauth.ts
        │   └── utils/
        │       ├── format-date.ts
        │       ├── format-duration.ts
        │       ├── format-location.ts
        │       ├── debounce.ts
        │       ├── throttle.ts
        │       └── invariant.ts
        ├── store/
        │   ├── auth.store.ts
        │   ├── session.store.ts
        │   ├── timeline.store.ts
        │   ├── timeline-ui.store.ts
        │   ├── upload.store.ts
        │   ├── notification.store.ts
        │   ├── user.store.ts
        │   └── app.store.ts
        ├── hooks/
        │   ├── use-auth.ts
        │   ├── use-current-user.ts
        │   ├── use-upload.ts
        │   ├── use-upload-permissions.ts
        │   ├── use-timeline.ts
        │   ├── use-timeline-head.ts
        │   ├── use-timeline-slice.ts
        │   ├── use-timeline-scroll.ts
        │   ├── use-horizontal-context.ts
        │   ├── use-depth-navigation.ts
        │   ├── use-moment.ts
        │   ├── use-reactions.ts
        │   ├── use-notifications.ts
        │   ├── use-theme.ts
        │   └── use-app-state.ts
        ├── components/
        │   ├── primitives/
        │   │   ├── app-text.tsx
        │   │   ├── app-view.tsx
        │   │   ├── app-button.tsx
        │   │   ├── app-icon.tsx
        │   │   ├── app-avatar.tsx
        │   │   ├── app-input.tsx
        │   │   ├── app-pressable.tsx
        │   │   ├── app-loader.tsx
        │   │   └── app-divider.tsx
        │   ├── layout/
        │   │   ├── screen.tsx
        │   │   ├── safe-area-screen.tsx
        │   │   ├── page-header.tsx
        │   │   ├── page-footer.tsx
        │   │   ├── tab-bar.tsx
        │   │   ├── bottom-sheet.tsx
        │   │   └── modal-shell.tsx
        │   ├── timeline/
        │   │   ├── timeline-shell.tsx
        │   │   ├── timeline-column.tsx
        │   │   ├── timeline-row.tsx
        │   │   ├── timeline-slice-list.tsx
        │   │   ├── horizontal-context-strip.tsx
        │   │   ├── timeline-cursor-indicator.tsx
        │   │   ├── timeline-loading-state.tsx
        │   │   └── timeline-empty-state.tsx
        │   ├── moments/
        │   │   ├── moment-card.tsx
        │   │   ├── moment-thumbnail.tsx
        │   │   ├── moment-image.tsx
        │   │   ├── moment-video.tsx
        │   │   ├── moment-video-player.tsx
        │   │   ├── moment-metadata.tsx
        │   │   ├── moment-reactions.tsx
        │   │   ├── moment-depth-view.tsx
        │   │   ├── moment-context-header.tsx
        │   │   └── moment-actions.tsx
        │   ├── uploads/
        │   │   ├── upload-button.tsx
        │   │   ├── upload-progress.tsx
        │   │   ├── upload-preview.tsx
        │   │   ├── upload-error-state.tsx
        │   │   └── media-picker-sheet.tsx
        │   ├── auth/
        │   │   ├── magic-link-form.tsx
        │   │   ├── oauth-buttons.tsx
        │   │   ├── session-guard.tsx
        │   │   └── auth-loading-screen.tsx
        │   ├── notifications/
        │   │   ├── notification-item.tsx
        │   │   ├── notification-badge.tsx
        │   │   └── notifications-list.tsx
        │   ├── profile/
        │   │   ├── profile-header.tsx
        │   │   ├── profile-stats.tsx
        │   │   ├── profile-timeline-tab.tsx
        │   │   └── profile-actions.tsx
        │   └── feedback/
        │       ├── error-state.tsx
        │       ├── empty-state.tsx
        │       ├── offline-banner.tsx
        │       ├── retry-button.tsx
        │       └── toast.tsx
        ├── features/
        │   ├── auth/
        │   │   ├── screens/
        │   │   │   ├── sign-in.screen.tsx
        │   │   │   ├── verify-magic-link.screen.tsx
        │   │   │   ├── link-provider.screen.tsx
        │   │   │   └── two-factor.screen.tsx
        │   │   ├── view-models/
        │   │   │   ├── sign-in.view-model.ts
        │   │   │   └── verify-magic-link.view-model.ts
        │   │   └── types/
        │   │       └── auth-navigation.ts
        │   ├── users/
        │   │   ├── screens/
        │   │   │   ├── profile.screen.tsx
        │   │   │   ├── edit-profile.screen.tsx
        │   │   │   ├── settings.screen.tsx
        │   │   │   ├── account-status.screen.tsx
        │   │   │   └── user-emails.screen.tsx
        │   │   ├── view-models/
        │   │   │   ├── profile.view-model.ts
        │   │   │   ├── edit-profile.view-model.ts
        │   │   │   └── settings.view-model.ts
        │   │   └── types/
        │   │       └── user-navigation.ts
        │   ├── uploads/
        │   │   ├── screens/
        │   │   │   ├── create-upload.screen.tsx
        │   │   │   ├── upload-progress.screen.tsx
        │   │   │   ├── upload-review.screen.tsx
        │   │   │   └── upload-error.screen.tsx
        │   │   ├── view-models/
        │   │   │   ├── create-upload.view-model.ts
        │   │   │   ├── upload-progress.view-model.ts
        │   │   │   └── upload-review.view-model.ts
        │   │   └── types/
        │   │       └── upload-navigation.ts
        │   ├── moments/
        │   │   ├── screens/
        │   │   │   ├── create-moment.screen.tsx
        │   │   │   ├── moment-detail.screen.tsx
        │   │   │   ├── edit-moment-metadata.screen.tsx
        │   │   │   └── moment-context.screen.tsx
        │   │   ├── view-models/
        │   │   │   ├── create-moment.view-model.ts
        │   │   │   ├── moment-detail.view-model.ts
        │   │   │   └── edit-moment-metadata.view-model.ts
        │   │   └── types/
        │   │       └── moment-navigation.ts
        │   ├── reactions/
        │   │   ├── components/
        │   │   │   ├── reaction-bar.tsx
        │   │   │   ├── reaction-picker.tsx
        │   │   │   └── reaction-summary.tsx
        │   │   ├── view-models/
        │   │   │   └── reactions.view-model.ts
        │   │   └── types/
        │   │       └── reaction-types.ts
        │   ├── timelines/
        │   │   ├── screens/
        │   │   │   ├── timeline.screen.tsx
        │   │   │   ├── timeline-context.screen.tsx
        │   │   │   ├── timeline-by-location.screen.tsx
        │   │   │   ├── timeline-by-user.screen.tsx
        │   │   │   ├── timeline-by-tag.screen.tsx
        │   │   │   └── timeline-settings.screen.tsx
        │   │   ├── components/
        │   │   │   ├── vertical-timeline-list.tsx
        │   │   │   ├── horizontal-timeline-strip.tsx
        │   │   │   ├── timeline-scope-chip.tsx
        │   │   │   ├── timeline-head.tsx
        │   │   │   └── timeline-stats.tsx
        │   │   ├── view-models/
        │   │   │   ├── timeline.view-model.ts
        │   │   │   ├── timeline-slice.view-model.ts
        │   │   │   ├── timeline-location.view-model.ts
        │   │   │   └── timeline-settings.view-model.ts
        │   │   └── types/
        │   │       └── timeline-navigation.ts
        │   ├── notifications/
        │   │   ├── screens/
        │   │   │   ├── notifications.screen.tsx
        │   │   │   └── notification-detail.screen.tsx
        │   │   ├── view-models/
        │   │   │   ├── notifications.view-model.ts
        │   │   │   └── notification-detail.view-model.ts
        │   │   └── types/
        │   │       └── notification-navigation.ts
        │   └── moderation/
        │       ├── screens/
        │       │   ├── report-content.screen.tsx
        │       │   ├── content-restricted.screen.tsx
        │       │   └── account-suspended.screen.tsx
        │       ├── view-models/
        │       │   ├── report-content.view-model.ts
        │       │   └── account-status.view-model.ts
        │       └── types/
        │           └── moderation-navigation.ts
        └── types/
            ├── navigation.ts
            ├── media.ts
            ├── timeline.ts
            ├── moment.ts
            ├── upload.ts
            ├── notification.ts
            └── reaction.ts
```

### What the tree describes, and what exists

The tree above is the shape this application grows into, not a checklist to
satisfy on day one: files are created when they acquire a responsibility, never
to populate a diagram.

Phase 11 created the spine — `app/` with its config, providers and three
navigators; `lib/` with `api/`, `graphql/`, `auth/` and `storage/`; one screen
under each of `features/auth/` and `features/timelines/`; and `components/feedback/`
for the error boundary and error state. The rest arrives with the screens that
need it, in Phase 12.

Two deviations from the tree are permanent rather than pending:

**No `babel.config.js`.** Expo SDK 57 configures Babel through `babel-preset-expo`
without a project-level file, and the template no longer generates one. Adding
one back would be a file that exists to match a diagram.

**Imports inside this application omit the `.js` extension**, unlike every other
package here. Those use `nodenext` resolution, where the extension is required;
Metro resolves like a bundler, where a `.js` specifier pointing at a `.ts` file
is a file that does not exist. The preset says which world a package is in.

`jest.config.js` and `metro.config.js` sit alongside the framework files, and
this application has no `tsconfig.build.json` — Metro produces the bundle, so
there is no `tsc` build to exclude tests from.

### Mobile placement rules

The major directory meanings are:

- `src/app/` owns application composition, navigation, theme, and app-level configuration.
- `src/lib/api/` owns REST-facing client adapters.
- `src/lib/graphql/` owns Timeline/aggregator GraphQL access.
- `src/lib/media/` owns device/media integration primitives.
- `src/lib/timeline/` owns reusable Timeline interaction mechanics rather than authoritative historical rules.
- `src/store/` owns client state.
- `src/hooks/` owns reusable client-facing hooks.
- `src/components/` owns reusable presentation components.
- `src/features/` owns screen/view-model organization around user-facing capabilities.
- Tests remain colocated rather than moving into a global test hierarchy.

The client may implement presentation and optimistic UX, but backend domain rules remain authoritative.

---

## `apps/web`

`apps/web` is the Gatsby public website.

It is optimized for static and content-heavy concerns such as marketing, product explanation, editorial material, press, careers, legal content, contact, newsletter, waitlist flows, SEO, structured metadata, and public acquisition.

It is not the main Chronologity product client.

The canonical structural baseline is:

```text
apps/
└── web/
├── package.json
├── tsconfig.json
├── gatsby-config.ts
├── gatsby-node.ts
├── gatsby-browser.ts
├── gatsby-ssr.ts
├── .env.example
├── README.md
├── static/
│ ├── favicon.ico
│ ├── robots.txt
│ ├── site.webmanifest
│ ├── og/
│ │ ├── default-og.png
│ │ └── timeline-og.png
│ └── icons/
├── content/
│ ├── pages/
│ │ ├── home.md
│ │ ├── about.md
│ │ ├── careers.md
│ │ ├── press.md
│ │ ├── faq.md
│ │ ├── privacy.md
│ │ ├── terms.md
│ │ └── contact.md
│ ├── blog/
│ │ ├── introducing-chronologity.md
│ │ ├── why-time-matters.md
│ │ └── immutable-moments.md
│ ├── press/
│ │ ├── press-kit.md
│ │ ├── brand-assets.md
│ │ └── media-inquiries.md
│ └── legal/
│ ├── privacy-policy.md
│ └── terms-of-service.md
├── src/
│ ├── pages/
│ │ ├── index.tsx
│ │ ├── about.tsx
│ │ ├── careers.tsx
│ │ ├── press.tsx
│ │ ├── faq.tsx
│ │ ├── privacy.tsx
│ │ ├── terms.tsx
│ │ ├── contact.tsx
│ │ ├── 404.tsx
│ │ └── blog/
│ │ └── {MarkdownRemark.fields__slug}.tsx
│ ├── templates/
│ │ ├── page.template.tsx
│ │ ├── blog-post.template.tsx
│ │ ├── press-page.template.tsx
│ │ └── legal-page.template.tsx
│ ├── app/
│ │ ├── providers.tsx
│ │ ├── seo/
│ │ │ ├── seo.tsx
│ │ │ ├── structured-data.tsx
│ │ │ ├── open-graph.ts
│ │ │ └── twitter-card.ts
│ │ ├── theme/
│ │ │ ├── colors.ts
│ │ │ ├── spacing.ts
│ │ │ ├── typography.ts
│ │ │ ├── breakpoints.ts
│ │ │ └── theme.ts
│ │ └── config/
│ │ ├── env.ts
│ │ ├── site-config.ts
│ │ └── feature-flags.ts
│ ├── components/
│ │ ├── primitives/
│ │ │ ├── button.tsx
│ │ │ ├── link.tsx
│ │ │ ├── text.tsx
│ │ │ ├── heading.tsx
│ │ │ ├── icon.tsx
│ │ │ ├── image.tsx
│ │ │ ├── section.tsx
│ │ │ ├── container.tsx
│ │ │ └── input.tsx
│ │ ├── layout/
│ │ │ ├── site-shell.tsx
│ │ │ ├── header.tsx
│ │ │ ├── footer.tsx
│ │ │ ├── nav.tsx
│ │ │ ├── mobile-nav.tsx
│ │ │ ├── page-hero.tsx
│ │ │ └── page-section.tsx
│ │ ├── seo/
│ │ │ ├── canonical-link.tsx
│ │ │ ├── meta-tags.tsx
│ │ │ └── json-ld.tsx
│ │ ├── content/
│ │ │ ├── markdown-renderer.tsx
│ │ │ ├── rich-text.tsx
│ │ │ ├── content-block.tsx
│ │ │ └── article-card.tsx
│ │ ├── home/
│ │ │ ├── home-hero.tsx
│ │ │ ├── value-props.tsx
│ │ │ ├── timeline-explainer.tsx
│ │ │ ├── product-philosophy.tsx
│ │ │ ├── app-preview.tsx
│ │ │ ├── call-to-action.tsx
│ │ │ └── faq-preview.tsx
│ │ ├── about/
│ │ │ ├── mission-section.tsx
│ │ │ ├── philosophy-section.tsx
│ │ │ ├── how-it-works-section.tsx
│ │ │ └── principles-section.tsx
│ │ ├── careers/
│ │ │ ├── open-roles.tsx
│ │ │ ├── culture-section.tsx
│ │ │ └── hiring-process.tsx
│ │ ├── press/
│ │ │ ├── press-kit-download.tsx
│ │ │ ├── media-assets.tsx
│ │ │ └── contact-press.tsx
│ │ ├── blog/
│ │ │ ├── blog-index.tsx
│ │ │ ├── blog-post-header.tsx
│ │ │ ├── blog-post-body.tsx
│ │ │ └── related-posts.tsx
│ │ ├── forms/
│ │ │ ├── contact-form.tsx
│ │ │ ├── newsletter-form.tsx
│ │ │ └── waitlist-form.tsx
│ │ └── feedback/
│ │ ├── empty-state.tsx
│ │ ├── error-state.tsx
│ │ └── loading-state.tsx
│ ├── features/
│ │ ├── marketing/
│ │ │ ├── sections/
│ │ │ │ ├── hero.section.tsx
│ │ │ │ ├── philosophy.section.tsx
│ │ │ │ ├── timeline.section.tsx
│ │ │ │ ├── moments.section.tsx
│ │ │ │ ├── immutability.section.tsx
│ │ │ │ └── call-to-action.section.tsx
│ │ │ ├── hooks/
│ │ │ │ └── use-homepage-copy.ts
│ │ │ └── types/
│ │ │ └── marketing-types.ts
│ │ ├── content/
│ │ │ ├── hooks/
│ │ │ │ ├── use-page-content.ts
│ │ │ │ ├── use-blog-post.ts
│ │ │ │ └── use-blog-index.ts
│ │ │ └── types/
│ │ │ └── content-types.ts
│ │ ├── forms/
│ │ │ ├── hooks/
│ │ │ │ ├── use-contact-form.ts
│ │ │ │ ├── use-newsletter-form.ts
│ │ │ │ └── use-waitlist-form.ts
│ │ │ └── types/
│ │ │ └── form-types.ts
│ │ └── seo/
│ │ ├── hooks/
│ │ │ └── use-seo.ts
│ │ └── types/
│ │ └── seo-types.ts
│ ├── lib/
│ │ ├── api/
│ │ │ ├── client.ts
│ │ │ ├── public-client.ts
│ │ │ └── contact-client.ts
│ │ ├── content/
│ │ │ ├── markdown.ts
│ │ │ ├── mdx.ts
│ │ │ └── content-helpers.ts
│ │ ├── analytics/
│ │ │ ├── analytics.ts
│ │ │ ├── pageview.ts
│ │ │ └── events.ts
│ │ ├── forms/
│ │ │ ├── submit-contact.ts
│ │ │ ├── submit-newsletter.ts
│ │ │ └── submit-waitlist.ts
│ │ ├── images/
│ │ │ ├── image-helpers.ts
│ │ │ └── responsive-image.ts
│ │ └── utils/
│ │     ├── format-date.ts
│ │     ├── slugify.ts
│ │     ├── canonical-url.ts
│ │     └── invariant.ts
│ ├── hooks/
│ │ ├── use-site-config.ts
│ │ ├── use-breakpoint.ts
│ │ ├── use-newsletter.ts
│ │ ├── use-waitlist.ts
│ │ └── use-scroll-position.ts
│ ├── styles/
│ │ ├── global.css
│ │ ├── reset.css
│ │ ├── variables.css
│ │ ├── typography.css
│ │ └── utilities.css
│ └── types/
│     ├── page.ts
│     ├── seo.ts
│     ├── blog.ts
│     ├── form.ts
│     └── site.ts
```

### Web placement rules

The major directory meanings are:

- `content/` owns editorial/static source content separately from React implementation.
- `src/pages/` owns fixed Gatsby routes and file-system-created routes.
- `src/templates/` owns dynamically generated content templates.
- `src/app/` owns global providers, SEO, theme, and configuration.
- `src/components/` owns reusable site components.
- `src/features/` owns lightweight website-specific feature organization.
- `src/lib/` owns site-local integration and utility code.
- `src/styles/` owns global styling primitives.
- Tests are colocated with the components/hooks they exercise.

The Gatsby application should not acquire mobile-product domain logic, Timeline rendering engines, or authoritative state.

---

## `apps/feed-aggregator`

`apps/feed-aggregator` is the repository's canonical name for the read-only GraphQL Timeline composition service.

Despite the name, its responsibility is broader than a conventional Feed: it composes Chronologity's multidimensional Timeline experience over ClickHouse read models, including chronological pagination, contextual adjacency, Moment depth, batching, prefetching, and navigation.

It is not a second authoritative backend.

The canonical structural baseline is:

```text
apps/
└── feed-aggregator/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── README.md
    ├── scripts/
    │   ├── generate-graphql-type.sh
    │   ├── generate-query.sh
    │   └── generate-loader.sh
    └── src/
        ├── index.ts
        ├── server/
        │   ├── app.ts
        │   ├── compose.ts
        │   ├── server.ts
        │   ├── health.ts
        │   ├── health.routes.ts
        │   ├── register-graphql.ts
        │   └── register-plugins.ts
        ├── config/
        │   ├── app-config.ts
        │   ├── auth-config.ts
        │   ├── clickhouse-config.ts
        │   ├── database-config.ts
        │   ├── env.ts
        │   └── graphql-config.ts
        ├── plugins/
        │   ├── auth.plugin.ts
        │   ├── cors.plugin.ts
        │   ├── helmet.plugin.ts
        │   ├── metrics.plugin.ts
        │   └── request-context.plugin.ts
        ├── graphql/
        │   ├── schema/
        │   │   ├── schema.graphql
        │   │   ├── scalar.graphql
        │   │   ├── pagination.graphql
        │   │   ├── moment.graphql
        │   │   ├── timeline.graphql
        │   │   ├── location.graphql
        │   │   ├── reaction.graphql
        │   │   ├── user.graphql
        │   │   └── moderation.graphql
        │   ├── resolvers/
        │   │   ├── query.resolver.ts
        │   │   ├── moment.resolver.ts
        │   │   ├── timeline.resolver.ts
        │   │   ├── location.resolver.ts
        │   │   ├── reaction.resolver.ts
        │   │   └── user.resolver.ts
        │   ├── scalars/
        │   │   ├── cursor.scalar.ts
        │   │   ├── date-time.scalar.ts
        │   │   └── longitude-latitude.scalar.ts
        │   ├── context/
        │   │   ├── graphql-context.ts
        │   │   └── create-context.ts
        │   └── types/
        │       ├── resolver-context.ts
        │       ├── resolver-parent.ts
        │       └── resolver-result.ts
        ├── timelines/
        │   ├── queries/
        │   │   ├── get-timeline-head.query.ts
        │   │   ├── get-timeline-head.query.test.ts
        │   │   ├── get-timeline-slice.query.ts
        │   │   ├── get-timeline-slice.query.test.ts
        │   │   ├── get-timeline-around-moment.query.ts
        │   │   ├── get-timeline-around-moment.query.test.ts
        │   │   ├── get-timeline-by-location.query.ts
        │   │   ├── get-timeline-by-user.query.ts
        │   │   ├── get-timeline-by-tag.query.ts
        │   │   ├── get-timeline-by-network.query.ts
        │   │   └── get-timeline-stats.query.ts
        │   ├── services/
        │   │   ├── timeline-composer.ts
        │   │   ├── timeline-adjacency.ts
        │   │   ├── timeline-prefetch.ts
        │   │   └── timeline-navigation.ts
        │   ├── models/
        │   │   ├── timeline-edge.model.ts
        │   │   ├── timeline-page.model.ts
        │   │   ├── timeline-slice.model.ts
        │   │   └── timeline-context.model.ts
        │   └── utils/
        │       ├── timeline-sort-key.ts
        │       └── timeline-direction.ts
        ├── moments/
        │   ├── queries/
        │   │   ├── get-moment.query.ts
        │   │   ├── get-moment.query.test.ts
        │   │   └── get-moment-context.query.ts
        │   ├── services/
        │   │   ├── moment-context.ts
        │   │   └── moment-media.ts
        │   └── models/
        │       ├── moment.model.ts
        │       └── moment-context.model.ts
        ├── locations/
        │   ├── queries/
        │   │   ├── get-location.query.ts
        │   │   ├── get-adjacent-locations.query.ts
        │   │   ├── get-location-timeline.query.ts
        │   │   └── get-location-context.query.ts
        │   ├── services/
        │   │   ├── location-adjacency.ts
        │   │   └── location-navigation.ts
        │   └── models/
        │       ├── location.model.ts
        │       └── location-adjacency.model.ts
        ├── reactions/
        │   ├── queries/
        │   │   ├── get-reaction-summary.query.ts
        │   │   └── get-user-reaction.query.ts
        │   └── models/
        │       └── reaction-summary.model.ts
        ├── users/
        │   ├── queries/
        │   │   ├── get-user-summary.query.ts
        │   │   └── get-user-timeline-summary.query.ts
        │   └── models/
        │       └── user-summary.model.ts
        ├── moderation/
        │   ├── queries/
        │   │   ├── get-content-visibility.query.ts
        │   │   └── get-user-visibility.query.ts
        │   └── services/
        │       └── visibility-filter.ts
        ├── read-models/
        │   ├── clickhouse/
        │   │   ├── client.ts
        │   │   ├── execute-query.ts
        │   │   ├── moment-read-model.ts
        │   │   ├── timeline-by-time-read-model.ts
        │   │   ├── timeline-by-location-read-model.ts
        │   │   ├── timeline-by-user-read-model.ts
        │   │   ├── timeline-by-tag-read-model.ts
        │   │   ├── timeline-by-network-read-model.ts
        │   │   ├── timeline-stats-read-model.ts
        │   │   ├── location-adjacency-read-model.ts
        │   │   ├── reaction-summary-read-model.ts
        │   │   ├── user-summary-read-model.ts
        │   │   └── moderation-visibility-read-model.ts
        │   ├── postgres/
        │   │   └── client.ts
        │   └── types/
        │       ├── read-model.ts
        │       └── read-model-row.ts
        ├── loaders/
        │   ├── create-loaders.ts
        │   ├── moment.loader.ts
        │   └── comment-page.loader.ts
        ├── pagination/
        │   ├── cursor.ts
        │   ├── encode-cursor.ts
        │   ├── decode-cursor.ts
        │   ├── cursor.test.ts
        │   ├── page-info.ts
        │   ├── connection.ts
        │   └── pagination-limit.ts
        ├── caching/                     # reserved; nothing built (ADR-147)
        ├── auth/
        │   ├── authenticate-request.ts
        │   ├── auth-context.ts
        │   └── permissions.ts
        ├── observability/
        │   ├── logger.ts
        │   ├── metrics.ts
        │   ├── tracing.ts
        │   └── query-timing.ts
        ├── errors/
        │   ├── aggregator-error.ts
        │   ├── bad-cursor-error.ts
        │   ├── forbidden-error.ts
        │   ├── not-found-error.ts
        │   └── query-error.ts
        └── utils/
            ├── invariant.ts
            ├── clamp.ts
            ├── group-by.ts
            └── unique.ts
```

### Aggregator placement rules

The major directory meanings are:

- `src/graphql/` owns the GraphQL transport contract, resolvers, scalars, and request context.
- `src/timelines/` owns Timeline read composition and navigation behavior.
- `src/moments/` owns Moment read composition, split into `queries/` and `services/` as the tree shows.
- `src/locations/`, `src/reactions/`, `src/users/`, and `src/moderation/` own read/composition concerns for those domains.
- `src/read-models/clickhouse/` is the normal persistence adapter boundary.
- `src/read-models/postgres/` is the narrow exception `feed.md` permits, and it now answers three kinds of question rather than one: current Viewer eligibility, **a Moment read in full when somebody opens one** (ADR-142), and **whether a thing somebody says they found is still findable** (ADR-148). The third is the narrowest read in the application — one boolean from `search_documents`, selecting no title, no body and no `search_vector`, so it cannot return a document and cannot become retrieval. It does not make this application own Search (`architecture/search.md:65`): ranking, suggestion and the index stay in `apps/api`, and the read model takes no Viewer, which is what stops it acquiring a second copy of that application's eligibility rule. The second was added deliberately — the Timeline projection holds no caption, media or discussion, so depth has nowhere else to come from — and the bound that matters is unchanged: paging a Timeline must not touch these tables, and if PostgreSQL is ever needed for every Timeline item the read model is wrong rather than this boundary (ADR-137). Its credential should be able to `SELECT` and no more.
- `src/loaders/` owns request-scoped batching and deduplication.

**Three files rather than the six this tree once named**, and the difference is
measurement rather than omission. `location`, `reaction-summary`,
`user-summary` and `moderation-visibility` had nothing left to batch by the time
loaders arrived: Moment depth folded places, authors, mentions and reaction
counts into lateral joins inside one statement, and moderation is a clause of the
visibility rule rather than a lookup. A loader for any of them would have been
called once, with one key, wrapping a read that was already a single query —
which is the kind of file this document elsewhere says not to create. What was
added instead is `comment-page.loader.ts`, for the one repetition measurement did
find. ADR-146 records it.
- `src/pagination/` owns opaque, deterministic cursor infrastructure. One `Cursor` scalar serves every connection, and `cursors.ts` tags the kinds this application invented — a Timeline position still encodes to exactly what `@chronologity/timeline-derivation` produces, so cursors stay interoperable with the API's.
- `src/caching/` is **reserved and empty**, and 9I decided it should stay that way rather than leaving it to be read as unfinished work. The four files this tree once named have nowhere to live: `request-cache.ts` already exists twice under better names (`RequestEligibility`, and `src/loaders/`), `cache.ts` and `cache-key.ts` would key nothing, and `timeline-cache.ts` is the one thing this service cannot hold correctly — every Timeline read is a function of five Viewer facts, so a key that distinguished two answers would *be* the Viewer. **The existence of this directory never implied Redis, and its emptiness is now a decision rather than a gap** (ADR-147).
- `src/auth/` owns request identity/permission interpretation sufficient for read authorization, not session creation.
- `src/observability/` owns read-service instrumentation, and as of 9K it holds something: `logger.ts` for structured logs, `tracing.ts` for the composition-stage spans `feed.md:1303-1308` names, and `metrics.ts` for the six instruments carrying the thirteen signals `observability.md:687` asks for. OpenTelemetry, because ADR-046 chose it; **instrumented by hand rather than automatically**, because automatic instrumentation of Fastify produces exactly the one opaque resolver span `feed.md:1311` forbids (ADR-149). `query-timing.ts` is not built — timing is a span and an instrument, and a third place to record it would be a third thing to keep consistent.
- `src/plugins/rate-limit.plugin.ts` is not in the tree above and is now in the application. It is registered inside the GraphQL scope and **after** authentication, which is the whole configuration: the limiter keys on the reader rather than on the address, and there is no reader before authentication has run (ADR-150).
- `src/graphql/cost/` is likewise new: the measured weight table and the validation rule that refuses a document costing more than the ceiling. Depth bounds how far down a document reaches and this bounds how much it asks for; the two are different questions and neither implies the other.
- `src/server/` owns application construction, process startup, and the health surface. Liveness and readiness live here rather than in a feature module, because unlike the API the aggregator has no features that own routes: the only HTTP surfaces are GraphQL and health.

The GraphQL server is Mercurius, registered inside an encapsulated scope so that its error handler and the authentication hook cover the GraphQL routes alone (ADR-136). The SDL under `src/graphql/schema/` is carried into `dist` by `scripts/copy-schema.mjs`, because the compiler does not copy files it cannot compile.

The aggregator deliberately does **not** own:

```text
services that mutate authoritative state/
projection writers/
authoritative Postgres repositories/
outbox writers/
authentication/session creation/
state-mutating workflows/
```

Applications must never work around this boundary by importing API implementation into the aggregator.

---

# Shared Packages

## `packages/contracts`

`packages/contracts` is the central cross-runtime contract package and the most important shared package in the monorepo.

It should contain canonical serialized boundary definitions such as:

- command DTOs where shared across a boundary;
- Integration Event schemas where shared;
- validation schemas;
- API request and response contracts;
- shared query response contracts;
- stable error codes;
- identifiers/types whose serialized representation is part of a boundary.

It should **not** contain repositories, Fastify handlers, ClickHouse adapters, React components, or application services.

## `packages/api-client`

Contains the typed REST client used primarily by `apps/mobile` and, where appropriate, `apps/web`.

It encapsulates API transport contracts without importing API implementation.

```text
packages/api-client/
├── src/
│   ├── api-error.ts        the API's stable envelope, as a thrown error
│   ├── client.ts           one request: headers, timeout, parse, retry loop
│   ├── query.ts            a request object as a query string
│   ├── retry.ts            what may be retried, and when
│   ├── session.ts          holding credentials and refreshing them
│   ├── uploads.ts          the presigned PUT, which does not go through the API
│   ├── operations/
│   │   ├── operation.ts    a descriptor a test can read, not a plain function
│   │   ├── <feature>.ts    one module per API feature, fifteen of them
│   │   ├── coverage.test.ts  every documented route has a way to call it
│   │   └── index.ts        the fifteen, as namespaces
│   ├── fixtures/
│   │   ├── responses/      recorded bodies, frozen on purpose
│   │   └── compatibility.test.ts
│   └── index.ts
```

**It owns transport, never types.** The request and response shapes come from
`packages/contracts`, which the client imports and parses against — the same
schemas that validate the request and serialise the response on the API side, so
a client operation is parsing the very object that produced the bytes. Restating
a shape here would be a second source of truth for something ADR-070 settled.

**Its operations are written rather than generated**, against those contracts,
with the committed OpenAPI document used as an inventory: a test fails when a
documented operation has no client method and no recorded reason (ADR-152).

**An operation is a descriptor rather than a function.** It carries its own
method, path template, and whether it sends a body or a query, so the
completeness check can read the whole set and reconcile it against the document
in both directions — a route with no operation and an operation naming a route
the API no longer serves fail alike. A hundred and sixty-three plain functions
would be a hundred and sixty-three things no test can see (ADR-154).

`src/fixtures/` holds responses recorded once and parsed through the operations
as the contracts stand now, which is the compatibility rule `deployment.md:766`
states expressed as a test: a field added is fine, a field removed or narrowed is
not. They are hand-recorded rather than built from the schemas, because a fixture
generated from the thing it checks agrees with it by construction.

`src/uploads.ts` is the one thing here that is not an API call. Media goes
straight to object storage (ADR-029), so the middle step of the upload flow has
no other home — and it must send no `Authorization` header, because the
signature in the URL is the authority (ADR-153).

## `packages/timeline-derivation`

Contains what the two applications that derive Timelines must agree about: the eligibility rule deciding which Moments a Viewer may be shown, the cursor format together with the keyset condition and ordering that read it back, the translation from a View Specification into filters, and the row shape and projection version.

**It computes and never connects.** It holds SQL text and pure functions, takes no client and opens no socket; each application supplies its own connection and runs what it returns. That is what makes it neutral between them, and it is deliberately not neutral between datastores — the projection is ClickHouse, and an abstraction over that would be one nobody needs.

It exists because these are the things that must not be written twice. A security rule written in two places eventually disagrees with itself, and two cursor implementations that drift skip and repeat Moments sharing an occurrence time (ADR-138).

It does not contain either application's query methods. Their needs differ — the API returns REST pages, the aggregator builds connections — and sharing the execution layer would force one shape on both.

## `packages/moment-access`

Contains what the two applications that read a Moment must agree about: whether a Viewer may see it, whether they may read a comment on it, and how much of where it happened they are told.

**It computes and never connects**, exactly as its Timeline sibling does. The difference between them is the store rather than the style: this holds PostgreSQL predicates over the authoritative tables, and `timeline-derivation` holds a ClickHouse condition over the projection. They are separate packages because they are separate statements over separate stores, and one name over both would be a name for something that is not one thing.

It emits **no placeholder syntax of its own**. The API binds by name through TypeORM and the aggregator binds by position through `pg`, so the caller supplies the tokens and neither dialect is privileged — a flag inside the package cannot work, because positional numbering depends on the surrounding statement the package cannot see (ADR-142).

The two halves of the Moment rule are exported separately as well as together, and that is load-bearing rather than tidy: reading a relationship applies privacy to the far end as a filter and moderation as a selected column, because privacy withholding it means the claim must not be mentioned at all while moderation withholding it leaves a tombstone. A reader that conflated them would announce that somebody's private history exists.

It exists for the reason ADR-138 gives about its sibling: a security rule written in two places eventually disagrees with itself, and this is one of the two that leaks when it does.

## `packages/config`

Contains genuinely shared configuration primitives. Application-specific configuration remains inside the owning application.

## `packages/eslint-config`

Contains shared ESLint rules/configuration.

## `packages/tsconfig`

Contains shared TypeScript configuration presets.

## Shared-package rule

A package should exist only when it has a genuine cross-application or repository-wide responsibility.

The monorepo must not accumulate generic packages simply because code can technically be shared.

---

# Dependency Rules

The canonical application dependency rule is:

```text
apps/api
    ✓ → packages/*

apps/feed-aggregator
    ✓ → packages/*

apps/mobile
    ✓ → packages/*

apps/web
    ✓ → packages/*

apps/api
    ✗ → apps/feed-aggregator
    ✗ → apps/mobile
    ✗ → apps/web

apps/feed-aggregator
    ✗ → apps/api
    ✗ → apps/mobile
    ✗ → apps/web

apps/mobile
    ✗ → apps/api implementation
    ✗ → apps/feed-aggregator implementation
    ✗ → apps/web implementation

apps/web
    ✗ → apps/api implementation
    ✗ → apps/feed-aggregator implementation
    ✗ → apps/mobile implementation
```

Cross-application communication occurs through contracts:

```text
Mobile
   ├── REST ───────→ API
   └── GraphQL ────→ Feed Aggregator

Web
   └── limited HTTP/API access where required

API
   └── authoritative events / projection flows

Feed Aggregator
   └── ClickHouse read queries
```

---

# Repository Conventions

## Naming

Directories and filenames should use kebab-case unless a framework or platform imposes another convention.

Examples:

```text
get-timeline-slice.query.ts
moment-depth-view.tsx
request-context.plugin.ts
```

React component identifiers may remain PascalCase inside the file even when filenames are kebab-case.

## Feature-first organization

Where an application contains meaningful domain or user-facing features, related code should remain grouped by feature/capability rather than spread across repository-wide controller/service/repository buckets.

## Colocated tests

Unit tests should remain adjacent to implementation files:

```text
moment.policy.ts
moment.policy.test.ts

moment.repository.ts
moment.repository.test.ts
```

A small application-level integration/e2e suite may be introduced separately when justified, but it does not replace colocated unit tests.

## Barrel files

Barrel files should be avoided by default.

An `index.ts` should exist only when it serves a deliberate application/feature/package public entry point. Do not create nested barrel hierarchies merely to shorten import paths.

## Alphabetical ordering

Within comparable groups, files and directories should be kept alphabetically ordered when doing so does not obscure architectural meaning.

## Explicit ownership

Every file should have one clear application or shared-package owner.

If code seems to belong equally to two applications, first ask whether the shared element is actually a contract. Do not use shared packages to conceal ambiguous ownership.

---

# No Separate Admin Application

Chronologity intentionally has no `apps/admin/`.

Administrative functionality is a capability of the consumer product, not a separate source of authority.

The intended pattern is:

```text
Authorized mobile interface
        ↓
API command
        ↓
backend authentication + role/permission check
        ↓
authoritative domain/moderation action
```

A client-side role check may hide or expose UI, but it is never sufficient authorization.

If future operational tooling requires a non-consumer internal interface, that would be a new architecture decision and should not be inferred from today's moderation/admin capabilities.

---

# Current Canonical Structure

The directory trees in this document represent the current intended Chronologity implementation. Superseded product concepts are removed from the trees rather than retained as historical artifacts.

The finalized product specifications govern the structure. In particular, Moments do not form recursive parent/child hierarchies, Sub-Moments are not part of the product model, and a Moment may contain an unlimited number of media items through bounded technical operations.

The API includes a dedicated `features/authorization/` module that owns role assignment, permission policy, authorization read state, and privileged role-management boundaries. Scene-detection integration has been removed because it has no remaining product responsibility.

`features/timelines/` owns no service that writes and no routes that mutate. The Timeline is derived, so there is nothing to create, rename, archive, or delete: the module exists to maintain the read models that Timeline navigation is composed from, and its absence of a write side is deliberate rather than an omission (ADR-084). The current `feed-aggregator` repository name remains unchanged until an explicit rename decision is made.

# Adding New Applications

A new application under `apps/` requires a concrete runtime boundary, such as:

- materially different scaling behavior;
- independent failure isolation;
- a distinct security/trust boundary;
- incompatible technology requirements;
- independent deployment ownership;
- or another durable architectural reason.

Do not create a new application merely because a feature is large.

Most product capabilities should begin as modules inside an existing owning application.

---

# Adding New Shared Packages

A new package under `packages/` should satisfy at least one of these criteria:

- it defines a genuine cross-application serialized contract;
- it provides repository-wide tooling/configuration;
- it contains implementation-neutral code genuinely required by multiple deployable applications and whose ownership is not application-specific.

Avoid generic `utils`, `common`, `shared`, or `core` packages that accumulate unrelated code.

If a utility has one application owner, keep it inside that application.

---

# Adding New API Features

New authoritative domain capabilities should generally be added under:

```text
apps/api/src/features/<feature>/
```

with only the subdirectories the feature actually needs.

Do not scaffold every file in the template mechanically when the feature does not need it.

A feature may have:

```text
<feature>.routes.ts
<feature>.service.ts
<feature>.repository.ts
<feature>.model.ts
<feature>.policy.ts
<feature>.types.ts
<feature>.schemas.ts
```

but structure should follow actual behavior rather than ceremony. `features/health/` is a single routes file, and that is correct.

---

# Adding New Aggregator Capabilities

New read capabilities should be organized around composition/query responsibilities rather than duplicating API domain modules.

The aggregator must remain:

```text
read-only
GraphQL-facing
ClickHouse/read-model-oriented
request-aware
composition-focused
```

If a proposed aggregator module needs to issue commands or mutate authoritative data, it belongs elsewhere.

---

# Adding New Mobile Features

New mobile features should generally live under:

```text
apps/mobile/src/features/<feature>/
```

with shared presentation promoted to `components/` only when genuinely reusable across features.

Backend business logic must not be copied into view models merely to avoid an API call.

---

# Adding New Web Features

The web application should remain lightweight relative to mobile.

New functionality belongs there when it is naturally part of:

- public marketing;
- editorial content;
- SEO;
- public informational pages;
- public acquisition/forms;
- another explicitly approved public-web concern.

A full consumer Timeline implementation should not appear in Gatsby incidentally.

---

# Architectural Invariants

1. Chronologity has four canonical applications: `api`, `feed-aggregator`, `mobile`, and `web`.
2. There is no separate admin application.
3. Administrative authority is enforced by backend role-based authorization.
4. Applications may depend on shared packages but may not import another application's implementation.
5. `packages/contracts` is the principal cross-application contract boundary.
6. The API is authoritative for domain mutations.
7. The feed aggregator is read-only.
8. The feed aggregator consumes read models; it does not own authoritative projections or write to authoritative state.
9. The mobile app intentionally consumes both REST and GraphQL.
10. The Gatsby web application is not the primary consumer product.
11. Tests are colocated with implementation by default.
12. Filenames use kebab-case unless framework constraints require otherwise.
13. Barrel files are avoided unless they define an intentional public boundary.
14. Feature-first organization is preferred over repository-wide technical-layer buckets.
15. Shared packages must represent genuine shared ownership rather than convenience.
16. A Moment's unlimited media semantics must not be replaced by a structural media-count limit.
17. Recursive Sub-Moment hierarchies are prohibited by the finalized product model and must not appear in the canonical repository structure.
18. The Timeline has no write side; `features/timelines/` owns Timeline read models, and read composition belongs to `apps/feed-aggregator`.
19. `feed-aggregator` remains the canonical repository name until explicitly renamed.
20. New applications and datastores require architectural justification rather than stylistic preference.

---

# Canonicality and Change Management

This document records the current canonical Chronologity monorepo structure and the architectural rules governing it.

When the canonical tree is intentionally amended, this document should be updated in the same change.

Do not allow implementation and documentation to drift apart.

A structural change that alters application boundaries, product-domain boundaries, or shared-package ownership should be treated as an architecture change and documented explicitly.

## Guiding Principle

When deciding where code belongs, ask:

> **Which application or package genuinely owns this responsibility, and can we place it there without weakening Chronologity's runtime boundaries or finalized product semantics?**

The monorepo should make Chronologity easier to reason about.

It should never make architectural boundaries optional.
