import { expect } from "chai";
import { buildValidateStatData } from "./settlement";

describe("settlement borsh encoders", () => {
  const baseParams = {
    ts: 0,
    fixtureSummary: {
      fixtureId: 0,
      updateStats: { updateCount: 0, minTimestamp: 0, maxTimestamp: 0 },
      eventsSubTreeRoot: new Uint8Array(32).fill(0),
    },
    fixtureProof: [],
    mainTreeProof: [],
    predicate: { threshold: 0, comparison: 0 as const },
    statA: {
      statToProve: { key: 0, value: 0, period: 0 },
      eventStatRoot: new Uint8Array(32).fill(0),
      statProof: [],
    },
    statB: null,
    op: null,
  };

  it("encodes zero i64 as little-endian", () => {
    const buf = buildValidateStatData({ ...baseParams, ts: 0 });
    expect(Array.from(buf.slice(0, 8))).to.deep.equal([
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("encodes positive i64 as little-endian", () => {
    // Use a value that is safely representable as a JS number.
    const buf = buildValidateStatData({ ...baseParams, ts: 0x123456789 });
    expect(Array.from(buf.slice(0, 8))).to.deep.equal([
      0x89, 0x67, 0x45, 0x23, 0x01, 0x00, 0x00, 0x00,
    ]);
  });

  it("encodes negative i64 (two's complement) as little-endian", () => {
    const buf = buildValidateStatData({ ...baseParams, ts: -1 });
    expect(Array.from(buf.slice(0, 8))).to.deep.equal([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
  });

  it("encodes a realistic positive timestamp", () => {
    const ts = 1_700_000_000_000; // ms timestamp, safely within Number range
    const buf = buildValidateStatData({ ...baseParams, ts });
    const expected: number[] = [];
    let n = BigInt(ts);
    for (let i = 0; i < 8; i++) {
      expected.push(Number(n & BigInt(0xff)));
      n >>= BigInt(8);
    }
    expect(Array.from(buf.slice(0, 8))).to.deep.equal(expected);
  });
});
