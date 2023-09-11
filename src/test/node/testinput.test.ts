import expect from "expect";
import * as fc from "fast-check";
import { anyChunksOf, concat } from "../lib/testinput";

describe("concat", () => {
  it("concatenates arbitrary strings", async () => {
    const arb = concat(fc.constant("foo"), fc.constant("bar"));
    expect(fc.sample(arb, 1)).toEqual(["foobar"]);
  });
});

describe("anyChunksOf", () => {
  it("splits a string into chunks that can be reassembled", async () => {
    fc.assert(fc.property(fc.string(), (original) => {
      const chunked = fc.sample(anyChunksOf(fc.constant(original)), 1)[0];
      expect(chunked.original).toEqual(original);
      expect(chunked.chunks.join("")).toEqual(original);
    }));
  });
});
