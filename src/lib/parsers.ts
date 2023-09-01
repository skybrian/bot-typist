import { DONE, ReadFunction, Reader, WriteCloser } from "./streams";

export interface CellWriter extends WriteCloser<boolean> {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

enum State {
  running,
  cancelled,
  done
}

class Scanner {
  readonly _input: Reader;
  buffer = "";

  constructor(input: Reader) {
    this._input = input;
  }

  // Reads more input into the buffer.
  // Returns false when writing is cancelled.
  // Postcondition when true: buffer.length is greater than before.
  async pull(): Promise<boolean> {
    while (true) {
      const chunk = await this._input.read();
      if (chunk === DONE) {
        return false;
      } else if (chunk !== "") {
        this.buffer += chunk;
        return true;
      }
    }
  };

  async fillTo(n: number) {
    while (this.buffer.length < n) {
      if (!await this.pull()) {
        return false;
      }      
    }
    return true;
  }

  get hasLine(): boolean {
    return this.buffer.includes('\n');
  }

  take(): string {
    const result = this.buffer;
    this.buffer = '';
    return result;
  }

  /** Reads a line, including the newline. */
  async takeLine(): Promise<string | false> {
    while (!this.hasLine) {
      if (!await this.pull()) {
        return false;
      }
    }

    const end = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, end + 1);
    this.buffer = this.buffer.slice(end + 1);
    return line;
  }

  async startsWith(prefix: string): Promise<boolean> {
    if (!await this.fillTo(prefix.length)) {
      return false;
    }
    return this.buffer.startsWith(prefix);
  }
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
      const line = await scanner.takeLine();
      if (!line) {
        // The input ended with a header line.
        // Ignore it and don't start a new cell.
        return State.done;
      }
      const rest = line.slice(1, line.length - 1);
      return await sendCellStart(rest) ?  State.running : State.cancelled;
    };

    // Sends one line of text.
    // Precondition: scanner at start of line.
    // Postcondition if still running: scanner at start of line.
    const sendLine = async (): Promise<State> => {
      if (await scanner.startsWith('%')) {
        return parseHeader();
      }
      while (!scanner.hasLine) {
        const chunk = scanner.take();
        if (!await output.write(chunk)) {
          return State.cancelled;
        }
        if (!await scanner.pull()) {
          return State.done;
        }
      }

      const lineEnd = await scanner.takeLine();
      if (!lineEnd) {
        console.trace("shouldn't get here");
        return State.cancelled;
      }

      if (!await output.write(lineEnd)) {
        return State.cancelled;
      }
      if (!await scanner.fillTo(1)) {
        return State.done;
      }
      return State.running;
    };

    if (!await scanner.pull()) {
      return;
    }

    while (true) {
      switch (await sendLine()) {
        case State.running:
          continue;
        case State.cancelled:
          console.log("bot response cancelled");
          return;
        case State.done:
          await output.close();
          return;
      }
    }
  };
