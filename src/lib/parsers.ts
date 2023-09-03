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

/**
 * Reads streaming input into a buffer and provides methods for parsing it.
 */
export class Scanner {
  readonly _input: Reader;
  buffer = "";

  constructor(input: Reader) {
    this._input = input;
  }

  /**
   * Reads more input into the buffer.
   * If successful, the buffer's length has increased.
   * @returns false when there's no more input.
   */
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

  /**
   * Ensures that the buffer has the specified length, or more.
   * @returns false if there's not enough input left.
   */
  async fillTo(n: number) {
    while (this.buffer.length < n) {
      if (!await this.pull()) {
        return false;
      }      
    }
    return true;
  }

  /**
   * Returns true if the buffer contains a newline.
   */
  get hasLine(): boolean {
    return this.buffer.includes('\n');
  }

  /**
   * Returns true if the buffer starts with the given prefix.
   * Pulls more input if needed.
   */
  async startsWith(prefix: string): Promise<boolean> {
    if (!await this.fillTo(prefix.length)) {
      return false;
    }
    return this.buffer.startsWith(prefix);
  }
  
  /** Clears and returns the buffer. */
  take(): string {
    const result = this.buffer;
    this.buffer = '';
    return result;
  }

  async takeCharIn(chars: string): Promise<string> {
    if (!await this.fillTo(1) || !chars.includes(this.buffer[0])) {
      return '';
    }
    const result = this.buffer[0];
    this.buffer = this.buffer.slice(1);
    return result;
  }

  async takeCharsIn(chars: string): Promise<string> {
    let result = '';
    while (true) {
      const c = await this.takeCharIn(chars);
      if (!c) {
        return result;
      }
      result += c;
    }
  }

  async takeStartsWith(prefix: string): Promise<string> {
    if (!await this.startsWith(prefix)) {
      return '';
    }
    const result = this.buffer.slice(0, prefix.length);
    this.buffer = this.buffer.slice(prefix.length);
    return result;
  }

  /**
   * Reads and removes a line, including the terminating newline.
   * Pulls more input if needed.
   * @returns the line, or false if there's not enough input for a complete line.
   */
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

  /**
   * Reads and removes a line that only contains whitespace, if there is one.
   * Otherwise, pulls enough input to tell that it's not blank.
   * @returns false if it's not blank or not a complete line.
   */
  async takeBlankLine(): Promise<string | false> {
    while (true) {
      let end = this.buffer.indexOf("\n");
      let limit = (end === -1) ? this.buffer.length : end;
      if (this.buffer.slice(0, limit).trim() !== "") {
        return false; // not blank
      } else if (end >= 0) {
        const line = this.buffer.slice(0, end + 1);
        this.buffer = this.buffer.slice(end + 1);
        return line;
      }
      if (!await this.pull()) {
        return false;
      }
    }
  }
}

const cueChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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
    const sendCellStart = async (rest: string): Promise<boolean> => {
      switch (rest.trim()) {
        case "markdown":
          inMarkdown = true;
          return await output.startMarkdownCell();
        case "python":
          inMarkdown = false;
          return await output.startCodeCell();
        default:
          console.log(`Unknown cell type: ${rest.trim()}`);
          return await output.write(`%${rest}\n`);
      }
    };

    // Reads a cell header line from the input and sets the cell type.
    // Precondition: buffer[0] is '%' at the start of a line.
    // Postcondition if still running: buffer[0] is the start of the next line.
    const handleHeader = async (): Promise<State> => {
      const line = await scanner.takeLine();
      if (!line) {
        // The input ended with a header line.
        // Ignore it and don't start a new cell.
        return State.done;
      }
      const rest = line.slice(1, line.length - 1);
      return await sendCellStart(rest) ?  State.running : State.cancelled;
    };

    // Sends one cell.
    // Precondition: scanner is at the start of cell, just after the header.
    // Postcondition if still running: scanner is after the header of the next cell.
    const handleCell = async (): Promise<State> => {
      // skip blank lines at start of cell
      while (await scanner.takeBlankLine()) {}

      if (inMarkdown) {
        // send indentation and cue

        const indent = await scanner.takeCharsIn(' \t');
        if (indent) {
          if (!await output.write(indent)) {
            return State.cancelled;
          }
        }

        const cueStart = await scanner.takeCharsIn(cueChars);
        if (cueStart) {
          if (await scanner.takeStartsWith(': ')) {
            if (!await output.write(cueStart + ': ')) {
              return State.cancelled;
            }
          } else {
            // doesn't match, so add one.
            if (!await output.write('bot: ' + cueStart)) {
              return State.cancelled;
            }
          }
        }
      }
      
      while (true) {
        if (await scanner.startsWith('%')) {
          return handleHeader();
        }

        // send chunks in line
        while (!scanner.hasLine) {
          const chunk = scanner.take();
          if (!await output.write(chunk)) {
            return State.cancelled;
          }
          if (!await scanner.pull()) {
            return State.done;
          }
        }

        // send line end
        const lineEnd = await scanner.takeLine();
        if (!lineEnd) {
          console.trace("shouldn't get here");
          return State.cancelled;
        }
  
        if (!await output.write(lineEnd)) {
          return State.cancelled;
        } 
      }
    };

    if (!await scanner.pull()) {
      return;
    }

    while (true) {
      switch (await handleCell()) {
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
