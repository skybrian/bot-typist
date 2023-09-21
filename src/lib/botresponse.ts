import { DONE, Reader, ReadResult, WriteCloser, Writer } from "./streams";
import { Scanner } from "./scanner";

export const allLanguages = ["python", "typescript"] as const;

export const allCellTypes = ["markdown", ...allLanguages] as const;

type CellType = typeof allCellTypes[number];

export interface HeaderLine {
  type: CellType;
  line: string;
}

export interface CellWriter extends WriteCloser<boolean> {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

export const CANCELLED = Symbol("CANCELLED");

export class BotResponse {
  #stream: Scanner;
  #defaultCue: string;

  constructor(stream: Reader, defaultCue = "bot") {
    this.#stream = new Scanner(stream);
    this.#defaultCue = defaultCue;
  }

  /**
   * Copies the rest of the response to a CellWriter, as it comes in.
   *
   * Initially, output is assumed to be within a markdown cell.
   * Splits input into cells and sends them separately to the output.
   * Cells are separated by lines starting with '%'.
   * The '%' should be followed by the cell type, e.g. '%python'.
   * Currently supports python, typescript, and markdown cells.
   *
   * @throws CANCELLED if the writer cancelled the copy.
   */
  async copy(output: CellWriter): Promise<void> {
    // skip blank lines at start of response before checking for end
    await this.skipBlankLines();

    if (this.atEnd) {
      if (!await output.write(`${this.#defaultCue}: (no response)`)) {
        throw CANCELLED;
      }
      return;
    }

    let header = await this.matchHeaderLine();
    if (!header) {
      // no header; assume markdown
      // TODO: send cell start?
      await this.copyMarkdown(output);

      if (this.atEnd) {
        return;
      }

      header = await this.matchHeaderLine();
      if (!header) {
        // copyMarkdown shouldn't have stopped here
        throw new Error("expected a header line");
      }
    }

    while (true) {
      this.#stream.skipToken(header.line);

      if (header.type === "markdown") {
        await output.startMarkdownCell();
        await this.skipBlankLines();
        await this.copyMarkdown(output);
      } else {
        await output.startCodeCell();
        await this.skipBlankLines();
        await this.copyCodeCell(output);
      }

      if (this.atEnd) {
        return;
      }

      header = await this.matchHeaderLine();
      if (!header) {
        throw new Error("expected a header line");
      }
    }
  }

  get atEnd(): boolean {
    return this.#stream.atEnd;
  }

  async skipBlankLines(): Promise<void> {
    while (await this.#stream.takeBlankLine()) {}
  }

  async matchHeaderLine(): Promise<HeaderLine | null> {
    for (const lang of allCellTypes) {
      const header = `%${lang}\n`;
      if (await this.#stream.startsWith(header)) {
        return { type: lang, line: header };
      }
    }
    return null;
  }

  async copyOrAddCue(output: Writer): Promise<void> {
    await this.#stream.takeMatchingPrefix(" \t");
    let name = await takeLabel(this.#stream);
    if (name && await this.#stream.skipToken(": ")) {
      // already present
      if (!await output.write(name + ": ")) {
        throw CANCELLED;
      }
    } else {
      // add it
      if (!await output.write(this.#defaultCue + ": " + name)) {
        throw CANCELLED;
      }
    }
  }

  async skipCodeBlockHeader() {
    for (const lang of allLanguages) {
      if (await this.#stream.skipToken("```" + lang + "\n")) {
        return true;
      }
    }
    return false;
  }

  async startsWithCodeBlockHeader() {
    for (const lang of allLanguages) {
      if (await this.#stream.startsWith("```" + lang + "\n")) {
        return true;
      }
    }
    return false;
  }

  async copyMarkdown(output: CellWriter): Promise<void> {
    if (await this.skipCodeBlockHeader()) {
      await this.copyCodeBlock(output);
    } else {
      await this.copyOrAddCue(output);
    }

    while (!this.#stream.atEnd && !await this.matchHeaderLine()) {
      if (await this.skipCodeBlockHeader()) {
        await this.copyCodeBlock(output);
      } else if (!await this.#stream.copyLineTo(output)) {
        throw CANCELLED;
      }
    }
  }

  async copyCodeBlock(output: CellWriter): Promise<void> {
    await output.startCodeCell();

    while (true) {
      if (this.atEnd) {
        return;
      } else if (await this.#stream.startsWith("```")) {
        const line = await this.#stream.takeLine();
        if (/^```[ \t]*\n?$/.test(line)) {
          break; // found end of codeblock
        }

        if (!await output.write(line)) {
          throw CANCELLED;
        }
      } else {
        if (!await this.#stream.copyLineTo(output)) {
          throw CANCELLED;
        }
      }
    }

    await this.skipBlankLines();
    if (
      !this.atEnd && !await this.matchHeaderLine() &&
      !await this.startsWithCodeBlockHeader()
    ) {
      await output.startMarkdownCell();
      await this.copyOrAddCue(output);
    }
  }

  async copyCodeCell(output: Writer): Promise<void> {
    while (!this.#stream.atEnd) {
      if (await this.matchHeaderLine()) {
        return;
      }
      if (!await this.#stream.copyLineTo(output)) {
        throw CANCELLED;
      }
    }
  }
}

export const checkCueLabel = async (input: string): Promise<boolean> => {
  if (input.trim() !== input || input === "") {
    return false;
  }

  let reads = 0;
  const reader: Reader = {
    read: function (): Promise<ReadResult> {
      reads++;
      if (reads === 1) {
        return Promise.resolve(input);
      } else {
        return Promise.resolve(DONE);
      }
    },
  };

  const scanner = new Scanner(reader);
  const label = await takeLabel(scanner);
  return label === input && scanner.atEnd;
};

const labelChars =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";

const takeLabel = async (stream: Scanner): Promise<string> => {
  let name = "";
  while (true) {
    const char = await stream.takeMatchingChar(labelChars);
    if (char) {
      name += char;
      continue;
    }
    const emoji = await stream.takeEmoji();
    if (emoji) {
      name += emoji;
      continue;
    }
    break;
  }
  return name;
};
