import { DONE, Reader, ReadFunction, WriteCloser } from "./streams";

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
export const splitCells =
  (output: CellWriter): ReadFunction<void> => async (input) => {
    let buffer = "";

    // Parse functions return false when there is no more input or output is cancelled.

    // Reads more input into the buffer.
    // Postcondition when true: buffer.length is greater than before.
    const pull = async (): Promise<boolean> => {
      while (true) {
        const chunk = await input.read();
        if (chunk === DONE) {
          return false;
        } else if (chunk !== "") {
          buffer += chunk;
          return true;
        }
      }
    };

    if (!await pull()) {
      return;
    }

    const sendCellStart = async (rest: string): Promise<boolean> => {
      switch (rest.trim()) {
        case "markdown":
          console.log("starting markdown cell");
          return output.startMarkdownCell();
        case "python":
          console.log("starting code cell");
          return output.startCodeCell();
        default:
          console.log(`Unknown cell type: ${rest.trim()}`);
          return output.write(`%${rest}`);
      }
    };

    // Reads a cell header line from the input and sets the cell type.
    // Precondition: buffer[0] is '%' at the start of a line.
    // Postcondition when true: buffer[0] is the start of the next line.
    const parseHeader = async (): Promise<boolean> => {
      while (!buffer.includes("\n")) {
        if (!await pull()) {
          await sendCellStart(buffer);
          return false;
        }
      }

      const end = buffer.indexOf("\n");
      const rest = buffer.slice(1, end);
      buffer = buffer.slice(end + 1);
      return sendCellStart(rest);
    };

    // Sends one line of text.
    // Precondition: buffer contains the start of a line (not empty).
    // Postcondition when true: buffer contains the start of the next line.
    const sendLine = async (): Promise<boolean> => {
      if (buffer[0] === "%") {
        return parseHeader();
      }
      while (!buffer.includes("\n")) {
        if (!await output.write(buffer)) {
          return false;
        }
        buffer = "";
        if (!await pull()) {
          return false;
        }
      }
      const nextStart = buffer.indexOf("\n") + 1;
      const lineEnd = buffer.slice(0, nextStart);
      buffer = buffer.slice(nextStart);

      if (!await output.write(lineEnd)) {
        return false;
      }
      if (buffer.length > 0) {
        return true;
      }
      return pull();
    };

    while (await sendLine()) {}
  };
