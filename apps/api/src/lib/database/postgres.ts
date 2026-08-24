import { DataSource } from "typeorm";
import type { DatabaseConfig } from "../../config/database-config.js";
import {
  Identity,
  IdentityEmail,
  IdentityPassword,
} from "../../features/authentication/identity.model.js";
import {
  AuthAuditEvent,
  MagicLinkToken,
  Session,
} from "../../features/authentication/session.model.js";
import { AuthorizationAuditEvent, RoleAssignment } from "../../features/authorization/authorization.model.js";
import { Location } from "../../features/locations/location.model.js";
import { UserBlock } from "../../features/social/block.model.js";
import {
  FollowRequest,
  LocationFollow,
  RealWorldEventFollow,
  UserFollow,
} from "../../features/social/follow.model.js";
import { MomentAudience } from "../../features/moments/moment-audience.model.js";
import { MomentRelationship } from "../../features/moments/moment-relationship.model.js";
import { IdentityPhone, PhoneSignInCode } from "../../features/authentication/phone.model.js";
import {
  Moment,
  MomentEdit,
  MomentLocation,
  MomentMedium,
  MomentRealWorldEvent,
} from "../../features/moments/moment.model.js";
import {
  RealWorldEvent,
  RealWorldEventAlias,
  RealWorldEventLocation,
} from "../../features/real-world-events/real-world-event.model.js";
import { Upload } from "../../features/uploads/upload.model.js";
import { Handle, Preferences, RestrictedData, User } from "../../features/users/user.model.js";
import type { HealthCheckable } from "../health.js";
import { OutboxMessage, ProjectionProcessedEvent, SchemaMigration } from "./outbox.model.js";

/**
 * The API's PostgreSQL infrastructure boundary.
 *
 * Connection construction lives here so feature code never builds its own.
 * Table ownership and query implementations belong to features.
 *
 * One DataSource, and it owns the only pool in the process. Everything reaches
 * the database through it — repositories through entities, and the migration
 * runner and outbox publisher through raw SQL on the same connections, because
 * what they need (an advisory lock, `FOR UPDATE SKIP LOCKED`) is better said in
 * SQL than pretended into a query API.
 */
export interface Database extends HealthCheckable {
  readonly dataSource: DataSource;
  close(): Promise<void>;
}

/**
 * Every entity the DataSource knows about.
 *
 * Listed explicitly rather than discovered by glob. A glob resolves differently
 * from source and from `dist`, and a missing entity fails at the first query
 * rather than at startup — this fails immediately and in the same way
 * everywhere.
 */
const entities = [
  User,
  Handle,
  Preferences,
  RestrictedData,
  Identity,
  IdentityEmail,
  IdentityPassword,
  Session,
  MagicLinkToken,
  AuthAuditEvent,
  RoleAssignment,
  AuthorizationAuditEvent,
  Upload,
  Location,
  Moment,
  MomentMedium,
  MomentLocation,
  MomentRealWorldEvent,
  MomentEdit,
  MomentAudience,
  MomentRelationship,
  IdentityPhone,
  PhoneSignInCode,
  RealWorldEvent,
  RealWorldEventAlias,
  RealWorldEventLocation,
  UserFollow,
  FollowRequest,
  RealWorldEventFollow,
  LocationFollow,
  UserBlock,
  OutboxMessage,
  ProjectionProcessedEvent,
  SchemaMigration,
];

/**
 * Build the API's PostgreSQL boundary.
 *
 * The DataSource is returned unconnected; `connect` opens it. Construction and
 * connection are separate so a caller can build the object without a database
 * present, which is what lets configuration errors surface before I/O does.
 *
 * @param config - Host, port, database, and credentials.
 * @returns The DataSource, a health check that performs a real query, and a
 *   close.
 */
export function createDatabase(config: DatabaseConfig): Database {
  const dataSource = new DataSource({
    type: "postgres",
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    password: config.password,
    entities,
    // Never. The migrations under `apps/api/migrations/` are the only thing
    // that changes this database (ADR-099). Synchronisation would drop the
    // partial indexes and check constraints the entities cannot express, which
    // is precisely the guarantee those migrations exist to hold.
    synchronize: false,
    migrationsRun: false,
    // Off by default; `TYPEORM_LOG=1` prints every statement with its
    // parameters, which is how a query that silently matched nothing gets
    // caught. Never on in a deployed process: the parameters include values
    // that must not reach a log.
    logging: process.env.TYPEORM_LOG === "1" ? ["query"] : false,
    // Bounded so a failing dependency surfaces as an error rather than as a
    // request that hangs until something upstream gives up.
    connectTimeoutMS: 5_000,
    poolSize: 10,
    extra: { idleTimeoutMillis: 30_000 },
  });

  return {
    name: "postgres",
    dataSource,
    async checkHealth() {
      await dataSource.query("SELECT 1");
    },
    async close() {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    },
  };
}

/**
 * Open the connection pool.
 *
 * Idempotent, so a caller that cannot easily tell whether something else has
 * already connected does not have to find out.
 *
 * @param database - The boundary to open.
 * @returns Nothing, once connected.
 * @throws {Error} If the database cannot be reached, or an entity does not
 *   match what the driver can map. Both are startup failures rather than
 *   request failures, which is the point of doing this before serving.
 */
export async function connectDatabase(database: Database): Promise<void> {
  if (!database.dataSource.isInitialized) {
    await database.dataSource.initialize();
  }
}
