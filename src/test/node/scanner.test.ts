import expect from "expect";
import { inspect } from "util";
import * as fc from "fast-check";
import { anyChunksOf, concat, TestReader } from "../lib/testinput";

import { Scanner } from "../../lib/scanner";
import { StringWriter } from "../../lib/streams";

describe("Scanner", () => {
  describe("pull", () => {
    it("returns false when there's no more input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.pull()).toBe(false);
    });

    it("appends each chunk to the buffer, one at a time", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.unicodeString({ minLength: 1 })),
          async (chunks) => {
            const scanner = new Scanner(new TestReader(chunks));
            let pulls = 0;
            while (pulls < chunks.length) {
              expect(await scanner.pull()).toBe(true);
              pulls++;
              expect(scanner.buffer).toEqual(chunks.slice(0, pulls).join(""));
            }
            expect(await scanner.pull()).toBe(false);
            expect(scanner.buffer).toEqual(chunks.join(""));
          },
        ),
      );
    });

    it("doesn't split a surrogate pair", async () => {
      const pair = "😀";
      expect(pair.length).toBe(2);

      const scanner = new Scanner(new TestReader([pair[0], pair[1]]));
      expect(await scanner.pull()).toBe(true);
      expect(scanner.buffer).toEqual(pair);
    });
  });

  describe("fillTo", () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.fillTo(1)).toBe(false);
    });

    it("returns false when there's not enough input", async () => {
      const chunked = anyChunksOf(fc.unicodeString({ maxLength: 100 }));
      const anyN = fc.integer({ min: 1, max: 10 });
      const input = fc.tuple(chunked, anyN);
      await fc.assert(
        fc.asyncProperty(input, async ([{ original, chunks }, n]) => {
          const scanner = new Scanner(new TestReader(chunks));
          expect(await scanner.fillTo(original.length + n)).toBe(false);
          expect(scanner.buffer).toEqual(original);
        }),
      );
    });

    it("adds at least the specified number of characters to the buffer", async () => {
      const chunked = anyChunksOf(fc.unicodeString({ maxLength: 100 }));

      const input = chunked.chain(({ original, chunks }) => {
        return fc.record({
          original: fc.constant(original),
          chunks: fc.constant(chunks),
          offset: fc.integer({ min: 0, max: original.length }),
        });
      });

      await fc.assert(
        fc.asyncProperty(input, async ({ original, chunks, offset }) => {
          const scanner = new Scanner(new TestReader(chunks));
          expect(await scanner.fillTo(offset)).toBe(true);
          expect(scanner.buffer.length).toBeGreaterThanOrEqual(offset);
          expect(scanner.buffer).toEqual(
            original.slice(0, scanner.buffer.length),
          );
        }),
      );
    });
  });

  describe("startsWith", () => {
    it("returns true when the prefix is empty", async () => {
      const input = anyChunksOf(fc.unicodeString());
      await fc.assert(fc.asyncProperty(input, async ({ chunks }) => {
        const scanner = new Scanner(new TestReader(chunks));
        expect(await scanner.startsWith("")).toBe(true);
      }));
    });

    it("returns false when there's no input", async () => {
      await fc.assert(
        fc.asyncProperty(fc.unicodeString({ minLength: 1 }), async (prefix) => {
          const scanner = new Scanner(new TestReader([]));
          expect(await scanner.startsWith(prefix)).toBe(false);
        }),
      );
    });

    it("returns true when the input starts with the prefix", async () => {
      const chunked = anyChunksOf(fc.unicodeString());

      const args = chunked.chain(({ original, chunks }) => {
        return fc.record({
          original: fc.constant(original),
          chunks: fc.constant(chunks),
          offset: fc.integer({ min: 0, max: original.length }),
        });
      });

      await fc.assert(
        fc.asyncProperty(args, async ({ original, chunks, offset }) => {
          const scanner = new Scanner(new TestReader(chunks));
          const prefix = original.slice(0, offset);
          expect(await scanner.startsWith(prefix)).toBe(true);
        }),
      );
    });

    it("returns false when the input doesn't start with the prefix", async () => {
      const anyPrefix = fc.unicodeString({ minLength: 1 });

      const args = anyPrefix.chain((prefix) => {
        const input = fc.unicodeString().filter((s) => !s.startsWith(prefix));

        return anyChunksOf(input).chain(({ original, chunks }) => {
          return fc.constant({ original, chunks, prefix });
        });
      });

      await fc.assert(
        fc.asyncProperty(args, async ({ original, chunks, prefix }) => {
          const scanner = new Scanner(new TestReader(chunks));
          expect(await scanner.startsWith(prefix)).toBe(false);
        }),
      );
    });

    it("doesn't pull input if not needed", async () => {
      const scanner = new Scanner(new TestReader(["hello, ", "world!"]));
      expect(await scanner.startsWith("%long irrelevant string")).toBe(false);
      expect(scanner.buffer).toEqual("hello, ");
    });
  });

  describe("take", () => {
    it("returns the entire buffer", async () => {
      const chunked = anyChunksOf(fc.unicodeString({ maxLength: 100 }));

      await fc.assert(fc.asyncProperty(chunked, async ({ chunks }) => {
        const scanner = new Scanner(new TestReader(chunks));

        while (await scanner.pull()) {
          const before = scanner.buffer;
          expect(scanner.takeBuffer()).toEqual(before);
          expect(scanner.buffer).toEqual("");
        }
      }));
    });
  });

  describe("takeWithinLine", () => {
    it("returns empty string when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.takeChunkWithinLine()).toEqual("");
    });

    it("returns the entire buffer when there's no newline", async () => {
      const input = fc.unicodeString({ minLength: 1 }).filter((s) =>
        !s.includes("\n")
      );

      await fc.assert(fc.asyncProperty(input, async (input) => {
        const scanner = new Scanner(new TestReader([input]));
        expect(await scanner.takeChunkWithinLine()).toEqual(input);
      }));
    });

    it("never returns anything beyond the first newline", async () => {
      const input = concat(
        fc.unicodeString(),
        fc.constant("\n"),
        fc.unicodeString({ minLength: 1 }),
      );
      await fc.assert(
        fc.asyncProperty(anyChunksOf(input), async ({ original, chunks }) => {
          const scanner = new Scanner(new TestReader(chunks));
          let output = "";
          while (true) {
            const chunk = await scanner.takeChunkWithinLine();
            output += chunk;
            if (chunk === "" || chunk.includes("\n")) {
              break;
            }
          }
          const limit = original.indexOf("\n") + 1;
          const expected = original.slice(0, limit);
          expect(inspect(output)).toBe(inspect(expected));
          expect(output).toBe(expected);
        }),
      );
    });
  });

  describe("takeLine", () => {
    it("returns an empty string when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.takeLine()).toEqual("");
    });

    it("takes every line from the input", async () => {
      const chunked = anyChunksOf(fc.unicodeString({ minLength: 1 }));

      await fc.assert(
        fc.asyncProperty(chunked, async ({ original, chunks }) => {
          const scanner = new Scanner(new TestReader(chunks));
          const lines = original.split("\n");
          expect(lines.length).toBeGreaterThan(0);
          for (const line of lines.slice(0, -1)) {
            expect(await scanner.takeLine()).toEqual(line + "\n");
          }
          expect(await scanner.takeLine()).toEqual(lines[lines.length - 1]);
        }),
      );
    });
  });

  describe("takeBlankLine", async () => {
    it("returns an empty string when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.takeBlankLine()).toEqual("");
    });

    const blankChars = fc.stringOf(fc.constantFrom(" ", "\t"));

    it("takes a partial blank line if it's at the end of the input", async () => {
      const chunked = anyChunksOf(blankChars);
      await fc.assert(
        fc.asyncProperty(chunked, async ({ original, chunks }) => {
          const scanner = new Scanner(new TestReader(chunks));
          expect(await scanner.takeBlankLine()).toEqual(original);
        }),
      );
    });

    it("takes a complete blank line if it's blank", async () => {
      const input = concat(
        blankChars,
        fc.constant("\n"),
        fc.unicodeString({ maxLength: 1 }),
      );
      await fc.assert(
        fc.asyncProperty(anyChunksOf(input), async ({ original, chunks }) => {
          const scanner = new Scanner(new TestReader(chunks));
          const expected = original.slice(0, original.indexOf("\n") + 1);
          expect(await scanner.takeBlankLine()).toEqual(expected);
        }),
      );
    });
  });

  describe("takeEmoji", async () => {
    it("returns an empty string when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.takeEmoji()).toEqual("");
    });

    for (const char of ["😀", "🤖", "🪗"]) {
      it(`matches "${char}"`, async () => {
        fc.asyncProperty(
          anyChunksOf(fc.constant(char)),
          async ({ original, chunks }) => {
            const scanner = new Scanner(new TestReader(chunks));
            expect(await scanner.takeEmoji()).toEqual(original);
          },
        );
      });
    }

    it("doesn't pull if the buffer contains another character", async () => {
      for (let i = 0; i < 256; i++) {
        const char = String.fromCharCode(i);
        const scanner = new Scanner(new TestReader([char, "x"]));
        await scanner.pull();
        expect(scanner.buffer).toEqual(char);
        expect(await scanner.takeEmoji()).toEqual("");
        expect(scanner.buffer).toEqual(char);
      }
    });
  });

  describe("copyLineTo", () => {
    it("doesn't copy anything when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      const output = new StringWriter();
      expect(await scanner.copyLineTo(output)).toBe(true);
      expect(output.buffer).toEqual("");
    });

    it("copies everything when there's no newline", async () => {
      const input = fc.unicodeString().filter((s) => !s.includes("\n"));
      await fc.assert(
        fc.asyncProperty(anyChunksOf(input), async ({ original, chunks }) => {
          const scanner = new Scanner(new TestReader(chunks));
          const output = new StringWriter();
          expect(await scanner.copyLineTo(output)).toBe(true);
          expect(output.buffer).toEqual(original);
        }),
      );
    });

    it("copies everything up to the first newline newline, leaving the rest", async () => {
      const input = concat(
        fc.unicodeString(),
        fc.constant("\n"),
        fc.unicodeString(),
      );
      await fc.assert(
        fc.asyncProperty(anyChunksOf(input), async ({ original, chunks }) => {
          const scanner = new Scanner(new TestReader(chunks));
          const output = new StringWriter();
          expect(await scanner.copyLineTo(output)).toBe(true);

          const end = original.indexOf("\n") + 1;
          const firstLine = original.slice(0, end);
          expect(output.buffer).toEqual(firstLine);

          while (await scanner.pull()) {}
          expect(scanner.buffer).toEqual(original.slice(end));
        }),
      );
    });
  });
});
