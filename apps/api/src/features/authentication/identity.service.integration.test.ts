import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AuthConfig } from "../../config/auth-config.js";
import type { EmailClient, EmailMessage } from "../../integrations/email/email-client.js";
import { issueMagicLink, type MagicLinkPurpose } from "../../lib/auth/magic-link.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { UnauthenticatedError } from "../../lib/errors/unauthorized-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { systemContext } from "../../types/request-context.js";
import { UserRepository } from "../users/user.repository.js";
import { IdentityRepository } from "./identity.repository.js";
import { IdentityService } from "./identity.service.js";
import { SessionRepository } from "./session.repository.js";
import { SessionService } from "./session.service.js";

/**
 * Identities, driven through the service against real infrastructure.
 *
 * The suite next door drives the same service through HTTP and reads the links
 * back out of Mailpit, so delivery is proven there. What is here is what that
 * cannot reach: links redeemed against an account that has since gone, a
 * password refused after its link was already spent, and a stored hash made
 * with cost parameters that have since been raised.
 *
 * Links are issued directly rather than read back from mail. It is the same
 * function the service calls, and it hands back the token, which lets these
 * tests arrange a link's purpose and owner precisely. Mail itself is recorded
 * rather than sent: SMTP is a network boundary, and nothing here is about
 * delivery.
 *
 * Requires `pnpm infra:up`.
 */

const config: AuthConfig = {
  jwtSecret: new TextEncoder().encode("integration-test-secret-long-enough-for-hs256"),
  issuer: "chronologity",
  audience: "chronologity-clients",
  accessTokenTtlSeconds: 600,
  refreshTokenTtlSeconds: 2_592_000,
  magicLinkTtlSeconds: 900,
  magicLinkBaseUrl: "http://localhost:3000/auth/sessions",
  // The cheapest the schema permits: these tests hash many passwords, and
  // production cost would dominate the suite without testing what it changes.
  passwordHashing: { memoryCostKib: 8_192, timeCost: 1, parallelism: 1 },
  passwordPolicy: { minimumLength: 12, maximumLength: 256 },
};

const STRONG = "a perfectly reasonable passphrase";
const WEAK = "password123";

const uniqueEmail = () => `person-${randomUUID()}@example.test`;

describe("identities", () => {
  let database: Database;
  let identities: IdentityService;
  let sent: EmailMessage[] = [];

  /** Records what would have been sent. Delivery is proven by the HTTP suite. */
  const recordingEmail: EmailClient = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await connectDatabase(database);
    await migrate(database.dataSource);

    identities = build(config);
  });

  afterAll(async () => {
    await database.close();
  });

  /**
   * An Identity service sharing this suite's database.
   *
   * @param settings - Authentication settings, so a test can raise the hashing
   *   cost and see what a sign-in does about a hash made under the old one.
   * @returns The service.
   */
  function build(settings: AuthConfig): IdentityService {
    const sessions = new SessionService(
      database.dataSource,
      new SessionRepository(database.dataSource),
      new UserRepository(database.dataSource),
      settings,
    );

    return new IdentityService(
      database.dataSource,
      new IdentityRepository(database.dataSource),
      sessions,
      recordingEmail,
      settings,
    );
  }

  const context = () => systemContext(randomUUID(), new Date());

  /** Issue a link of a given purpose for an address, and hand back its token. */
  const linkFor = async (email: string, purpose: MagicLinkPurpose): Promise<string> => {
    const { token } = await withTransaction(database.dataSource, (tx) =>
      issueMagicLink(tx, {
        email: email.toLowerCase(),
        purpose,
        ttlSeconds: config.magicLinkTtlSeconds,
        now: new Date(),
      }),
    );

    return token;
  };

  /** A registered address with its control proven. */
  const registered = async (password = STRONG) => {
    const email = uniqueEmail();
    await identities.register(email, password, context());
    await identities.verifyEmail(await linkFor(email, "verify_email"), context());

    const identityId = await new IdentityRepository(database.dataSource).findByEmail(email);
    assert.ok(identityId !== undefined);

    return { email, identityId };
  };

  describe("proving an address", () => {
    it("refuses a verification link that was never issued", async () => {
      await assert.rejects(
        identities.verifyEmail("definitely-not-a-real-token", context()),
        UnauthenticatedError,
      );
    });

    it("records a refused link without recording the link", async () => {
      const before = await auditCount("magic_link_rejected");

      await assert.rejects(identities.verifyEmail(randomUUID(), context()), UnauthenticatedError);

      // The refusal is worth investigating later; the token is not, because a
      // token in a durable record is a working credential.
      assert.equal(await auditCount("magic_link_rejected"), before + 1);

      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT count(*) FROM auth_audit_events WHERE context::text LIKE '%token%'`,
      );
      assert.equal(rows[0]?.count, "0");
    });

    it("refuses a link whose address no longer belongs to anyone", async () => {
      const email = uniqueEmail();
      await identities.register(email, STRONG, context());
      const token = await linkFor(email, "verify_email");

      // What an erasure between issuing and redeeming looks like. The link is
      // valid and spends itself, but there is nothing left to prove control of.
      await database.dataSource.query(`DELETE FROM identity_emails WHERE normalized_email = $1`, [
        email.toLowerCase(),
      ]);

      await assert.rejects(identities.verifyEmail(token, context()), UnauthenticatedError);
    });

    it("refuses a link of the wrong purpose", async () => {
      const email = uniqueEmail();
      await identities.register(email, STRONG, context());

      const signIn = await linkFor(email, "login");

      await assert.rejects(identities.verifyEmail(signIn, context()), UnauthenticatedError);
    });
  });

  describe("signing in with a password", () => {
    it("replaces a hash made under cost parameters that have since been raised", async () => {
      const { email, identityId } = await registered();

      const before = await storedHash(identityId);
      assert.match(before, /m=8192/);

      // The same password, verified by a service that now demands more work.
      // This is the only moment the plaintext is available to rehash with.
      const stricter = build({
        ...config,
        passwordHashing: { memoryCostKib: 16_384, timeCost: 1, parallelism: 1 },
      });

      const credentials = await stricter.signInWithPassword(email, STRONG, undefined, context());
      assert.ok(credentials.accessToken.length > 0);

      const after = await storedHash(identityId);
      assert.match(after, /m=16384/);
      assert.notEqual(after, before);

      // And the upgrade must not have changed what the password is.
      await assert.doesNotReject(stricter.signInWithPassword(email, STRONG, undefined, context()));
    });

    it("leaves a hash alone when the cost parameters still stand", async () => {
      const { email, identityId } = await registered();
      const before = await storedHash(identityId);

      await identities.signInWithPassword(email, STRONG, undefined, context());

      assert.equal(await storedHash(identityId), before, "rehashing needlessly costs every sign-in");
    });
  });

  describe("resetting a password", () => {
    it("sends nothing for an address nobody has registered", async () => {
      sent = [];

      await identities.requestPasswordReset(uniqueEmail(), context());

      // Unlike a sign-in link, a reset link means nothing without an account,
      // so none is issued. The caller cannot tell, which is the point.
      assert.deepEqual(sent, []);

      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT count(*) FROM magic_link_tokens WHERE purpose = 'reset_password'
           AND created_at > now() - interval '5 seconds'`,
      );
      assert.equal(rows[0]?.count, "0");
    });

    it("spends the link even when the new password is refused", async () => {
      const { email } = await registered();
      const token = await linkFor(email, "reset_password");

      await assert.rejects(identities.resetPassword(token, WEAK, context()), ValidationError);

      // Checked after the link is consumed, deliberately: a link that survived
      // a failed attempt is a link an attacker can keep trying against.
      await assert.rejects(
        identities.resetPassword(token, STRONG, context()),
        UnauthenticatedError,
      );

      // And the password it was meant to replace is untouched.
      await assert.doesNotReject(
        identities.signInWithPassword(email, STRONG, undefined, context()),
      );
    });

    it("refuses a reset link whose account has gone", async () => {
      const email = uniqueEmail();

      // A link with no account behind it: what a reset request that raced an
      // erasure leaves behind.
      const token = await linkFor(email, "reset_password");

      await assert.rejects(identities.resetPassword(token, STRONG, context()), UnauthenticatedError);
    });

    it("proves the address as well, so an unconfirmed account can recover", async () => {
      const email = uniqueEmail();
      await identities.register(email, STRONG, context());

      // Never confirmed, so a password sign-in is refused.
      await assert.rejects(
        identities.signInWithPassword(email, STRONG, undefined, context()),
        UnauthenticatedError,
      );

      const replacement = "an entirely different passphrase";
      await identities.resetPassword(await linkFor(email, "reset_password"), replacement, context());

      // Receiving mail at the address is the same proof the confirmation link
      // asks for, so they are no longer stuck.
      await assert.doesNotReject(
        identities.signInWithPassword(email, replacement, undefined, context()),
      );
    });
  });

  describe("changing a password", () => {
    it("refuses a new password the policy rejects, and says why", async () => {
      const { email, identityId } = await registered();
      const session = await identities.signInWithPassword(email, STRONG, undefined, context());
      const before = await storedHash(identityId);

      await assert.rejects(
        identities.changePassword(
          {
            identityId,
            currentSessionId: session.sessionId,
            currentPassword: STRONG,
            newPassword: WEAK,
          },
          context(),
        ),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          // The one thing here reported plainly: refusing without a reason
          // leaves someone guessing at rules they cannot see.
          assert.equal(error.details?.field, "newPassword");
          return true;
        },
      );

      // Refused before anything was written.
      assert.equal(await storedHash(identityId), before);
      await assert.doesNotReject(
        identities.signInWithPassword(email, STRONG, undefined, context()),
      );
    });

    it("refuses a change to an identity that has no password at all", async () => {
      // Magic link remains a way to sign in, so an Identity may legitimately
      // have no password. There is then no current password to prove.
      const email = uniqueEmail();
      const token = await linkFor(email, "login");
      const credentials = await identities.signInWithLink(token, undefined, context());

      const identityId = await new IdentityRepository(database.dataSource).findByEmail(email);
      assert.ok(identityId !== undefined);

      await assert.rejects(
        identities.changePassword(
          {
            identityId,
            currentSessionId: credentials.sessionId,
            currentPassword: "anything at all really",
            newPassword: STRONG,
          },
          context(),
        ),
        UnauthenticatedError,
      );
    });
  });

  /** The PHC-format hash stored for an Identity. */
  async function storedHash(identityId: string): Promise<string> {
    const rows: { password_hash: string }[] = await database.dataSource.query(
      `SELECT password_hash FROM identity_passwords WHERE identity_id = $1`,
      [identityId],
    );

    const hash = rows[0]?.password_hash;
    assert.ok(hash !== undefined, `no password for ${identityId}`);

    return hash;
  }

  /** How many audit records of a kind exist, for asserting one was added. */
  async function auditCount(eventType: string): Promise<number> {
    const rows: { count: string }[] = await database.dataSource.query(
      `SELECT count(*) FROM auth_audit_events WHERE event_type = $1`,
      [eventType],
    );

    return Number(rows[0]?.count ?? "0");
  }
});
