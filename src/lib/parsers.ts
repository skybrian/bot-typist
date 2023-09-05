import { ReadFunction, WriteCloser, Writer } from "./streams";
import { Scanner } from "./scanner";

export const allCellTypes = ["markdown", "python"] as const;

type CellType = typeof allCellTypes[number];

export interface HeaderLine {
  type: CellType;
  line: string;
}

export const matchHeaderLine = async (
  scanner: Scanner,
): Promise<HeaderLine | null> => {
  if (await scanner.startsWith("%python\n")) {
    return { type: "python", line: "%python\n" };
  } else if (await scanner.startsWith("%markdown\n")) {
    return { type: "markdown", line: "%markdown\n" };
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
  await scanner.takeMatchingPrefix(" \t");
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
  if (scanner.atEnd || await matchHeaderLine(scanner)) {
    return true;
  }

  return await copyOrAddCue(scanner, output) && await copyCell(scanner, output);
};

export interface CellWriter extends WriteCloser<boolean> {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

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

    const sendCells = async (): Promise<boolean> => {
      // skip blank lines at start of response before checking for end
      while (await scanner.takeBlankLine()) {}

      let cellCount = 0;
      while (!scanner.atEnd) {
        // skip blank lines at start of cell
        while (await scanner.takeBlankLine()) {}

        if (!await matchHeaderLine(scanner)) {
          // non-empty cell
          cellCount += 1;

          if (inMarkdown) {
            if (!await copyOrAddCue(scanner, output)) {
              return false;
            }
          }

          if (!await copyCell(scanner, output)) {
            return false;
          }
        } else {
          // empty cell. First one (implicitly markdown) doesn't count.
          if (cellCount > 0) {
            cellCount += 1;
          }
        }

        const header = await matchHeaderLine(scanner);
        if (header) {
          scanner.skipToken(header.line);
          if (!await sendCellStart(header.type)) {
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
    };

    if (!await sendCells()) {
      console.log("bot response cancelled");
      return;
    }
    await output.close();
  };
