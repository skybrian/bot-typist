import * as fc from "fast-check";

import { DONE, Reader, ReadResult } from "../../lib/streams";

export function concat(...args: fc.Arbitrary<string>[]): fc.Arbitrary<string> {
  return fc.tuple(...args).map((strings) => strings.join(""));
}

export interface ChunkedString {
  original: string;
  chunks: string[];
}

/**
 * Splits a string into chunks, optionally after preprocessing it.
 */
export function anyChunksOf<T>(
  anyString: fc.Arbitrary<string>,
): fc.Arbitrary<ChunkedString> {
  return fc.tuple(anyString, fc.array(fc.nat()))
    .map(([original, nats]) => {
      // Map the indices to be within the bounds of the string's length
      const bounded = nats.map((n) => n % original.length);
      const sorted = Array.from(bounded).sort((a, b) => a - b);

      const chunks: string[] = [];

      let prev = 0;
      for (let index of sorted) {
        chunks.push(original.slice(prev, index));
        prev = index;
      }

      chunks.push(original.slice(prev));
      return { original, chunks };
    });
}

/**
 * A reader that returns the given chunks in order.
 */
export class TestReader implements Reader {
  private chunks: string[];
  private next = 0;

  constructor(chunks: string[]) {
    this.chunks = chunks;
  }

  read(): Promise<ReadResult> {
    if (this.next >= this.chunks.length) {
      return Promise.resolve(DONE);
    }
    return Promise.resolve(this.chunks[this.next++]);
  }
}
