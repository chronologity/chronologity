import assert from "node:assert/strict";
import { testContext } from "../../testing/context.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createRecordedPlaceSearchClient } from "../../integrations/places/recorded-place-search-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { createUser } from "../../testing/fixtures.js";
import { LocationRepository } from "./location.repository.js";
import { LocationService } from "./location.service.js";

/**
 * Recording places, against real infrastructure.
 *
 * The map service is answered from recorded responses rather than called. Two
 * reasons: a suite that depends on someone else's uptime is unreliable, and
 * the public service is run by volunteers who ask for at most one request a
 * second — which a test suite would blow through without noticing.
 *
 * PostgreSQL is not stubbed. What is being tested is largely what the database
 * decides — which of two people claiming the same place wins, and what a
 * constraint refuses — and a stand-in would decide it differently.
 *
 * Requires `pnpm infra:up`.
 */

describe("recording places", () => {
  let database: Database;
  let locations: LocationService;

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

    locations = new LocationService(
      database.dataSource,
      new LocationRepository(database.dataSource),
      createRecordedPlaceSearchClient(),
    );
  });

  afterAll(async () => {
    await database.close();
  });

  /** Somebody who can record a place. A Location references its recorder. */
  const recorder = async (): Promise<string> => (await createUser(database.dataSource)).userId;

  describe("searching", () => {
    it("returns candidates without creating anything", async () => {
      // Measured as a change rather than an absolute. An earlier version
      // asserted no place existed for the reference, which passed once and
      // failed on the next run: another test in this file records that same
      // reference, and the database persists between runs. The property being
      // tested is that searching adds nothing, not that nothing is there.
      const countPlaces = async (): Promise<string> => {
        const rows: { count: string }[] = await database.dataSource.query(
          `SELECT count(*) AS count FROM locations`,
        );
        return rows[0]?.count ?? "0";
      };

      const before = await countPlaces();

      const found = await locations.searchPlaces("Madison Square Garden");

      assert.ok(found.suggestions.length > 0);

      // A search is a question, not an act.
      assert.equal(await countPlaces(), before);
    });

    it("credits the data, because the licence requires it", async () => {
      const found = await locations.searchPlaces("Reykjavik");

      assert.match(found.attribution, /OpenStreetMap/);
    });

    it("returns nothing for a search that matched nothing", async () => {
      const found = await locations.searchPlaces("zzzznotarealplacezzzz");

      assert.deepEqual(found.suggestions, []);
    });
  });

  describe("recording", () => {
    it("gives a place chosen from a search an identity of ours", async () => {
      const found = await locations.searchPlaces("Madison Square Garden");
      const chosen = found.suggestions[0]!;

      const location = await locations.record(await recorder(), {
        name: chosen.name,
        coordinates: chosen.coordinates,
        precision: "exact",
        context: chosen.context,
        sourceReference: chosen.reference,
      }, testContext());

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
      const original = await locations.record(await recorder(), {
        name: "The Old Vic Tavern",
        coordinates: { latitude: 51.5, longitude: -0.1 },
        precision: "exact",
        sourceReference: `way:${randomUUID().slice(0, 8)}`,
      }, testContext());

      // The service now returns something different for the same reference.
      const later = await locations.record(await recorder(), {
        name: "Shiny New Bar",
        coordinates: { latitude: 51.5, longitude: -0.1 },
        precision: "exact",
        sourceReference: original.sourceReference ?? "",
      }, testContext());

      assert.equal(later.locationId, original.locationId, "a second place was created");
      assert.equal(later.name, "The Old Vic Tavern", "the recorded name was overwritten");
    });

    it("reaches one place when two people choose the same result", async () => {
      const reference = `way:${randomUUID().slice(0, 8)}`;

      const first = await locations.record(await recorder(), {
        name: "Somewhere Shared",
        coordinates: { latitude: 1, longitude: 2 },
        precision: "exact",
        sourceReference: reference,
      }, testContext());

      const second = await locations.record(await recorder(), {
        name: "Somewhere Shared",
        coordinates: { latitude: 1, longitude: 2 },
        precision: "exact",
        sourceReference: reference,
      }, testContext());

      assert.equal(first.locationId, second.locationId);
    });

    it("reaches one place when they choose it at the same moment", async () => {
      // The check for an existing place and the write that follows it are two
      // moments, and people can arrive between them. Under the previous
      // arrangement the loser's insert raised a unique violation nothing
      // caught, and they received a 500 for having been slightly too quick.
      //
      // Eight at once rather than two. With two, both can complete their check
      // before either writes, and the losing path this test exists for never
      // runs — the assertion holds either way, so the test would pass while
      // proving nothing. Eight makes the losing path certain.
      const reference = `way:${randomUUID().slice(0, 8)}`;

      const place = () => ({
        name: "Somewhere Simultaneous",
        coordinates: { latitude: 3, longitude: 4 },
        precision: "exact" as const,
        sourceReference: reference,
      });

      const people = await Promise.all(Array.from({ length: 8 }, () => recorder()));
      const recorded = await Promise.all(
        people.map((userId) => locations.record(userId, place(), testContext())),
      );

      const identifiers = new Set(recorded.map((location) => location.locationId));
      assert.equal(identifiers.size, 1, "eight simultaneous choices produced more than one place");

      // The assertion that the returned identifiers agree can be satisfied by
      // eight reads of one committed row. This one cannot: it says the
      // database holds a single place, which is the property the conditional
      // insert exists for.
      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT count(*) FROM locations WHERE source_reference = $1`,
        [reference],
      );
      assert.equal(rows[0]?.count, "1");
    });

    it("keeps the losing recorder's name off the place they lost", async () => {
      // Two people, two names, one map-service result. The first to commit
      // names it; the loser receives that place rather than their own name,
      // because a Moment recorded at that time should carry what it was called
      // then, not what the next person typed.
      const reference = `way:${randomUUID().slice(0, 8)}`;

      const people = await Promise.all(Array.from({ length: 8 }, () => recorder()));
      const recorded = await Promise.all(
        people.map((userId, index) =>
          locations.record(userId, {
            name: `Contender ${index}`,
            coordinates: { latitude: 5, longitude: 6 },
            precision: "exact",
            sourceReference: reference,
          }, testContext()),
        ),
      );

      const names = new Set(recorded.map((location) => location.name));
      assert.equal(names.size, 1, "callers disagreed about what the place is called");
      assert.match([...names][0] ?? "", /^Contender \d$/);
    });

    it("records how the place came to be known", async () => {
      const chosen = await locations.record(await recorder(), {
        name: "Chosen From A Search",
        coordinates: { latitude: 1, longitude: 2 },
        precision: "exact",
      }, testContext());

      // A request that says nothing about its source is describing somebody
      // typing a name in, which is the strongest claim there is.
      assert.equal(chosen.source, "explicit-selection");

      const fromPhoto = await locations.record(await recorder(), {
        name: "Read Out Of A Photograph",
        coordinates: { latitude: 3, longitude: 4 },
        precision: "exact",
        source: "media-metadata",
      }, testContext());

      // "Typed in by the person who was there" and "read out of a photograph's
      // metadata" are different claims, and a record holding only the name has
      // thrown the difference away (`locations.md:333`).
      assert.equal(fromPhoto.source, "media-metadata");
    });

    it("keeps the source it was recorded with when read back", async () => {
      const recorded = await locations.record(await recorder(), {
        name: "Somewhere Remembered",
        coordinates: { latitude: 5, longitude: 6 },
        precision: "approximate",
        source: "device-location",
      }, testContext());

      assert.equal((await locations.get(recorded.locationId)).source, "device-location");
    });

    it("records a place the map service has never heard of", async () => {
      const location = await locations.record(await recorder(), {
        name: "Nana's house",
        coordinates: { latitude: 53.4, longitude: -2.9 },
        precision: "exact",
      }, testContext());

      assert.equal(location.name, "Nana's house");
      assert.equal(location.sourceReference, null);
    });

    it("records a place nobody can locate, without inventing a position", async () => {
      const location = await locations.record(await recorder(), {
        name: "Somewhere in the Lake District",
        precision: "unknown",
      }, testContext());

      assert.equal(location.precision, "unknown");
      assert.equal(location.coordinates, null);
    });

    it("records how precisely a position is known, separately from the position", async () => {
      // Six decimal places says nothing about confidence: a phone reports six
      // whether it is certain or guessing.
      const broad = await locations.record(await recorder(), {
        name: "Northern Italy",
        coordinates: { latitude: 45.4642, longitude: 9.19 },
        precision: "broad",
      }, testContext());

      assert.equal(broad.precision, "broad");
      assert.ok(broad.coordinates !== null);
    });

    it("keeps the wider areas as they were recorded", async () => {
      const found = await locations.searchPlaces("Madison Square Garden");
      const chosen = found.suggestions[0]!;

      const location = await locations.record(await recorder(), {
        name: chosen.name,
        coordinates: chosen.coordinates,
        precision: "exact",
        context: chosen.context,
        sourceReference: `way:${randomUUID().slice(0, 8)}`,
      }, testContext());

      assert.equal(location.context.city, "New York");
      assert.equal(location.context.countryCode, "US");
    });

    it("refuses a position the database would refuse anyway, and says which way round", async () => {
      // The constraint is the guarantee; this is here so the answer is a
      // sentence about coordinates rather than a failed write.
      await assert.rejects(
        locations.record(await recorder(), {
          name: "Nowhere In Particular",
          coordinates: { latitude: 1, longitude: 2 },
          precision: "unknown",
        }, testContext()),
        /cannot carry coordinates/,
      );

      await assert.rejects(
        locations.record(await recorder(), { name: "Somewhere Definite", precision: "exact" }, testContext()),
        /needs coordinates/,
      );
    });
  });

  describe("reading", () => {
    it("reads a place back", async () => {
      const created = await locations.record(await recorder(), {
        name: "Readable Place",
        coordinates: { latitude: 5, longitude: 6 },
        precision: "exact",
      }, testContext());

      const read = await locations.get(created.locationId);

      assert.deepEqual(read, created);
    });

    it("refuses a place that does not exist", async () => {
      await assert.rejects(locations.get(randomUUID()));
    });
  });
});
