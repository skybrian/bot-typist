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
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export class BotResponse {
  #stream: Scanner;

  constructor(stream: Reader) {
    this.#stream = new Scanner(stream);
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
   * @returns false if the writer cancelled the copy.
   */
  async copy(output: CellWriter): Promise<boolean> {
    // skip blank lines at start of response before checking for end
    await this.skipBlankLines();

    if (this.atEnd) {
      if (!await output.write("bot: (no response)")) {
        return false;
      }
      return true;
    }

    let header = await this.matchHeaderLine();
    if (!header) {
      // no header; assume markdown
      // TODO: send cell start?
      if (!await this.copyMarkdown(output)) {
        return false;
      }

      if (this.atEnd) {
        return true;
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
          return false;
        }
      } else if (header.type === "python") {
        await output.startCodeCell();
        await this.skipBlankLines();
        if (!await this.copyPython(output)) {
          return false;
        }
      }

      if (this.atEnd) {
        return true;
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

  async copyOrAddCue(output: Writer, defaultName = "bot"): Promise<boolean> {
    await this.#stream.takeMatchingPrefix(" \t");
    const name = await this.#stream.takeMatchingPrefix(cueChars);
    if (name && await this.#stream.skipToken(": ")) {
      // already present
      return await output.write(name + ": ");
    } else {
      // add it
      return await output.write(defaultName + ": " + name);
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

    while (!await this.#stream.skipToken("```\n")) {
      if (this.atEnd) {
        return true;
      }

      if (!await this.#stream.copyLineTo(output)) {
        return false;
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
