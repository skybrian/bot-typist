import expect from "expect";
import * as fc from "fast-check";
import { anyChunksOf, concat, TestReader } from "../lib/generators";

import {
  allCellTypes,
  CellWriter,
  copyCell,
  copyOrAddCue,
  handleBotResponse,
  matchHeaderLine,
} from "../../lib/parsers";

import { Scanner } from "../../lib/scanner";
import { StringWriter } from "../../lib/streams";

interface Cell {
  lang: string;
  text: string;
}

class TestCellWriter implements CellWriter {
  cells: Cell[] = [];
  done = false;

  async write(text: string): Promise<boolean> {
    if (this.done) {
      throw new Error("write after done");
    }
    if (this.cells.length === 0) {
      await this.startMarkdownCell();
    }
    this.cells[this.cells.length - 1].text += text;
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
}

describe("allCellTypes", () => {
  it("has all the cell types", () => {
    expect(allCellTypes).toEqual(["markdown", "python"]);
  });
});

describe("matchHeaderLine", () => {
  it("returns null if there's no input", async () => {
    const scanner = new Scanner(new TestReader([]));
    expect(await matchHeaderLine(scanner)).toBe(null);
  });

  it("returns null if there's no match", async () => {
    const input = fc.unicodeString().filter((s) =>
      !s.startsWith("%python\n") && !s.startsWith("%markdown\n")
    );

    await fc.assert(
      fc.asyncProperty(anyChunksOf(input), async ({ chunks }) => {
        const scanner = new Scanner(new TestReader(chunks));
        expect(await matchHeaderLine(scanner)).toBe(null);
      }),
    );
  });

  for (const type of allCellTypes) {
    it(`matches header: %${type}`, async () => {
      const chunked = anyChunksOf(fc.constant(`%${type}\n`));
      const expected = { type, line: `%${type}\n` };

      await fc.assert(fc.asyncProperty(chunked, async ({ chunks }) => {
        const scanner = new Scanner(new TestReader(chunks));
        expect(await matchHeaderLine(scanner)).toStrictEqual(expected);
      }));
    });
  }
});

describe("copyCell", () => {
  it("copies nothing if there's no input", async () => {
    const scanner = new Scanner(new TestReader([]));
    const writer = new StringWriter();
    expect(await copyCell(scanner, writer)).toBe(true);
    expect(writer.buffer).toBe("");
  });

  const allHeaders = new Set(allCellTypes.map((t) => `%${t}`));
  const nonNewline = fc.unicode().filter((s) => s !== "\n");
  const nonHeaderLine = fc.stringOf(nonNewline).filter((s) =>
    !allHeaders.has(s)
  );
  const nonHeaderText = fc.stringOf(fc.oneof(nonHeaderLine, fc.constant("\n")));

  it("copies arbitrary text when there's no cell header", async () => {
    const chunked = anyChunksOf(nonHeaderText);

    await fc.assert(fc.asyncProperty(chunked, async ({ original, chunks }) => {
      const reader = new Scanner(new TestReader(chunks));
      const writer = new StringWriter();
      expect(await copyCell(reader, writer)).toBe(true);
      expect(writer.buffer).toBe(original);
    }));
  });

  for (const header of allHeaders) {
    it(`stops copying at ${header}`, async () => {
      const args = nonHeaderText.chain((original) => {
        if (!original.endsWith("\n")) {
          original += "\n";
        }
        const input = original + header + "\nXXX";
        const chunked = anyChunksOf(fc.constant(input));
        return chunked.map(({ chunks }) => ({ original, chunks }));
      });

      await fc.assert(fc.asyncProperty(args, async ({ original, chunks }) => {
        const scanner = new Scanner(new TestReader(chunks));
        const writer = new StringWriter();
        expect(await copyCell(scanner, writer)).toBe(true);
        expect(writer.buffer).toBe(original);
      }));
    });
  }
});

const anyLetter = fc.constantFrom(
  ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"),
);
const anyDigit = fc.constantFrom(...Array.from("0123456789"));
const anyLettersOrDigits = fc.stringOf(fc.oneof(anyLetter, anyDigit), {
  minLength: 1,
});
const anyCue = anyLettersOrDigits.map((s) => s + ": ");

const anyWhitespace = fc.stringOf(fc.constantFrom(" ", "\t"));

describe("copyOrAddCue", () => {
  it("writes the default cue when there's no input", async () => {
    const scanner = new Scanner(new TestReader([]));
    const writer = new StringWriter();
    expect(await copyOrAddCue(scanner, writer)).toBe(true);
    expect(writer.buffer).toBe("bot: ");
  });

  it("removes any leading whitespace from the input", async () => {
    const chunked = anyChunksOf(anyWhitespace);

    await fc.assert(fc.asyncProperty(chunked, async ({ chunks }) => {
      const scanner = new Scanner(new TestReader(chunks));
      const writer = new StringWriter();
      expect(await copyOrAddCue(scanner, writer)).toBe(true);
      expect(writer.buffer).toBe("bot: ");
      expect(scanner.atEnd).toBe(true);
    }));
  });

  it("doesn't add a cue if there's already one", async () => {
    const input = concat(anyCue, fc.unicodeString());
    const chunked = anyChunksOf(input);
    await fc.assert(fc.asyncProperty(chunked, async ({ original, chunks }) => {
      const scanner = new Scanner(new TestReader(chunks));
      const writer = new StringWriter();
      expect(await copyOrAddCue(scanner, writer)).toBe(true);
      const originalCue = original.slice(0, original.indexOf(": ") + 2);
      expect(writer.buffer).toEqual(originalCue);
    }));
  });

  it("adds the default cue if there's no cue", async () => {
    const input = fc.unicodeString().filter((s) => !s.match(/^[a-zA-Z0-9]+: /));
    const chunked = anyChunksOf(input);
    await fc.assert(fc.asyncProperty(chunked, async ({ original, chunks }) => {
      const scanner = new Scanner(new TestReader(chunks));
      const writer = new StringWriter();
      expect(await copyOrAddCue(scanner, writer)).toBe(true);
      expect(writer.buffer.length).toBeGreaterThan(4);
      const expected = ("bot: " + original).slice(0, writer.buffer.length);
      expect(writer.buffer).toBe(expected);
    }));
  });
});

describe("handleBotResponse", () => {
  it("writes a message when there's no response", async () => {
    const reader = new TestReader([]);
    const writer = new TestCellWriter();
    await handleBotResponse(writer)(reader);
    expect(writer.cells).toEqual([{"lang": "markdown", "text": "bot: (no response)"}]);
  });

  const anyTrimmedText = fc.unicodeString({ minLength: 1 }).map((s) => s.trim())
    .filter((s) => s.length > 0);
  const anyNonCue = anyTrimmedText.filter((s) => !s.match(/^[a-zA-Z0-9]+: /));

  it("adds a bot prompt if it's not there", async () => {
    await fc.assert(fc.asyncProperty(anyNonCue, async ([text]) => {
      const reader = new TestReader([text]);
      const writer = new TestCellWriter();
      await handleBotResponse(writer)(reader);
      expect(writer.cells).toEqual([{
        lang: "markdown",
        text: `bot: ${text}`,
      }]);
    }));
  });

  const anyFirstLine = concat(
    anyCue,
    anyWhitespace,
    anyNonCue,
    anyWhitespace,
    fc.constant("\n"),
  );

  it("doesn't add a bot prompt if a prompt is already there", async () => {
    await fc.assert(fc.asyncProperty(anyFirstLine, async (text) => {
      const reader = new TestReader([text]);
      const writer = new TestCellWriter();
      await handleBotResponse(writer)(reader);
      const expected = text.trimStart();
      expect(writer.cells).toEqual([{ lang: "markdown", text: expected }]);
    }));
  });

  it("handles a Python cell by itself", async () => {
    const anyPythonText = fc.unicodeString({ minLength: 1 }).filter((s) =>
      !s.includes("%python\n") && s.trim() !== ""
    );
    const textAndChunks = anyPythonText.chain((text) =>
      fc.tuple(fc.constant(text), anyChunksOf(fc.constant(`%python\n${text}`)))
    );

    await fc.assert(
      fc.asyncProperty(textAndChunks, async ([original, chunked]) => {
        const reader = new TestReader(chunked.chunks);
        const writer = new TestCellWriter();
        await handleBotResponse(writer)(reader);
        expect(writer.cells).toEqual([{ lang: "python", text: original }]);
      }),
    );
  });

  const anyBlankLines = fc.stringOf(anyWhitespace.map((s) => s + "\n"), {
    minLength: 1,
  });

  const anyNonBlankLine = concat(
    anyWhitespace,
    anyTrimmedText,
    anyWhitespace,
    fc.constant("\n"),
  );

  const anyFirstParagraph = concat(anyFirstLine, fc.stringOf(anyNonBlankLine));
  const anyNextParagraph = fc.stringOf(anyNonBlankLine, { minLength: 1 });

  const anyMoreParagraphs = fc.stringOf(
    concat(anyBlankLines, anyNextParagraph),
  );
  const anyCellText = concat(anyFirstParagraph, anyMoreParagraphs);

  const anyCell = fc.record({
    lang: fc.constantFrom("python", "markdown"),
    text: anyCellText,
  });

  const anyCellAndInput: fc.Arbitrary<[Cell, string]> = fc.tuple(
    anyBlankLines,
    anyCell,
  ).map(([before, cell]) => {
    const header = `%${cell.lang}\n`;
    const text = cell.text.replace(/^bot: /, "");
    return [cell, header + before + text];
  });

  const anyCellsAndInput: fc.Arbitrary<[Cell[], string]> = fc.array(
    anyCellAndInput, { minLength: 1 },
  ).map((cellsAndInput) => {
    const cells = cellsAndInput.map(([cell, _]) => cell);
    const input = cellsAndInput.map(([_, input]) => input).join("");
    return [cells, input];
  });

  const anyCellsAndChunks = anyCellsAndInput.chain<[Cell[], string[]]>(
    ([cells, input]) => {
      const chunked = anyChunksOf(fc.constant(input));
      return chunked.map(({ chunks }) => [cells, chunks]);
    },
  );

  it("parses chunks into cells", async function () {
    this.timeout(10000);
    await fc.assert(
      fc.asyncProperty(anyCellsAndChunks, async ([cells, chunks]) => {
        const reader = new TestReader(chunks);
        const writer = new TestCellWriter();
        await handleBotResponse(writer)(reader);
        expect(writer.cells).toEqual(cells);
      }),
    );
  });
});
