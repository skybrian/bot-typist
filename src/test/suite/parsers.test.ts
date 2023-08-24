import assert = require("assert");
import { splitCells } from "../../lib/parsers";
import { CellWriter, DONE, Reader, ReadResult } from "../../lib/streams";

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

  cancel(): void {
    throw new Error("Method not implemented.");
  }
}

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

describe("splitCells", () => {
  let reader = new TestReader([]);
  let writer = new TestCellWriter();

  beforeEach(async () => {
    reader = new TestReader([]);
    writer = new TestCellWriter();
  });

  it("does nothing when there's no input", async () => {
    await splitCells(writer, reader);
    writer.check([{ lang: "python", text: "" }]);
  });

  it("copies text as-is when there are no cell markers", async () => {
    reader = new TestReader(["Hello, ", "world!"]);
    await splitCells(writer, reader);
    writer.check([
      { lang: "python", text: "Hello, world!" },
    ]);
  });

  it("starts new cells for cell markers", async () => {
    reader = new TestReader(["%python\n", "x = 1\n", "%markdown\n", "Hi!"]);

    await splitCells(writer, reader);
    writer.check([
      { lang: "python", text: "" },
      { lang: "python", text: "x = 1\n" },
      { lang: "markdown", text: "Hi!" },
    ]);
  });
});
