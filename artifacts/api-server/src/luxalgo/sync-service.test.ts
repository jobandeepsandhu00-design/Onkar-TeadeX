import assert from "node:assert/strict";
import test from "node:test";
import { luxAlgoSyncInternals } from "./sync-service";

test("content hashing is stable across object key order", () => {
  assert.equal(
    luxAlgoSyncInternals.digest({ slug: "liquidity-sweep", nested: { b: 2, a: 1 } }),
    luxAlgoSyncInternals.digest({ nested: { a: 1, b: 2 }, slug: "liquidity-sweep" }),
  );
});

test("relationships are extracted only from actual official Library links and deduplicated", () => {
  const rows = luxAlgoSyncInternals.markdownRelationships(`
    [Sweep](https://www.luxalgo.com/library/concept/liquidity-sweep/)
    [Sweep again](https://www.luxalgo.com/library/concept/liquidity-sweep/)
    [Indicator](https://www.luxalgo.com/library/indicator/session-sweeps/)
    [External](https://example.com/library/concept/fake/)
  `);
  assert.deepEqual(rows, [
    { relationship: "RELATED_CONCEPT", targetType: "CONCEPT", targetId: "liquidity-sweep", metadata: { url: "https://www.luxalgo.com/library/concept/liquidity-sweep/" } },
    { relationship: "IMPLEMENTED_BY", targetType: "INDICATOR", targetId: "session-sweeps", metadata: { url: "https://www.luxalgo.com/library/indicator/session-sweeps/" } },
  ]);
});

test("public source license metadata is extracted without executing source", () => {
  const source = "// This Pine Script code is subject to the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/ MPL-2.0\n//@version=6";
  const metadata = luxAlgoSyncInternals.sourceFields({ author: "LuxAlgo" }, source);
  assert.equal(metadata.attribution, "LuxAlgo");
  assert.equal(metadata.licenseIdentifier, "MPL-2.0");
  assert.equal(metadata.licenseUrl, "https://mozilla.org/MPL/2.0/");
  assert.equal(typeof source, "string");
});

test("unsafe external identifiers are rejected", () => {
  assert.throws(() => luxAlgoSyncInternals.safeId("../shell"), /invalid identifier/i);
});
