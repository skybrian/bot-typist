import expect from "expect";
import * as fc from "fast-check";
import { Scanner, CellWriter, handleBotResponse } from "../../lib/parsers";
import { DONE, Reader, ReadResult } from "../../lib/streams";

class TestReader implements Reader {
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

const anyChunks = fc.array(fc.unicodeString({minLength: 1}));

const anyChunksAndOffset = anyChunks.chain((chunks) => {
  const offset = fc.integer({min: 0, max: chunks.join("").length});
  return fc.tuple(fc.constant(chunks), offset);
});

describe("Scanner", () => {
  describe("pull", () => {
    it("returns false when there's no more input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.pull()).toBe(false);
    });

    it("appends each chunks to the buffer, one at a time", async () => {
      await fc.assert(fc.asyncProperty(anyChunks, async (chunks) => {
        const scanner = new Scanner(new TestReader(chunks));
        let pulls = 0;
        while (pulls < chunks.length) {
          expect(await scanner.pull()).toBe(true);
          pulls++;
          expect(scanner.buffer).toEqual(chunks.slice(0, pulls).join(""));
        }
        expect(await scanner.pull()).toBe(false);
        expect(scanner.buffer).toEqual(chunks.join(""));
      }));
    });
  });

  describe("fillTo", () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.fillTo(1)).toBe(false);
    });

    it("returns false when there's not enough input", async () => {
      await fc.assert(fc.asyncProperty(fc.tuple(anyChunks, fc.integer({min: 1, max: 1000})), async ([chunks, n]) => {
        const scanner = new Scanner(new TestReader(chunks));
        expect(await scanner.fillTo(chunks.join("").length + n)).toBe(false);
        expect(scanner.buffer).toEqual(chunks.join(""));
      }));
    });

    it("adds at least the specified number of characters to the buffer", async () => {
      await fc.assert(fc.asyncProperty(anyChunksAndOffset, async ([chunks, offset]) => {
        const scanner = new Scanner(new TestReader(chunks));
        expect(await scanner.fillTo(offset)).toBe(true);
        expect(scanner.buffer.length).toBeGreaterThanOrEqual(offset);
        expect(scanner.buffer).toEqual(chunks.join("").slice(0, scanner.buffer.length));
      }));
    });
  });

  describe("hasLine", () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(scanner.hasLine).toBe(false);
    });

    it("returns false until there's a newline in the buffer", async () => {
      await fc.assert(fc.asyncProperty(anyChunks, async (chunks) => {
        const scanner = new Scanner(new TestReader(chunks));
        const input = chunks.join("");
        const newline = input.indexOf("\n");
        while (await scanner.pull()) {
          expect(scanner.hasLine).toBe(newline >= 0 && scanner.buffer.length > newline);
        } 
      }));
    });
  });

  describe("take", () => {
    it("returns the entire buffer", async () => {
      await fc.assert(fc.asyncProperty(anyChunks, async (chunks) => {
        const scanner = new Scanner(new TestReader(chunks));
        while (await scanner.pull()) {
          const buf = scanner.buffer;
          expect(scanner.take()).toEqual(buf);
          expect(scanner.buffer).toEqual("");
        }
      }));
    });
  });

  describe("takeLine", () => {
    it("returns false when there's no input", async () => { 
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.takeLine()).toBe(false);
    });

    it("returns each complete line from the input", async () => {
      await fc.assert(fc.asyncProperty(anyChunks, async (chunks) => {
        const scanner = new Scanner(new TestReader(chunks));
        const input = chunks.join("");
        const lines = input.split("\n");
        for (const line of lines.slice(0, -1)) {
          expect(await scanner.takeLine()).toEqual(line + "\n");
        }
        expect(await scanner.takeLine()).toBe(false);;
      }));
    });
  });

  describe("takeBlankLine", async () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      expect(await scanner.takeBlankLine()).toBe(false);
    });

    it("takes the first line if it's blank", async () => {
      await fc.assert(fc.asyncProperty(anyChunks, async (chunks) => {
        const scanner = new Scanner(new TestReader(chunks));
        const input = chunks.join("");
        
        const lines = input.split("\n");
        if (lines.length === 1) {
          // no newline in input
          expect(await scanner.takeBlankLine()).toBe(false);
          expect(scanner.buffer).toEqual(input.substring(0, scanner.buffer.length));
          return;
        }

        const result = await scanner.takeBlankLine();
        if (lines[0].trim() === "") {
          expect(result).toEqual(lines[0] + "\n");
          if (lines.length > 2) {
            expect(scanner.takeLine()).toEqual(lines[1] + "\n");
          } else {
            expect(await scanner.takeLine()).toEqual(lines[1]);
          }
        } else {
          expect(result).toBe(false);
          expect(scanner.buffer).toEqual(input.slice(0, scanner.buffer.length));
        }
      }));
    });
  });

  describe("startsWith", () => {
    it("returns true when the prefix is empty", async () => {
      await fc.assert(fc.asyncProperty(anyChunks, async (chunks) => {
        const scanner = new Scanner(new TestReader(chunks));
        expect(await scanner.startsWith("")).toBe(true);
      }));
    });

    it("returns false when there's no input", async () => {
      await fc.assert(fc.asyncProperty(fc.unicodeString({minLength: 1}), async (prefix) => {
        const scanner = new Scanner(new TestReader([]));
        expect(await scanner.startsWith(prefix)).toBe(false);
      }));
    });
    
    it("returns true when the input starts with the prefix", async () => {
      await fc.assert(fc.asyncProperty(anyChunksAndOffset, async ([chunks, offset]) => {
        const scanner = new Scanner(new TestReader(chunks));
        const input = chunks.join("");
        const prefix = input.slice(0, offset);
        expect(await scanner.startsWith(prefix)).toBe(true);
      }));
    });

    it("returns false when the input doesn't start with the prefix", async () => {
      await fc.assert(fc.asyncProperty(anyChunksAndOffset, async ([chunks, offset]) => {
        if (offset === chunks.join("").length) {
          return;
        }
        const scanner = new Scanner(new TestReader(chunks));
        const input = chunks.join("");
        const prefix = input.slice(0, offset);
        const next = input.slice(offset, offset + 1);
        const other = next === "x" ? "y" : "x";
        expect(await scanner.startsWith(prefix + other)).toBe(false);
      }));
    });
  });
});

interface Cell {
  lang: string;
  text: string;
}

class TestCellWriter implements CellWriter {
  cells: Cell[] = [{ lang: "python", text: "" }];
  done = false;

  async write(text: string): Promise<boolean> {
    if (this.done) {
      throw new Error("write after done");
    }
    const cell = this.cells[this.cells.length - 1];
    cell.text += text;
    return true;
  }

  async startCodeCell(): Promise<boolean> {
    if (this.done) {
      throw new Error("startCodeCell after done");
    }
    this.cells.push({ lang: "python", text: "" });
    return true;
  }

  async startMarkdownCell(): Promise<boolean> {
    if (this.done) {
      throw new Error("startMarkdownCell after done");
    }
    this.cells.push({ lang: "markdown", text: "" });
    return true;
  }

  async close(): Promise<boolean> {
    if (this.done) {
      throw new Error("close after done");
    }
    this.done = true;
    return true;
  }

  check(expected: Cell[]) {
    expect(this.cells).toEqual(expected);
  }
}

describe("handleBotResponse", () => {
  let reader = new TestReader([]);
  let writer = new TestCellWriter();

  beforeEach(async () => {
    reader = new TestReader([]);
    writer = new TestCellWriter();
  });

  it("does nothing when there's no input", async () => {
    await handleBotResponse(writer)(reader);
    writer.check([{ lang: "python", text: "" }]);
  });

  it("copies text as-is when there are no cell markers", async () => {
    reader = new TestReader(["Hello, ", "world!"]);
    await handleBotResponse(writer)(reader);
    writer.check([
      { lang: "python", text: "Hello, world!" },
    ]);
  });

  it("starts new cells for cell markers", async () => {
    reader = new TestReader(["%python\n", "x = 1\n", "%markdown\n", "Hi!"]);

    await handleBotResponse(writer)(reader);
    writer.check([
      { lang: "python", text: "" },
      { lang: "python", text: "x = 1\n" },
      { lang: "markdown", text: "Hi!" },
    ]);
  });

  it("removes blank lines at the start of a cell", async () => {
    reader = new TestReader(["%python\n", "\n \nx = 1\n\ny = 2"]);

    await handleBotResponse(writer)(reader);
    writer.check([
      { lang: "python", text: "" },
      { lang: "python", text: "x = 1\ny = 2" },
    ]);
  });
});
