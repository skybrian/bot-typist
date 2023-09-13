import { sleep } from "../../lib/async";
import expect from "expect";
import * as fc from "fast-check";
import { anyChunksOf, concat, TestReader } from "../lib/testinput";

import { allCellTypes, BotResponse, CellWriter } from "../../lib/botresponse";

import { StringWriter } from "../../lib/streams";

interface Cell {
  lang: string;
  text: string;
}

class TestCellWriter implements CellWriter {
  cells: Cell[] = [];
  writing = false;
  done = false;

  async write(text: string): Promise<boolean> {
    if (this.writing) {
      throw new Error("already writing");
    }
    this.writing = true;
    await sleep(0);

    try {
      if (this.done) {
        throw new Error("write after done");
      }
      if (this.cells.length === 0) {
        this.cells.push({ lang: "markdown", text: "" });
      }
      this.cells[this.cells.length - 1].text += text;
      return true;
    } finally {
      this.writing = false;
    }
  }

  async startCodeCell(): Promise<boolean> {
    if (this.writing) {
      throw new Error("already writing");
    }
    this.writing = true;
    await sleep(0);

    try {
      if (this.done) {
        throw new Error("startCodeCell after done");
      }
      this.cells.push({ lang: "python", text: "" });
      return true;
    } finally {
      this.writing = false;
    }
  }

  async startMarkdownCell(): Promise<boolean> {
    if (this.writing) {
      throw new Error("already writing");
    }
    this.writing = true;
    await sleep(0);

    try {
      if (this.done) {
        throw new Error("startMarkdownCell after done");
      }
      this.cells.push({ lang: "markdown", text: "" });
      return true;
    } finally {
      this.writing = false;
    }
  }

  async close(): Promise<boolean> {
    if (this.writing) {
      throw new Error("already writing");
    }
    this.writing = true;
    await sleep(0);

    try {
      if (this.done) {
        throw new Error("close after done");
      }
      this.done = true;
      return true;
    } finally {
      this.writing = false;
    }
  }
}

const anyWhitespace = fc.stringOf(fc.constantFrom(" ", "\t"));

describe("BotResponse", () => {
  describe("matchHeaderLine", () => {
    it("returns null if there's no input", async () => {
      const response = new BotResponse(new TestReader([]));
      expect(await response.matchHeaderLine()).toBe(null);
    });

    it("returns null if there's no match", async () => {
      const input = fc.unicodeString().filter((s) =>
        !s.startsWith("%python\n") && !s.startsWith("%markdown\n")
      );

      await fc.assert(
        fc.asyncProperty(anyChunksOf(input), async ({ chunks }) => {
          const response = new BotResponse(new TestReader(chunks));
          expect(await response.matchHeaderLine()).toBe(null);
        }),
      );
    });

    for (const type of allCellTypes) {
      it(`matches header: %${type}`, async () => {
        const chunked = anyChunksOf(fc.constant(`%${type}\n`));
        const expected = { type, line: `%${type}\n` };

        await fc.assert(fc.asyncProperty(chunked, async ({ chunks }) => {
          const response = new BotResponse(new TestReader(chunks));
          expect(await response.matchHeaderLine()).toStrictEqual(expected);
        }));
      });
    }
  });

  describe("copyPython", () => {
    it("copies nothing if there's no input", async () => {
      const response = new BotResponse(new TestReader([]));
      const writer = new StringWriter();
      await response.copyPython(writer);
      expect(writer.buffer).toBe("");
    });

    const allHeaders = new Set(allCellTypes.map((t) => `%${t}`));
    const nonNewline = fc.unicode().filter((s) => s !== "\n");
    const nonHeaderLine = fc.stringOf(nonNewline).filter((s) =>
      !allHeaders.has(s)
    );
    const nonHeaderText = fc.stringOf(
      fc.oneof(nonHeaderLine, fc.constant("\n")),
    );

    it("copies arbitrary text when there's no cell header", async () => {
      const chunked = anyChunksOf(nonHeaderText);

      await fc.assert(
        fc.asyncProperty(chunked, async ({ original, chunks }) => {
          const response = new BotResponse(new TestReader(chunks));
          const writer = new StringWriter();
          await response.copyPython(writer);
          expect(writer.buffer).toBe(original);
        }),
      );
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
          const response = new BotResponse(new TestReader(chunks));
          const writer = new StringWriter();
          await response.copyPython(writer);
          expect(writer.buffer).toBe(original);
        }));
      });
    }
  });

  const anyLetter = fc.constantFrom(
    ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  );
  const anyDigit = fc.constantFrom(...Array.from("0123456789"));
  const anyCueChar = fc.oneof(anyLetter, anyDigit, fc.constantFrom("🤖", " "));
  const anyCue = fc.stringOf(anyCueChar, { minLength: 1 }).filter((s) =>
    s.trim() === s
  ).map((s) => s + ": ");

  describe("copyOrAddCue", () => {
    it("writes the default cue when there's no input", async () => {
      const response = new BotResponse(new TestReader([]), "🤖 bot");
      const writer = new StringWriter();
      await response.copyOrAddCue(writer);
      expect(writer.buffer).toBe("🤖 bot: ");
    });

    it("removes any leading whitespace from the input", async () => {
      const chunked = anyChunksOf(anyWhitespace);

      await fc.assert(fc.asyncProperty(chunked, async ({ chunks }) => {
        const response = new BotResponse(new TestReader(chunks));
        const writer = new StringWriter();
        await response.copyOrAddCue(writer);
        expect(writer.buffer).toBe("bot: ");
        expect(response.atEnd).toBe(true);
      }));
    });

    it("doesn't add a cue if there's already one", async () => {
      const input = concat(anyCue, fc.unicodeString());
      const chunked = anyChunksOf(input);
      await fc.assert(
        fc.asyncProperty(chunked, async ({ original, chunks }) => {
          const response = new BotResponse(new TestReader(chunks));
          const writer = new StringWriter();
          await response.copyOrAddCue(writer);
          const originalCue = original.slice(0, original.indexOf(": ") + 2);
          expect(writer.buffer).toEqual(originalCue);
        }),
      );
    });

    it("adds the default cue if there's no cue", async () => {
      const input = fc.unicodeString().filter((s) =>
        !s.match(/^[a-zA-Z0-9]+: /)
      );
      const chunked = anyChunksOf(input);
      await fc.assert(
        fc.asyncProperty(chunked, async ({ original, chunks }) => {
          const response = new BotResponse(new TestReader(chunks));
          const writer = new StringWriter();
          await response.copyOrAddCue(writer);
          expect(writer.buffer.length).toBeGreaterThan(4);
          const expected = ("bot: " + original).slice(0, writer.buffer.length);
          expect(writer.buffer).toBe(expected);
        }),
      );
    });
  });

  describe("copy", () => {
    it("writes a message when there's no response", async () => {
      const reader = new TestReader([]);
      const writer = new TestCellWriter();
      const response = new BotResponse(reader, "robot");
      await response.copy(writer);
      expect(writer.cells).toEqual([{
        "lang": "markdown",
        "text": "robot: (no response)",
      }]);
    });

    const anyNonCue = fc.unicodeString({ minLength: 1 }).map((s) => s.trim())
      .filter((s) => s.length > 0).filter((s) => !s.match(/^[a-zA-Z0-9]+: /));

    it("adds a bot prompt if it's not there", async () => {
      await fc.assert(fc.asyncProperty(anyNonCue, async ([text]) => {
        const reader = new TestReader([text]);
        const writer = new TestCellWriter();
        await new BotResponse(reader).copy(writer);
        expect(writer.cells).toEqual([{
          lang: "markdown",
          text: `bot: ${text}`,
        }]);
      }));
    });

    const anyCue = fc.constantFrom("a: ", "bot: ", "gpt4: ", "42: ");

    it("doesn't add a bot prompt if a prompt is already there", async () => {
      const input = concat(
        anyWhitespace,
        anyCue,
        anyWhitespace,
        anyNonCue,
      );

      await fc.assert(fc.asyncProperty(input, async (text) => {
        const reader = new TestReader([text]);
        const writer = new TestCellWriter();
        await new BotResponse(reader).copy(writer);
        const expected = text.trimStart();
        expect(writer.cells).toEqual([{ lang: "markdown", text: expected }]);
      }));
    });

    const anyCellText = fc.unicodeString({ minLength: 1 }).map((s) =>
      s.trim() + "\n"
    ).filter((s) =>
      s.length > 1 &&
      !s.startsWith("%python\n") &&
      !s.startsWith("%markdown\n") &&
      !s.startsWith("```python\n") &&
      !s.includes("\n%python\n") &&
      !s.includes("\n%markdown\n") &&
      !s.includes("\n```python\n")
    );

    const anyBlankLines = fc.stringOf(anyWhitespace.map((s) => s + "\n"), {
      minLength: 1,
    });

    const anyPythonWithHeader = anyCellText.chain((output) => {
      const normalBlock = anyBlankLines.map((blanks) =>
        `%python\n${blanks}${output}`
      );
      const cell: Cell = { lang: "python", text: output };
      return normalBlock.map((input) => {
        return { input, cell };
      });
    });

    const anyPythonInCodeBlock = anyCellText.chain((output) => {
      const codeBlock = anyWhitespace.map((space) =>
        "```python\n" + output + "```" + space + "\n"
      );
      const cell: Cell = { lang: "python", text: output };
      return codeBlock.map((input) => {
        return { input, cell };
      });
    });

    it("copies a Python cell by itself", async () => {
      const anyPython = fc.oneof(anyPythonWithHeader, anyPythonInCodeBlock);
      const args = anyPython.chain(({ input, cell }) =>
        anyChunksOf(fc.constant(input)).map((chunked) => ({ chunked, cell }))
      );

      await fc.assert(
        fc.asyncProperty(args, async ({ chunked, cell }) => {
          const reader = new TestReader(chunked.chunks);
          const writer = new TestCellWriter();
          await new BotResponse(reader).copy(writer);
          expect(writer.cells).toEqual([cell]);
        }),
      );
    });

    const anyMarkdownText = concat(
      anyCue,
      anyCellText.filter((s) => !s.match(/^[a-zA-Z0-9]+: /)),
    );

    const anyMarkdownParseWithHeader = anyMarkdownText.chain((output) => {
      const cell: Cell = { lang: "markdown", text: output };

      const inputText = output.startsWith("bot: ")
        ? fc.constantFrom(output, output.slice(4))
        : fc.constant(output);

      const input = fc.tuple(anyBlankLines, inputText).map(([blanks, text]) =>
        `%markdown\n${blanks}${text}`
      );

      return input.map((text) => ({ input: text, cell }));
    });

    it("copies a Markdown cell by itself", async () => {
      const args = anyMarkdownParseWithHeader.chain(({ input, cell }) =>
        anyChunksOf(fc.constant(input)).map((chunked) => ({ chunked, cell }))
      );

      await fc.assert(
        fc.asyncProperty(args, async ({ chunked, cell }) => {
          const reader = new TestReader(chunked.chunks);
          const writer = new TestCellWriter();
          await new BotResponse(reader).copy(writer);
          expect(writer.cells).toEqual([cell]);
        }),
      );
    });

    const anyMarkdownParseWithoutHeader = anyMarkdownText.chain((output) => {
      const cell: Cell = { lang: "markdown", text: output };

      const inputText = output.startsWith("bot: ")
        ? fc.constantFrom(output, output.slice(4))
        : fc.constant(output);
      const input = concat(anyBlankLines, inputText);

      return input.map((text) => ({ input: text, cell }));
    });

    it("copies a Python cell block followed by a Markdown text (without a header)", async () => {
      const args: fc.Arbitrary<{ input: string; cell: Cell }[]> = fc.tuple(
        anyPythonInCodeBlock,
        anyMarkdownParseWithoutHeader,
      );

      await fc.assert(
        fc.asyncProperty(args, async ([cell1, cell2]) => {
          const reader = new TestReader([cell1.input, cell2.input]);
          const writer = new TestCellWriter();
          await new BotResponse(reader).copy(writer);
          expect(writer.cells).toEqual([cell1.cell, cell2.cell]);
        }),
      );
    });

    it("copies a Python code block followed by a Markdown cell", async () => {
      const args: fc.Arbitrary<{ input: string; cell: Cell }[]> = fc.tuple(
        anyPythonInCodeBlock,
        anyMarkdownParseWithHeader,
      );
      await fc.assert(
        fc.asyncProperty(anyCellsAndChunks, async ([cells, chunks]) => {
          const reader = new TestReader(chunks);
          const writer = new TestCellWriter();
          await new BotResponse(reader).copy(writer);
          expect(writer.cells).toEqual(cells);
        }),
      );
    });

    const anyCellCluster: fc.Arbitrary<{ input: string; cell: Cell }[]> = fc
      .oneof(
        anyPythonWithHeader.map((s) => [s]),
        anyMarkdownParseWithHeader.map((s) => [s]),
        fc.tuple(anyMarkdownParseWithHeader, anyPythonInCodeBlock),
      );

    const anyCellParses = fc.array(anyCellCluster, {
      minLength: 1,
      maxLength: 3,
    }).map((a) => a.flat());

    const anyCellsAndChunks = anyCellParses.chain<[Cell[], string[]]>(
      (parses) => {
        const cells = parses.map(({ cell }) => cell);
        const input = parses.map(({ input }) => input).join("");
        const chunked = anyChunksOf(fc.constant(input));
        return chunked.map(({ chunks }) => [cells, chunks]);
      },
    );

    it("copies multiple cells", async function () {
      await fc.assert(
        fc.asyncProperty(anyCellsAndChunks, async ([cells, chunks]) => {
          const reader = new TestReader(chunks);
          const writer = new TestCellWriter();
          await new BotResponse(reader).copy(writer);
          expect(writer.cells).toEqual(cells);
        }),
      );
    });
  });
});
