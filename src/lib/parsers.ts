import { DONE, ReadFunction, WriteCloser } from "./streams";

export interface CellWriter extends WriteCloser<boolean> {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

enum State {
  running,
  cancelled,
  done
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

    // Reads more input into the buffer.
    // Returns false when writing is cancelled.
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

    // Starts writing a cell.
    // Returns false if writing has been cancelled.
    const sendCellStart = async (rest: string): Promise<boolean> => {
      switch (rest.trim()) {
        case "markdown":
          console.log("starting markdown cell");
          return await output.startMarkdownCell();
        case "python":
          console.log("starting code cell");
          return await output.startCodeCell();
        default:
          console.log(`Unknown cell type: ${rest.trim()}`);
          return await output.write(`%${rest}`);
      }
    };

    // Reads a cell header line from the input and sets the cell type.
    // Precondition: buffer[0] is '%' at the start of a line.
    // Postcondition if still running: buffer[0] is the start of the next line.
    const parseHeader = async (): Promise<State> => {
      while (!buffer.includes("\n")) {
        if (!await pull()) {
          // The input ended with a header line.
          // Ignore it and don't start a new cell.
          return State.done;
        }
      }

      const end = buffer.indexOf("\n");
      const rest = buffer.slice(1, end);
      buffer = buffer.slice(end + 1);
      return await sendCellStart(rest) ?  State.running : State.cancelled;
    };

    // Sends one line of text.
    // Precondition: buffer contains the start of a line (not empty).
    // Postcondition if still running: buffer contains the start of the next line.
    const sendLine = async (): Promise<State> => {
      if (buffer[0] === "%") {
        return parseHeader();
      }
      while (!buffer.includes("\n")) {
        if (!await output.write(buffer)) {
          return State.cancelled;
        }
        buffer = "";
        if (!await pull()) {
          return State.done;
        }
      }
      const nextStart = buffer.indexOf("\n") + 1;
      const lineEnd = buffer.slice(0, nextStart);
      buffer = buffer.slice(nextStart);

      if (!await output.write(lineEnd)) {
        return State.cancelled;
      }
      if (buffer.length > 0) {
        return State.running;
      }
      return await pull() ? State.running : State.done;
    };

    while (true) {
      switch (await sendLine()) {
        case State.running:
          continue;
        case State.cancelled:
          return;
        case State.done:
          await output.close();
          return;
      }
    }
  };
