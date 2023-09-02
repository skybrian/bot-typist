import * as assert from "assert";
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

describe("Scanner", () => {
  describe("pull", () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      assert(!await scanner.pull());
    });

    it("adds data to the buffer", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!"]));
      assert.ok(await scanner.pull());
      assert.strictEqual(scanner.buffer, "Hello, ");
      assert.ok(await scanner.pull());
      assert.strictEqual(scanner.buffer, "Hello, world!");
      assert(!await scanner.pull());
    });
  });

  describe("fillTo", () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      assert(!await scanner.fillTo(1));
    });

    it("adds at least the specified number of characters to the buffer when available", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!"]));
      assert.ok(await scanner.fillTo(1));
      assert.strictEqual(scanner.buffer, "Hello, ");
      assert.ok(await scanner.fillTo(7));
      assert.strictEqual(scanner.buffer, "Hello, ");
      assert.ok(await scanner.fillTo(8));
      assert.strictEqual(scanner.buffer, "Hello, world!");
    });

    it("returns false when there's not enough input", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!"]));
      assert(!await scanner.fillTo(100));
      assert.strictEqual(scanner.buffer, "Hello, world!");
    });
  });

  describe("hasLine", () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      assert(!scanner.hasLine);
    });

    it("returns false until there's a newline in the buffer", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!\n"]));
      assert.ok(await scanner.pull());
      assert(!scanner.hasLine);
      assert.ok(await scanner.pull());
      assert.ok(scanner.hasLine);
    });
  });

  describe("take", () => {
    it("returns the entire buffer", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!"]));
      assert.ok(await scanner.pull());
      assert.strictEqual(scanner.take(), "Hello, ");
      assert.strictEqual(scanner.buffer, "");
    });
  });

  describe("takeLine", () => {
    it("returns false when there's no input", async () => { 
      const scanner = new Scanner(new TestReader([]));
      assert.strictEqual(await scanner.takeLine(), false);
    });

    it("returns the first line from input", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!\nMore text\n"]));
      assert.strictEqual(await scanner.takeLine(), "Hello, world!\n");
      assert.strictEqual(scanner.buffer, "More text\n");
    });
  });

  describe("takeBlankLine", async () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      assert.strictEqual(await scanner.takeBlankLine(), false);
    });

    it("returns false when the next line is not blank", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!\nMore text\n"]));
      assert.strictEqual(await scanner.takeBlankLine(), false);
      assert.strictEqual(scanner.buffer, "Hello, ");
    });

    it("returns the first blank line from input", async () => {
      const scanner = new Scanner(new TestReader(["\n \nHello"]));
      assert.strictEqual(await scanner.takeBlankLine(), "\n");
      assert.strictEqual(await scanner.takeBlankLine(), " \n");
      assert.strictEqual(scanner.buffer, "Hello");
    });
  });

  describe("startsWith", () => {
    it("returns false when there's no input", async () => {
      const scanner = new Scanner(new TestReader([]));
      assert(!await scanner.startsWith("Hello"));
    });
    
    it("returns false when the input doesn't start with the prefix", async () => {
      const scanner = new Scanner(new TestReader(["Hello, world!"]));
      assert(!await scanner.startsWith("Hi"));
    });

    it("returns true when the input starts with the prefix", async () => {
      const scanner = new Scanner(new TestReader(["Hello, ", "world!"]));
      assert.ok(await scanner.startsWith("Hello, wor"));
      assert.strictEqual(scanner.buffer, "Hello, world!");
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
    assert.deepStrictEqual(this.cells, expected);
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
