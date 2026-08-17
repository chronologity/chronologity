import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { PlaceSearchClient } from "../../integrations/places/place-search-client.js";
import { createRecordedPlaceSearchClient } from "../../integrations/places/recorded-place-search-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEventStore, type EventStore } from "../../lib/eventstore/client.js";
import { readStream } from "../../lib/eventstore/read-stream.js";
import { streamName } from "../../lib/eventstore/stream-name.js";
import { systemContext } from "../../types/request-context.js";
import { recordLocationCommand } from "./commands/record-location.command.js";
import { handleRecordLocation } from "./commands/record-location.handler.js";
import type { LocationDependencies } from "./dependencies.js";
import { handleGetLocation } from "./queries/get-location.handler.js";
import { handleSearchPlaces } from "./queries/search-places.handler.js";

/**
 * Recording places, against real infrastructure.
 *
 * The map service is answered from recorded responses rather than called. Two
 * reasons: a suite that depends on someone else's uptime is unreliable, and
 * the public service is run by volunteers who ask for at most one request a
 * second — which a test suite would blow through without noticing.
 *
 * Requires `pnpm infra:up`.
 */

describe("recording places", () => {
  let database: Database;
  let eventStore: EventStore;
  let deps: LocationDependencies;
  let places: PlaceSearchClient;

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    eventStore = createEventStore({
      connectionString: process.env.EVENTSTOREDB_URL ?? "esdb://localhost:2113?tls=false",
    });
    await migrate(database.pool);

    places = createRecordedPlaceSearchClient();
    deps = { client: eventStore.client, pool: database.pool, places };
  });

  afterAll(async () => {
    await eventStore.close();
    await database.close();
  });

  const context = () => systemContext(randomUUID(), new Date());

  describe("searching", () => {
    it("returns candidates without creating anything", async () => {
      // Measured as a change rather than an absolute. An earlier version
      // asserted no place existed for the reference, which passed once and
      // failed on the next run: another test in this file records that same
      // reference, and the database persists between runs. The property being
      // tested is that searching adds nothing, not that nothing is there.
      const countPlaces = async (): Promise<string> => {
        const { rows } = await database.pool.query<{ count: string }>(
          `SELECT count(*) AS count FROM locations`,
        );

        return rows[0]?.count ?? "0";
      };

      const before = await countPlaces();

      const found = await handleSearchPlaces(deps, {
        query: "Madison Square Garden",
        limit: undefined,
      });

      assert.ok(found.suggestions.length > 0);

      // A search is a question, not an act.
      assert.equal(await countPlaces(), before);
    });

    it("credits the data, because the licence requires it", async () => {
      const found = await handleSearchPlaces(deps, { query: "Reykjavik", limit: undefined });

      assert.match(found.attribution, /OpenStreetMap/);
    });

    it("returns nothing for a search that matched nothing", async () => {
      const found = await handleSearchPlaces(deps, {
        query: "zzzznotarealplacezzzz",
        limit: undefined,
      });

      assert.deepEqual(found.suggestions, []);
    });
  });

  describe("recording", () => {
    it("gives a place chosen from a search an identity of ours", async () => {
      const found = await handleSearchPlaces(deps, {
        query: "Madison Square Garden",
        limit: undefined,
      });
      const chosen = found.suggestions[0]!;

      const location = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: chosen.name,
          coordinates: chosen.coordinates,
          precision: "exact",
          context: chosen.context,
          sourceReference: chosen.reference,
        }),
        context(),
      );

      assert.equal(location.name, "Madison Square Garden");
      // Ours, and nothing to do with the map service's.
      assert.match(location.locationId, /^[0-9a-f-]{36}$/);
      assert.notEqual(location.locationId, chosen.reference);
      assert.equal(location.sourceReference, chosen.reference);
    });

    it("keeps the name it was given when the map service later disagrees", async () => {
      // The property the whole design exists for. A venue is renamed; a
      // photograph from before the rename must keep the name it was recorded
      // with, rather than being relabelled with today's.
      const original = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "The Old Vic Tavern",
          coordinates: { latitude: 51.5, longitude: -0.1 },
          precision: "exact",
          sourceReference: `way:${randomUUID().slice(0, 8)}`,
        }),
        context(),
      );

      // The service now returns something different for the same reference.
      const later = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "Shiny New Bar",
          coordinates: { latitude: 51.5, longitude: -0.1 },
          precision: "exact",
          sourceReference: original.sourceReference ?? "",
        }),
        context(),
      );

      assert.equal(later.locationId, original.locationId, "a second place was created");
      assert.equal(later.name, "The Old Vic Tavern", "the recorded name was overwritten");
    });

    it("reaches one place when two people choose the same result", async () => {
      const reference = `way:${randomUUID().slice(0, 8)}`;

      const first = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "Somewhere Shared",
          coordinates: { latitude: 1, longitude: 2 },
          precision: "exact",
          sourceReference: reference,
        }),
        context(),
      );

      const second = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "Somewhere Shared",
          coordinates: { latitude: 1, longitude: 2 },
          precision: "exact",
          sourceReference: reference,
        }),
        context(),
      );

      assert.equal(first.locationId, second.locationId);
    });

    it("records a place the map service has never heard of", async () => {
      const location = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "Nana's house",
          coordinates: { latitude: 53.4, longitude: -2.9 },
          precision: "exact",
        }),
        context(),
      );

      assert.equal(location.name, "Nana's house");
      assert.equal(location.sourceReference, null);
    });

    it("records a place nobody can locate, without inventing a position", async () => {
      const location = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "Somewhere in the Lake District",
          precision: "unknown",
        }),
        context(),
      );

      assert.equal(location.precision, "unknown");
      assert.equal(location.coordinates, null);
    });

    it("records how precisely a position is known, separately from the position", async () => {
      // Six decimal places says nothing about confidence: a phone reports six
      // whether it is certain or guessing.
      const broad = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "Northern Italy",
          coordinates: { latitude: 45.4642, longitude: 9.19 },
          precision: "broad",
        }),
        context(),
      );

      assert.equal(broad.precision, "broad");
      assert.ok(broad.coordinates !== null);
    });

    it("keeps the wider areas as they were recorded", async () => {
      const found = await handleSearchPlaces(deps, {
        query: "Madison Square Garden",
        limit: undefined,
      });
      const chosen = found.suggestions[0]!;

      const location = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: chosen.name,
          coordinates: chosen.coordinates,
          precision: "exact",
          context: chosen.context,
          sourceReference: `way:${randomUUID().slice(0, 8)}`,
        }),
        context(),
      );

      assert.equal(location.context.city, "New York");
      assert.equal(location.context.countryCode, "US");
    });
  });

  describe("history", () => {
    it("records the place in its own history, with its own identifier", async () => {
      const location = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "A Recorded Place",
          coordinates: { latitude: 10, longitude: 20 },
          precision: "approximate",
        }),
        context(),
      );

      const recorded = await readStream(
        eventStore.client,
        streamName("location", location.locationId),
      );

      assert.equal(recorded.length, 1);
      assert.equal(recorded[0]?.type, "LocationRecorded");
      assert.equal((recorded[0]?.payload as { name: string }).name, "A Recorded Place");
    });
  });

  describe("reading", () => {
    it("reads a place back", async () => {
      const created = await handleRecordLocation(
        deps,
        recordLocationCommand(randomUUID(), {
          name: "Readable Place",
          coordinates: { latitude: 5, longitude: 6 },
          precision: "exact",
        }),
        context(),
      );

      const read = await handleGetLocation(deps, { locationId: created.locationId });

      assert.deepEqual(read, created);
    });

    it("refuses a place that does not exist", async () => {
      await assert.rejects(handleGetLocation(deps, { locationId: randomUUID() }));
    });
  });
});
