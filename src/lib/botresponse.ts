import { Reader, WriteCloser, Writer } from "./streams";
import { Scanner } from "./scanner";

export const allCellTypes = ["markdown", "python"] as const;

type CellType = typeof allCellTypes[number];

export interface HeaderLine {
  type: CellType;
  line: string;
}

export interface CellWriter extends WriteCloser<boolean> {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

const cueChars =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";

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
   * Currently supports python and markdown cells.
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
      if (!await this.copyMarkdown(output)) {
        throw CANCELLED;
      }

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
        if (!await this.copyMarkdown(output)) {
          throw CANCELLED;
        }
      } else if (header.type === "python") {
        await output.startCodeCell();
        await this.skipBlankLines();
        if (!await this.copyPython(output)) {
          throw CANCELLED;
        }
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
    if (await this.#stream.startsWith("%python\n")) {
      return { type: "python", line: "%python\n" };
    } else if (await this.#stream.startsWith("%markdown\n")) {
      return { type: "markdown", line: "%markdown\n" };
    } else {
      return null;
    }
  }

  async copyOrAddCue(output: Writer): Promise<boolean> {
    await this.#stream.takeMatchingPrefix(" \t");
    let name = "";
    while (true) {
      const char = await this.#stream.takeMatchingChar(cueChars);
      if (char) {
        name += char;
        continue;
      }
      const emoji = await this.#stream.takeEmoji();
      if (emoji) {
        name += emoji;
        continue;
      }
      break;
    }
    if (name && await this.#stream.skipToken(": ")) {
      // already present
      return await output.write(name + ": ");
    } else {
      // add it
      return await output.write(this.#defaultCue + ": " + name);
    }
  }

  async copyMarkdown(output: CellWriter): Promise<boolean> {
    if (await this.#stream.skipToken("```python\n")) {
      if (!await this.copyCodeBlock(output)) {
        return false;
      }
    } else {
      if (!await this.copyOrAddCue(output)) {
        return false;
      }
    }

    while (!this.#stream.atEnd && !await this.matchHeaderLine()) {
      if (await this.#stream.skipToken("```python\n")) {
        if (!await this.copyCodeBlock(output)) {
          return false;
        }
      } else if (!await this.#stream.copyLineTo(output)) {
        return false;
      }
    }
    return true;
  }

  async copyCodeBlock(output: CellWriter): Promise<boolean> {
    await output.startCodeCell();

    while (true) {
      if (this.atEnd) {
        return true;
      } else if (await this.#stream.startsWith("```")) {
        const line = await this.#stream.takeLine();
        if (/^```[ \t]*\n?$/.test(line)) {
          break; // found end of codeblock
        }

        if (!await output.write(line)) {
          return false;
        }
      } else {
        if (!await this.#stream.copyLineTo(output)) {
          return false;
        }
      }
    }

    await this.skipBlankLines();
    if (
      !this.atEnd && !await this.matchHeaderLine() &&
      !await this.#stream.startsWith("```python\n")
    ) {
      await output.startMarkdownCell();
      if (!await this.copyOrAddCue(output)) {
        return false;
      }
    }
    return true;
  }

  async copyPython(output: Writer): Promise<boolean> {
    while (!this.#stream.atEnd) {
      if (await this.matchHeaderLine()) {
        return true;
      }
      if (!await this.#stream.copyLineTo(output)) {
        return false;
      }
    }
    return true;
  }
}
