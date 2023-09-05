import { Reader, ReadFunction, WriteCloser, Writer } from "./streams";
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

    let inMarkdown = true;
    let cellCount = 0;
    while (!this.atEnd) {
      await this.skipBlankLines();

      if (!await this.matchHeaderLine()) {
        // non-empty cell
        cellCount += 1;

        if (inMarkdown) {
          if (!await this.copyOrAddCue(output)) {
            return false;
          }
        }

        if (!await this.copyCell(output)) {
          return false;
        }
      } else {
        // empty cell. First one (implicitly markdown) doesn't count.
        if (cellCount > 0) {
          cellCount += 1;
        }
      }

      const header = await this.matchHeaderLine();
      if (header) {
        inMarkdown = header.type === "markdown";
        if (!this.copyHeader(output)) {
          return false;
        }
      }
    }

    if (cellCount === 0) {
      if (!await output.write("bot: (no response)")) {
        return false;
      }
    }

    return true;
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

  async copyHeader(output: CellWriter): Promise<boolean> {
    const header = await this.matchHeaderLine();
    if (!header) {
      throw new Error("expected a header line");
    }
    this.#stream.skipToken(header.line);
    switch (header.type) {
      case "markdown":
        return await output.startMarkdownCell();
      case "python":
        return await output.startCodeCell();
      default:
        throw new Error("unhandled cell type");
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

  async copyCell(output: Writer): Promise<boolean> {
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
