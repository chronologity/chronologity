import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EVENT_REGISTRY, boundaryOf } from "@chronologity/contracts";
import {
  MEDIA_CHECKER_BOUNDARIES,
  MEDIA_CHECKER_EVENTS,
} from "../../workers/media/check-media.js";
import {
  NOTIFICATION_GENERATOR_BOUNDARIES,
  NOTIFICATION_GENERATOR_EVENTS,
} from "../../workers/notification-generator/generate.js";
import {
  SEARCH_INDEXER_BOUNDARIES,
  SEARCH_INDEXER_EVENTS,
} from "../../workers/search-indexer/index-event.js";

/**
 * What each consumer group listens to, against what it can act on.
 *
 * An end-to-end test proves the one path it walks. Eleven subscriptions across
 * three groups cannot each have one, so this closes the rest by comparison
 * instead: every event a worker handles must arrive on a boundary it
 * subscribes to, and every boundary it subscribes to must carry something it
 * handles. A topic name that is wrong, a subscription that was forgotten, and a
 * subscription nothing reads are three different mistakes, and none of them
 * announces itself at runtime.
 *
 * No infrastructure. This is a comparison of two declarations, and needing a
 * broker to make it would mean it ran rarely.
 */

interface Worker {
  readonly group: string;
  readonly handles: readonly string[];
  readonly subscribes: readonly string[];
}

const WORKERS: readonly Worker[] = [
  {
    group: "media-checker",
    handles: MEDIA_CHECKER_EVENTS,
    subscribes: MEDIA_CHECKER_BOUNDARIES,
  },
  {
    group: "search-indexer",
    handles: SEARCH_INDEXER_EVENTS,
    subscribes: SEARCH_INDEXER_BOUNDARIES,
  },
  {
    group: "notification-generator",
    handles: NOTIFICATION_GENERATOR_EVENTS,
    subscribes: NOTIFICATION_GENERATOR_BOUNDARIES,
  },
];

describe("every consumer group", () => {
  for (const worker of WORKERS) {
    describe(worker.group, () => {
      it("handles only events the registry knows about", () => {
        for (const type of worker.handles) {
          assert.notEqual(
            boundaryOf(type),
            undefined,
            `${worker.group} handles ${type}, which nothing publishes`,
          );
        }
      });

      it("subscribes to the boundary every event it handles arrives on", () => {
        for (const type of worker.handles) {
          const boundary = boundaryOf(type);

          assert.ok(
            boundary !== undefined && worker.subscribes.includes(boundary),
            `${worker.group} handles ${type} but never subscribes to ${String(boundary)}`,
          );
        }
      });

      it("subscribes to nothing it cannot act on", () => {
        for (const boundary of worker.subscribes) {
          const acts = worker.handles.some((type) => boundaryOf(type) === boundary);

          assert.ok(acts, `${worker.group} subscribes to ${boundary} and handles nothing on it`);
        }
      });

      it("handles each event once", () => {
        assert.equal(new Set(worker.handles).size, worker.handles.length);
        assert.equal(new Set(worker.subscribes).size, worker.subscribes.length);
      });
    });
  }

  it("leaves no registered event without a consumer", () => {
    // True today for all twenty-two, and worth holding: an event with no
    // consumer is either a contract published for nobody or a consumer somebody
    // forgot to write, and the two look identical until this fails.
    const consumed = new Set(WORKERS.flatMap((worker) => worker.handles));

    for (const event of EVENT_REGISTRY) {
      assert.ok(
        consumed.has(event.type),
        `${event.type} is published and nothing consumes it`,
      );
    }
  });
});
