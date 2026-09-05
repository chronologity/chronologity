import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type { RequestEligibility } from "../auth/request-eligibility.js";
import type { Logger } from "../observability/logger.js";
import type { AuthorizedMoment, MomentReadModel, MomentRow } from "../read-models/postgres/moment-read-model.js";
import { load } from "./create-loaders.js";
import { createMomentLoader } from "./moment.loader.js";

/**
 * Reading Moments once each.
 *
 * The stub here is the read model, which is an injected boundary rather than
 * this system's database: what the statement returns is settled by the
 * integration suites, and what is settled here is everything around it — that a
 * dispatch carries every key, that each caller gets *its own* answer, and that a
 * failure is not remembered.
 *
 * The ordering case is the one that would otherwise ship. DataLoader's contract
 * is positional, and a stub whose fixture happens to be sorted will pass whether
 * or not the code honours it.
 */

const VIEWER = randomUUID();

const LOG = { debug: () => undefined } as unknown as Logger;

const ELIGIBILITY = {
  forViewer: async () => ({ viewerUserId: VIEWER, isAdult: true }),
} as unknown as RequestEligibility;

/** A Moment as the store would hand it back. */
const authorized = (momentId: string): AuthorizedMoment =>
  ({ row: { moment_id: momentId } as MomentRow, viewerUserId: VIEWER });

/** A read model that records what it was asked and answers from a set. */
const readModel = (
  present: readonly string[],
  asked: string[][],
  over: { reverse?: boolean; fail?: () => boolean } = {},
): MomentReadModel =>
  ({
    findVisibleMany: async (ids: readonly string[]) => {
      asked.push([...ids]);

      if (over.fail?.() === true) {
        throw new Error("PostgreSQL said no");
      }

      const found = ids.filter((id) => present.includes(id));
      const ordered = over.reverse === true ? [...found].reverse() : found;

      return new Map(ordered.map((id) => [id, authorized(id)]));
    },
  }) as unknown as MomentReadModel;

describe("reading Moments through the loader", () => {
  it("asks once for two Moments wanted in the same tick", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const asked: string[][] = [];
    const loader = createMomentLoader(readModel([a, b], asked), ELIGIBILITY, LOG);

    await Promise.all([loader.load(a), loader.load(b)]);

    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0], [a, b]);
  });

  it("asks once for the same Moment wanted twice", async () => {
    // The reason this exists. Two selections of one Moment that asked separately
    // could be answered differently — one saying it may be read and the other
    // that it may not — inside a single response.
    const a = randomUUID();
    const asked: string[][] = [];
    const loader = createMomentLoader(readModel([a], asked), ELIGIBILITY, LOG);
    const [first, second] = await Promise.all([loader.load(a), loader.load(a)]);

    assert.deepEqual(asked, [[a]]);
    assert.equal(first, second);
  });

  it("gives each caller its own Moment when the store answers in another order", async () => {
    // DataLoader's contract is positional. A batch answered in the order rows
    // came back would hand each caller somebody else's Moment — silently, and
    // never in a fixture that happened to be sorted.
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const loader = createMomentLoader(readModel([a, b, c], [], { reverse: true }), ELIGIBILITY, LOG);
    const found = await Promise.all([loader.load(a), loader.load(b), loader.load(c)]);

    assert.deepEqual(
      found.map((one) => one?.row.moment_id),
      [a, b, c],
    );
  });

  it("answers a Moment it cannot find with nothing, rather than an error", async () => {
    // A refusal and a Moment that never existed stay the same answer.
    const loader = createMomentLoader(readModel([], []), ELIGIBILITY, LOG);

    assert.equal(await loader.load(randomUUID()), undefined);
  });

  it("fails every key of a failed dispatch", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const loader = createMomentLoader(
      readModel([a, b], [], { fail: () => true }),
      ELIGIBILITY,
      LOG,
    );

    await assert.rejects(loader.load(a));
    await assert.rejects(loader.load(b));
  });

  it("does not remember a failure", async () => {
    // A failed lookup is not an answer. Left cached it would be replayed to
    // every later reader in the request, turning one bad round trip into a
    // response that cannot be composed at all.
    const a = randomUUID();
    const asked: string[][] = [];
    let broken = true;
    const loader = createMomentLoader(
      readModel([a], asked, { fail: () => broken }),
      ELIGIBILITY,
      LOG,
    );

    await assert.rejects(load(loader, a));

    broken = false;

    assert.equal((await load(loader, a))?.row.moment_id, a);
    assert.equal(asked.length, 2);
  });
});
