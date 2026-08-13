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
│   ├── eventstore/
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
└── tsconfig/
```

### `docs/`

Contains the required product and architecture specifications plus the documentation index and glossary. `docs/README.md` governs the canonical documentation inventory. Additional focused documentation areas may be introduced alongside implementation when a concrete need exists, but they are not part of the required preimplementation repository structure.

### `scripts/`

Contains repository-level generators and automation that operate across applications or packages.

### `docker/`

Contains local infrastructure configuration for ClickHouse, EventStoreDB, and PostgreSQL.

### Root configuration

The root pnpm workspace, TypeScript configuration, package manifest, lockfile, and repository README coordinate the monorepo as a whole.

---

# Application Boundaries

## `apps/api`

`apps/api` is the authoritative Fastify + TypeScript backend.

It owns command processing, domain invariants, authorization, authentication workflows, event-sourced aggregates where applicable, authoritative domain events, operational REST queries, uploads, notifications, moderation decisions, and projection definitions/update logic.

It is feature-oriented rather than controller/service-oriented.

The canonical structural baseline is:

```text
apps/
└── api/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── README.md
    ├── scripts/
    │   ├── scaffold-api.sh
    │   ├── generate-feature.sh
    │   └── generate-command.sh
    └── src/
        ├── index.ts
        ├── server/
        │   ├── app.ts
        │   ├── server.ts
        │   ├── register-routes.ts
        │   └── register-plugins.ts
        ├── config/
        │   ├── env.ts
        │   ├── app-config.ts
        │   ├── auth-config.ts
        │   ├── database-config.ts
        │   └── eventstore-config.ts
        ├── plugins/
        │   ├── auth.plugin.ts
        │   ├── cors.plugin.ts
        │   ├── helmet.plugin.ts
        │   ├── metrics.plugin.ts
        │   ├── request-context.plugin.ts
        │   ├── swagger.plugin.ts
        │   └── validation.plugin.ts
        ├── lib/
        │   ├── database/
        │   │   ├── postgres.ts
        │   │   └── clickhouse.ts
        │   ├── eventstore/
        │   │   ├── client.ts
        │   │   ├── append-events.ts
        │   │   ├── read-stream.ts
        │   │   ├── subscribe.ts
        │   │   └── stream-name.ts
        │   ├── logger/
        │   │   └── logger.ts
        │   ├── errors/
        │   │   ├── domain-error.ts
        │   │   ├── not-found-error.ts
        │   │   ├── unauthorized-error.ts
        │   │   └── validation-error.ts
        │   ├── ids/
        │   │   ├── generate-id.ts
        │   │   └── generate-trace-id.ts
        │   └── time/
        │       ├── now.ts
        │       └── timestamp.ts
        ├── types/
        │   ├── command.ts
        │   ├── domain-event.ts
        │   ├── request-context.ts
        │   └── projection.ts
        ├── integrations/
        │   ├── email/
        │   │   └── email-client.ts
        │   ├── push/
        │   │   └── push-client.ts
        │   ├── storage/
        │   │   ├── storage-client.ts
        │   │   ├── generate-upload-url.ts
        │   │   └── delete-object.ts
        │   ├── transcoder/
        │   │   └── transcoder-client.ts
        │   ├── metadata/
        │   │   └── metadata-client.ts
        │   └── projection-writer/
        │       └── projection-writer-client.ts
        ├── workflows/
        │   ├── uploads/
        │   │   ├── process-upload.workflow.ts
        │   │   ├── finalize-upload.workflow.ts
        │   │   └── delete-upload.workflow.ts
        │   ├── moments/
        │   │   ├── create-moment.workflow.ts
        │   │   └── finalize-moment.workflow.ts
        │   ├── auth/
        │   │   ├── magic-link-login.workflow.ts
        │   │   └── revoke-user-sessions.workflow.ts
        │   ├── notifications/
        │   │   └── deliver-notification.workflow.ts
        │   └── moderation/
        │       ├── remove-content.workflow.ts
        │       └── suspend-user.workflow.ts
        └── features/
            ├── auth/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── identity.aggregate.ts
            │   │   ├── identity.aggregate.test.ts
            │   │   ├── session.aggregate.ts
            │   │   └── session.aggregate.test.ts
            │   ├── commands/
            │   │   ├── create-identity.command.ts
            │   │   ├── create-identity.handler.ts
            │   │   ├── create-identity.handler.test.ts
            │   │   ├── add-email-to-identity.command.ts
            │   │   ├── add-email-to-identity.handler.ts
            │   │   ├── add-email-to-identity.handler.test.ts
            │   │   ├── verify-identity-email.command.ts
            │   │   ├── verify-identity-email.handler.ts
            │   │   ├── verify-identity-email.handler.test.ts
            │   │   ├── remove-email-from-identity.command.ts
            │   │   ├── remove-email-from-identity.handler.ts
            │   │   ├── remove-email-from-identity.handler.test.ts
            │   │   ├── link-oauth-provider.command.ts
            │   │   ├── link-oauth-provider.handler.ts
            │   │   ├── unlink-oauth-provider.command.ts
            │   │   ├── unlink-oauth-provider.handler.ts
            │   │   ├── enable-two-factor-auth.command.ts
            │   │   ├── enable-two-factor-auth.handler.ts
            │   │   ├── disable-two-factor-auth.command.ts
            │   │   ├── disable-two-factor-auth.handler.ts
            │   │   ├── create-session.command.ts
            │   │   ├── create-session.handler.ts
            │   │   ├── refresh-session.command.ts
            │   │   ├── refresh-session.handler.ts
            │   │   ├── revoke-session.command.ts
            │   │   ├── revoke-session.handler.ts
            │   │   ├── expire-session.command.ts
            │   │   ├── expire-session.handler.ts
            │   │   ├── revoke-all-user-sessions.command.ts
            │   │   └── revoke-all-user-sessions.handler.ts
            │   ├── events/
            │   │   ├── identity-created.event.ts
            │   │   ├── email-added.event.ts
            │   │   ├── email-verified.event.ts
            │   │   ├── email-removed.event.ts
            │   │   ├── oauth-linked.event.ts
            │   │   ├── oauth-unlinked.event.ts
            │   │   ├── two-factor-enabled.event.ts
            │   │   ├── two-factor-disabled.event.ts
            │   │   ├── session-created.event.ts
            │   │   ├── session-refreshed.event.ts
            │   │   ├── session-revoked.event.ts
            │   │   └── session-expired.event.ts
            │   ├── event-handlers/
            │   │   ├── session-created.handler.ts
            │   │   ├── session-revoked.handler.ts
            │   │   ├── identity-created.handler.ts
            │   │   └── session-expired.handler.ts
            │   ├── projections/
            │   │   ├── identity.projection.ts
            │   │   ├── session.projection.ts
            │   │   └── auth-read-model.projection.ts
            │   ├── queries/
            │   │   ├── get-session.query.ts
            │   │   ├── get-session.handler.ts
            │   │   ├── get-session.handler.test.ts
            │   │   ├── get-sessions-for-user.query.ts
            │   │   ├── get-sessions-for-user.handler.ts
            │   │   ├── get-auth-providers-for-user.query.ts
            │   │   ├── get-auth-providers-for-user.handler.ts
            │   │   ├── get-two-factor-status.query.ts
            │   │   ├── get-two-factor-status.handler.ts
            │   │   ├── validate-session.query.ts
            │   │   └── validate-session.handler.ts
            │   ├── routes/
            │   │   ├── auth.routes.ts
            │   │   └── auth.routes.test.ts
            │   ├── schemas/
            │   │   ├── create-session.schema.ts
            │   │   ├── magic-link.schema.ts
            │   │   ├── oauth.schema.ts
            │   │   └── session.schema.ts
            │   └── utils/
            │       ├── auth-stream-name.ts
            │       └── normalize-email.ts
            ├── authorization/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── user-authorization.aggregate.ts
            │   │   └── user-authorization.aggregate.test.ts
            │   ├── commands/
            │   │   ├── assign-user-role.command.ts
            │   │   ├── assign-user-role.handler.ts
            │   │   ├── assign-user-role.handler.test.ts
            │   │   ├── remove-user-role.command.ts
            │   │   ├── remove-user-role.handler.ts
            │   │   └── remove-user-role.handler.test.ts
            │   ├── events/
            │   │   ├── user-role-assigned.event.ts
            │   │   └── user-role-removed.event.ts
            │   ├── event-handlers/
            │   │   ├── user-role-assigned.handler.ts
            │   │   └── user-role-removed.handler.ts
            │   ├── projections/
            │   │   └── user-authorization.projection.ts
            │   ├── queries/
            │   │   ├── get-user-authorization.query.ts
            │   │   ├── get-user-authorization.handler.ts
            │   │   ├── get-user-authorization.handler.test.ts
            │   │   ├── get-current-user-permissions.query.ts
            │   │   ├── get-current-user-permissions.handler.ts
            │   │   └── get-current-user-permissions.handler.test.ts
            │   ├── policies/
            │   │   ├── authorization-policy.ts
            │   │   ├── authorization-policy.test.ts
            │   │   ├── permission-registry.ts
            │   │   ├── role-permissions.ts
            │   │   └── role-permissions.test.ts
            │   ├── routes/
            │   │   ├── authorization.routes.ts
            │   │   └── authorization.routes.test.ts
            │   ├── schemas/
            │   │   ├── assign-user-role.schema.ts
            │   │   ├── remove-user-role.schema.ts
            │   │   └── authorization.schema.ts
            │   └── utils/
            │       └── authorization-stream-name.ts
            ├── users/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── user.aggregate.ts
            │   │   └── user.aggregate.test.ts
            │   ├── commands/
            │   │   ├── create-user.command.ts
            │   │   ├── create-user.handler.ts
            │   │   ├── update-user-profile.command.ts
            │   │   ├── update-user-profile.handler.ts
            │   │   ├── update-username.command.ts
            │   │   ├── update-username.handler.ts
            │   │   ├── add-user-email.command.ts
            │   │   ├── add-user-email.handler.ts
            │   │   ├── remove-user-email.command.ts
            │   │   ├── remove-user-email.handler.ts
            │   │   ├── deactivate-user.command.ts
            │   │   ├── deactivate-user.handler.ts
            │   │   ├── reactivate-user.command.ts
            │   │   ├── reactivate-user.handler.ts
            │   │   ├── delete-user.command.ts
            │   │   └── delete-user.handler.ts
            │   ├── events/
            │   │   ├── user-created.event.ts
            │   │   ├── user-profile-updated.event.ts
            │   │   ├── user-username-updated.event.ts
            │   │   ├── user-email-added.event.ts
            │   │   ├── user-email-removed.event.ts
            │   │   ├── user-deactivated.event.ts
            │   │   ├── user-reactivated.event.ts
            │   │   └── user-deleted.event.ts
            │   ├── event-handlers/
            │   │   ├── user-created.handler.ts
            │   │   ├── user-deactivated.handler.ts
            │   │   └── user-deleted.handler.ts
            │   ├── projections/
            │   │   ├── user-profile.projection.ts
            │   │   └── user-status.projection.ts
            │   ├── queries/
            │   │   ├── get-user-by-id.query.ts
            │   │   ├── get-user-by-id.handler.ts
            │   │   ├── get-user-by-username.query.ts
            │   │   ├── get-user-by-username.handler.ts
            │   │   ├── get-user-profile.query.ts
            │   │   ├── get-user-profile.handler.ts
            │   │   ├── get-current-user.query.ts
            │   │   ├── get-current-user.handler.ts
            │   │   ├── get-user-preferences.query.ts
            │   │   ├── get-user-preferences.handler.ts
            │   │   ├── get-user-emails.query.ts
            │   │   ├── get-user-emails.handler.ts
            │   │   ├── get-user-status.query.ts
            │   │   └── get-user-status.handler.ts
            │   ├── routes/
            │   │   └── users.routes.ts
            │   ├── schemas/
            │   │   ├── user-profile.schema.ts
            │   │   └── username.schema.ts
            │   └── utils/
            │       └── normalize-username.ts
            ├── uploads/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── upload.aggregate.ts
            │   │   └── upload.aggregate.test.ts
            │   ├── commands/
            │   │   ├── register-upload.command.ts
            │   │   ├── register-upload.handler.ts
            │   │   ├── mark-upload-received.command.ts
            │   │   ├── mark-upload-received.handler.ts
            │   │   ├── attach-upload-metadata.command.ts
            │   │   ├── attach-upload-metadata.handler.ts
            │   │   ├── start-upload-processing.command.ts
            │   │   ├── start-upload-processing.handler.ts
            │   │   ├── mark-upload-processed.command.ts
            │   │   ├── mark-upload-processed.handler.ts
            │   │   ├── finalize-upload.command.ts
            │   │   ├── finalize-upload.handler.ts
            │   │   ├── fail-upload.command.ts
            │   │   ├── fail-upload.handler.ts
            │   │   ├── retry-upload-processing.command.ts
            │   │   ├── retry-upload-processing.handler.ts
            │   │   ├── delete-upload.command.ts
            │   │   └── delete-upload.handler.ts
            │   ├── events/
            │   │   ├── upload-registered.event.ts
            │   │   ├── upload-received.event.ts
            │   │   ├── upload-metadata-attached.event.ts
            │   │   ├── upload-processing-started.event.ts
            │   │   ├── upload-processed.event.ts
            │   │   ├── upload-finalized.event.ts
            │   │   ├── upload-failed.event.ts
            │   │   └── upload-deleted.event.ts
            │   ├── event-handlers/
            │   │   ├── upload-registered.handler.ts
            │   │   ├── upload-received.handler.ts
            │   │   ├── upload-finalized.handler.ts
            │   │   └── upload-deleted.handler.ts
            │   ├── projections/
            │   │   ├── upload-status.projection.ts
            │   │   ├── upload-metadata.projection.ts
            │   │   └── upload-read-model.projection.ts
            │   ├── queries/
            │   │   ├── get-upload-by-id.query.ts
            │   │   ├── get-upload-by-id.handler.ts
            │   │   ├── get-uploads-for-user.query.ts
            │   │   ├── get-uploads-for-user.handler.ts
            │   │   ├── get-upload-status.query.ts
            │   │   ├── get-upload-status.handler.ts
            │   │   ├── get-upload-metadata.query.ts
            │   │   ├── get-upload-metadata.handler.ts
            │   │   ├── get-upload-processing-errors.query.ts
            │   │   └── get-upload-processing-errors.handler.ts
            │   ├── routes/
            │   │   └── uploads.routes.ts
            │   ├── schemas/
            │   │   ├── register-upload.schema.ts
            │   │   └── upload.schema.ts
            │   └── utils/
            │       └── infer-media-kind.ts
            ├── moments/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── moment.aggregate.ts
            │   │   └── moment.aggregate.test.ts
            │   ├── commands/
            │   │   ├── create-moment.command.ts
            │   │   ├── create-moment.handler.ts
            │   │   ├── update-moment-metadata.command.ts
            │   │   ├── update-moment-metadata.handler.ts
            │   │   ├── finalize-moment.command.ts
            │   │   ├── finalize-moment.handler.ts
            │   │   ├── delete-moment.command.ts
            │   │   ├── delete-moment.handler.ts
            │   │   ├── restore-moment.command.ts
            │   │   ├── restore-moment.handler.ts
            │   │   ├── flag-moment.command.ts
            │   │   └── flag-moment.handler.ts
            │   ├── events/
            │   │   ├── moment-created.event.ts
            │   │   ├── moment-metadata-updated.event.ts
            │   │   ├── moment-finalized.event.ts
            │   │   ├── moment-deleted.event.ts
            │   │   ├── moment-restored.event.ts
            │   │   └── moment-flagged.event.ts
            │   ├── event-handlers/
            │   │   ├── moment-created.handler.ts
            │   │   ├── moment-finalized.handler.ts
            │   │   ├── moment-deleted.handler.ts
            │   │   └── moment-restored.handler.ts
            │   ├── projections/
            │   │   ├── moment-read-model.projection.ts
            │   │   ├── timeline-by-time.projection.ts
            │   │   ├── timeline-by-location.projection.ts
            │   │   └── timeline-by-user.projection.ts
            │   ├── queries/
            │   │   ├── get-moment-by-id.query.ts
            │   │   ├── get-moment-by-id.handler.ts
            │   │   ├── get-moments-for-upload.query.ts
            │   │   ├── get-moments-for-upload.handler.ts
            │   │   ├── get-moment-metadata.query.ts
            │   │   ├── get-moment-metadata.handler.ts
            │   │   ├── get-moment-status.query.ts
            │   │   ├── get-moment-status.handler.ts
            │   │   ├── get-moments-by-time-range.query.ts
            │   │   ├── get-moments-by-time-range.handler.ts
            │   │   ├── get-moments-by-user.query.ts
            │   │   └── get-moments-by-user.handler.ts
            │   ├── routes/
            │   │   └── moments.routes.ts
            │   ├── schemas/
            │   │   ├── moment.schema.ts
            │   │   ├── create-moment.schema.ts
            │   └── utils/
            │       ├── validate-time-range.ts
            │       └── overlap.ts
            ├── reactions/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── reaction.aggregate.ts
            │   │   └── reaction.aggregate.test.ts
            │   ├── commands/
            │   │   ├── add-reaction.command.ts
            │   │   ├── add-reaction.handler.ts
            │   │   ├── change-reaction.command.ts
            │   │   ├── change-reaction.handler.ts
            │   │   ├── remove-reaction.command.ts
            │   │   ├── remove-reaction.handler.ts
            │   │   ├── clear-reactions-for-moment.command.ts
            │   │   ├── clear-reactions-for-moment.handler.ts
            │   │   ├── clear-reactions-for-user.command.ts
            │   │   └── clear-reactions-for-user.handler.ts
            │   ├── events/
            │   │   ├── reaction-added.event.ts
            │   │   ├── reaction-changed.event.ts
            │   │   ├── reaction-removed.event.ts
            │   │   ├── reaction-cleared-for-moment.event.ts
            │   │   └── reaction-cleared-for-user.event.ts
            │   ├── event-handlers/
            │   │   ├── reaction-added.handler.ts
            │   │   ├── reaction-changed.handler.ts
            │   │   ├── reaction-removed.handler.ts
            │   │   └── reaction-cleared.handler.ts
            │   ├── projections/
            │   │   ├── reaction-summary.projection.ts
            │   │   ├── user-reaction.projection.ts
            │   │   └── moment-reaction-counts.projection.ts
            │   ├── queries/
            │   │   ├── get-reactions-for-moment.query.ts
            │   │   ├── get-reactions-for-moment.handler.ts
            │   │   ├── get-reaction-summary-for-moment.query.ts
            │   │   ├── get-reaction-summary-for-moment.handler.ts
            │   │   ├── get-user-reaction-for-moment.query.ts
            │   │   ├── get-user-reaction-for-moment.handler.ts
            │   │   ├── get-reactions-by-user.query.ts
            │   │   └── get-reactions-by-user.handler.ts
            │   ├── routes/
            │   │   └── reactions.routes.ts
            │   ├── schemas/
            │   │   └── reaction.schema.ts
            │   └── utils/
            │       └── normalize-reaction-type.ts
            ├── timelines/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── timeline.aggregate.ts
            │   │   └── timeline.aggregate.test.ts
            │   ├── commands/
            │   │   ├── create-timeline.command.ts
            │   │   ├── create-timeline.handler.ts
            │   │   ├── update-timeline-definition.command.ts
            │   │   ├── update-timeline-definition.handler.ts
            │   │   ├── archive-timeline.command.ts
            │   │   ├── archive-timeline.handler.ts
            │   │   ├── restore-timeline.command.ts
            │   │   ├── restore-timeline.handler.ts
            │   │   ├── delete-timeline.command.ts
            │   │   └── delete-timeline.handler.ts
            │   ├── events/
            │   │   ├── timeline-created.event.ts
            │   │   ├── timeline-definition-updated.event.ts
            │   │   ├── timeline-archived.event.ts
            │   │   ├── timeline-restored.event.ts
            │   │   └── timeline-deleted.event.ts
            │   ├── event-handlers/
            │   │   ├── timeline-created.handler.ts
            │   │   ├── timeline-definition-updated.handler.ts
            │   │   └── timeline-deleted.handler.ts
            │   ├── projections/
            │   │   ├── timeline-definition.projection.ts
            │   │   ├── timeline-scope.projection.ts
            │   │   ├── timeline-head.projection.ts
            │   │   ├── timeline-slice.projection.ts
            │   │   ├── timeline-by-tag.projection.ts
            │   │   ├── timeline-by-network.projection.ts
            │   │   └── timeline-stats.projection.ts
            │   ├── queries/
            │   │   ├── get-timeline-by-id.query.ts
            │   │   ├── get-timeline-by-id.handler.ts
            │   │   ├── get-timeline-head.query.ts
            │   │   ├── get-timeline-head.handler.ts
            │   │   ├── get-timeline-slice.query.ts
            │   │   ├── get-timeline-slice.handler.ts
            │   │   ├── get-timeline-around-moment.query.ts
            │   │   ├── get-timeline-around-moment.handler.ts
            │   │   ├── get-timeline-by-location.query.ts
            │   │   ├── get-timeline-by-location.handler.ts
            │   │   ├── get-timeline-by-user.query.ts
            │   │   ├── get-timeline-by-user.handler.ts
            │   │   ├── get-timeline-by-tag.query.ts
            │   │   ├── get-timeline-by-tag.handler.ts
            │   │   ├── get-timeline-by-network.query.ts
            │   │   ├── get-timeline-by-network.handler.ts
            │   │   ├── get-timeline-stats.query.ts
            │   │   └── get-timeline-stats.handler.ts
            │   ├── routes/
            │   │   └── timelines.routes.ts
            │   ├── schemas/
            │   │   ├── timeline.schema.ts
            │   │   └── timeline-slice.schema.ts
            │   └── utils/
            │       ├── encode-cursor.ts
            │       └── decode-cursor.ts
            ├── notifications/
            │   ├── index.ts
            │   ├── aggregates/
            │   │   ├── notification.aggregate.ts
            │   │   └── notification.aggregate.test.ts
            │   ├── commands/
            │   │   ├── create-notification.command.ts
            │   │   ├── create-notification.handler.ts
            │   │   ├── mark-notification-read.command.ts
            │   │   ├── mark-notification-read.handler.ts
            │   │   ├── mark-all-notifications-read.command.ts
            │   │   ├── mark-all-notifications-read.handler.ts
            │   │   ├── dismiss-notification.command.ts
            │   │   ├── dismiss-notification.handler.ts
            │   │   ├── delete-notification.command.ts
            │   │   └── delete-notification.handler.ts
            │   ├── events/
            │   │   ├── notification-created.event.ts
            │   │   ├── notification-read.event.ts
            │   │   ├── notification-dismissed.event.ts
            │   │   └── notification-deleted.event.ts
            │   ├── event-handlers/
            │   │   ├── notification-created.handler.ts
            │   │   └── notification-read.handler.ts
            │   ├── projections/
            │   │   ├── notification-inbox.projection.ts
            │   │   ├── unread-notification-count.projection.ts
            │   │   └── recent-notifications.projection.ts
            │   ├── queries/
            │   │   ├── get-notifications-for-user.query.ts
            │   │   ├── get-notifications-for-user.handler.ts
            │   │   ├── get-unread-notification-count.query.ts
            │   │   ├── get-unread-notification-count.handler.ts
            │   │   ├── get-notification-by-id.query.ts
            │   │   ├── get-notification-by-id.handler.ts
            │   │   ├── get-notification-preferences.query.ts
            │   │   ├── get-notification-preferences.handler.ts
            │   │   ├── get-recent-notifications.query.ts
            │   │   └── get-recent-notifications.handler.ts
            │   ├── routes/
            │   │   └── notifications.routes.ts
            │   ├── schemas/
            │   │   └── notification.schema.ts
            │   └── utils/
            │       └── notification-kind.ts
            └── moderation/
                ├── index.ts
                ├── aggregates/
                │   ├── moderation.aggregate.ts
                │   └── moderation.aggregate.test.ts
                ├── commands/
                │   ├── open-moderation-case.command.ts
                │   ├── open-moderation-case.handler.ts
                │   ├── review-moderation-case.command.ts
                │   ├── review-moderation-case.handler.ts
                │   ├── restrict-content.command.ts
                │   ├── restrict-content.handler.ts
                │   ├── remove-content.command.ts
                │   ├── remove-content.handler.ts
                │   ├── restore-content.command.ts
                │   ├── restore-content.handler.ts
                │   ├── escalate-moderation-case.command.ts
                │   ├── escalate-moderation-case.handler.ts
                │   ├── close-moderation-case.command.ts
                │   └── close-moderation-case.handler.ts
                ├── events/
                │   ├── moderation-case-opened.event.ts
                │   ├── moderation-case-reviewed.event.ts
                │   ├── moderation-content-restricted.event.ts
                │   ├── moderation-content-removed.event.ts
                │   ├── moderation-content-restored.event.ts
                │   ├── moderation-case-escalated.event.ts
                │   └── moderation-case-closed.event.ts
                ├── event-handlers/
                │   ├── moderation-content-restricted.handler.ts
                │   ├── moderation-content-removed.handler.ts
                │   ├── moderation-content-restored.handler.ts
                │   ├── moderation-case-opened.handler.ts
                │   └── moderation-case-closed.handler.ts
                ├── projections/
                │   ├── moderation-status.projection.ts
                │   ├── moderation-history.projection.ts
                │   └── open-moderation-flags.projection.ts
                ├── queries/
                │   ├── get-moderation-status-for-content.query.ts
                │   ├── get-moderation-status-for-content.handler.ts
                │   ├── get-moderation-status-for-user.query.ts
                │   ├── get-moderation-status-for-user.handler.ts
                │   ├── get-open-moderation-flags.query.ts
                │   ├── get-open-moderation-flags.handler.ts
                │   ├── get-moderation-history.query.ts
                │   ├── get-moderation-history.handler.ts
                │   ├── get-moderation-case-by-id.query.ts
                │   └── get-moderation-case-by-id.handler.ts
                ├── routes/
                │   └── moderation.routes.ts
                ├── schemas/
                │   └── moderation.schema.ts
                └── utils/
                    └── moderation-target.ts
```

### API placement rules

The major directory meanings are:

- `src/server/` owns Fastify composition and server startup.
- `src/config/` owns API-local configuration.
- `src/plugins/` owns Fastify plugins.
- `src/lib/` owns infrastructure-facing primitives used across API features.
- `src/integrations/` owns explicit external-system adapters.
- `src/workflows/` owns multi-step application workflows crossing feature/integration boundaries.
- `src/features/` owns domain/application behavior by feature.
- Within a feature, `aggregates/`, `commands/`, `events/`, `event-handlers/`, `projections/`, `queries/`, `routes/`, `schemas/`, and `utils/` remain colocated with that feature.
- Tests are colocated next to the implementation files they protect.

The API does not expose a global `controllers/` or `services/` layer as its primary architecture.

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

The Gatsby application should not acquire mobile-product domain aggregates, Timeline rendering engines, command handlers, or authoritative state.

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
        │   ├── server.ts
        │   ├── register-graphql.ts
        │   └── register-plugins.ts
        ├── config/
        │   ├── app-config.ts
        │   ├── clickhouse-config.ts
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
        │   └── types/
        │       ├── read-model.ts
        │       └── read-model-row.ts
        ├── loaders/
        │   ├── create-loaders.ts
        │   ├── moment.loader.ts
        │   ├── location.loader.ts
        │   ├── reaction-summary.loader.ts
        │   ├── user-summary.loader.ts
        │   └── moderation-visibility.loader.ts
        ├── pagination/
        │   ├── cursor.ts
        │   ├── encode-cursor.ts
        │   ├── decode-cursor.ts
        │   ├── cursor.test.ts
        │   ├── page-info.ts
        │   ├── connection.ts
        │   └── pagination-limit.ts
        ├── caching/
        │   ├── cache.ts
        │   ├── cache-key.ts
        │   ├── request-cache.ts
        │   └── timeline-cache.ts
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
- `src/moments/` owns Moment read composition.
- `src/locations/`, `src/reactions/`, `src/users/`, and `src/moderation/` own read/composition concerns for those domains.
- `src/read-models/clickhouse/` is the normal persistence adapter boundary.
- `src/loaders/` owns request-scoped batching and deduplication.
- `src/pagination/` owns opaque, deterministic cursor infrastructure.
- `src/caching/` owns read-side cache abstractions; the existence of this directory does not imply Redis.
- `src/auth/` owns request identity/permission interpretation sufficient for read authorization, not session creation.
- `src/observability/` owns read-service instrumentation.

The aggregator deliberately does **not** own:

```text
aggregates/
commands/
domain events/
event handlers that mutate authoritative state/
projection writers/
EventStoreDB clients/
authoritative Postgres repositories/
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
- Domain Event/integration event schemas where shared;
- validation schemas;
- API request and response contracts;
- shared query response contracts;
- stable error codes;
- identifiers/types whose serialized representation is part of a boundary.

It should **not** contain aggregate implementations, repositories, Fastify handlers, ClickHouse adapters, React components, or application services.

## `packages/api-client`

Contains the typed REST client used primarily by `apps/mobile` and, where appropriate, `apps/web`.

It encapsulates API transport contracts without importing API implementation.

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
moment.aggregate.ts
moment.aggregate.test.ts

get-timeline-slice.query.ts
get-timeline-slice.query.test.ts
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

Timeline lifecycle files remain subject to the finalized Timeline semantics: their presence must not be interpreted as making every Timeline an arbitrary user-created container. The current `feed-aggregator` repository name also remains unchanged until an explicit rename decision is made.

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

Do not scaffold every possible CQRS/Event Sourcing directory mechanically when the feature does not use it.

A feature may have:

```text
aggregates/
commands/
events/
event-handlers/
projections/
queries/
routes/
schemas/
utils/
```

but structure should follow actual behavior rather than ceremony.

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
8. The feed aggregator consumes read models; it does not own authoritative projections or EventStoreDB streams.
9. The mobile app intentionally consumes both REST and GraphQL.
10. The Gatsby web application is not the primary consumer product.
11. Tests are colocated with implementation by default.
12. Filenames use kebab-case unless framework constraints require otherwise.
13. Barrel files are avoided unless they define an intentional public boundary.
14. Feature-first organization is preferred over repository-wide technical-layer buckets.
15. Shared packages must represent genuine shared ownership rather than convenience.
16. A Moment's unlimited media semantics must not be replaced by a structural media-count limit.
17. Recursive Sub-Moment hierarchies are prohibited by the finalized product model and must not appear in the canonical repository structure.
18. Timeline CRUD/aggregate artifacts require semantic revalidation against the finalized derived-Timeline model.
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
