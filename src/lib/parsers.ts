import { ReadFunction, WriteCloser, Writer } from "./streams";
import { Scanner } from "./scanner";

export interface CellWriter extends WriteCloser<boolean> {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

enum State {
  running,
  cancelled,
  done,
}

export enum CellType {
  markdown = "markdown",
  python = "python",
}

export const allCellTypes: CellType[] = Object.values(CellType) as CellType[];

export interface HeaderLine {
  type: CellType;
  line: string;
}

export const matchHeaderLine = async (
  scanner: Scanner,
): Promise<HeaderLine | null> => {
  if (await scanner.startsWith("%python\n")) {
    return { type: CellType.python, line: "%python\n" };
  } else if (await scanner.startsWith("%markdown\n")) {
    return { type: CellType.markdown, line: "%markdown\n" };
  } else {
    return null;
  }
};

export const copyCell = async (
  scanner: Scanner,
  output: Writer,
): Promise<boolean> => {
  while (!scanner.atEnd) {
    if (await matchHeaderLine(scanner)) {
      return true;
    }
    if (!await scanner.copyLineTo(output)) {
      return false;
    }
  }
  return true;
};

const cueChars =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const copyOrAddCue = async (
  scanner: Scanner,
  output: Writer,
  defaultName = "bot",
): Promise<boolean> => {
  const name = await scanner.takeMatchingPrefix(cueChars);
  if (name && await scanner.skipToken(": ")) {
    // already present
    return await output.write(name + ": ");
  } else {
    // add it
    return await output.write(defaultName + ": " + name);
  }
};

const copyMarkdownCell = async (
  scanner: Scanner,
  output: Writer,
): Promise<boolean> => {
  if (scanner.atEnd) {
    return true;
  }

  if (await matchHeaderLine(scanner)) {
    return true;
  }

  const indent = await scanner.takeMatchingPrefix(" \t");
  if (indent) {
    if (!await output.write(indent)) {
      return false;
    }
  }

  return await copyOrAddCue(scanner, output) && await copyCell(scanner, output);
};

/**
 * Splits input into cells and sends them to the output.
 * Cells are separated by lines starting with '%'.
 * The '%' should be followed by the cell type, e.g. '%python'.
 * Currently supports python and markdown cells.
 */
export const handleBotResponse =
  (output: CellWriter): ReadFunction<void> => async (input) => {
    const scanner = new Scanner(input);

    let inMarkdown = true;

    // Starts writing a cell.
    // Returns false if writing has been cancelled.
    const sendCellStart = async (type: CellType): Promise<boolean> => {
      switch (type) {
        case "markdown":
          inMarkdown = true;
          return await output.startMarkdownCell();
        case "python":
          inMarkdown = false;
          return await output.startCodeCell();
        default:
          throw new Error("unhandled cell type");
      }
    };

    const handleCell = async (): Promise<boolean> => {
      // skip blank lines at start of cell
      while (await scanner.takeBlankLine()) {}

      if (inMarkdown) {
        if (!await copyMarkdownCell(scanner, output)) {
          return false;
        }
      } else {
        if (!await copyCell(scanner, output)) {
          return false;
        }
      }

      const header = await matchHeaderLine(scanner);
      if (header) {
        scanner.skipToken(header.line);
        if (!await sendCellStart(header.type)) {
          return false;
        }
      }

      return true;
    };

    while (!scanner.atEnd) {
      if (!await handleCell()) {
        console.log("bot response cancelled");
        return;
      }
    }
    await output.close();
  };
