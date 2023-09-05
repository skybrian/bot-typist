import { DONE, Reader, Writer } from "./streams";

/**
 * A Scanner combines a Reader and a buffer to represent a position
 * in a stream of text, along with a variable amount of lookahead.
 *
 * It provides methods to detect patterns and to move forward in
 * the stream.
 *
 * Streaming input may arrive slowly, so methods are designed to look
 * ahead only as far as needed, so that decisions can be made as soon
 * as possible.
 */
export class Scanner {
  #input: Reader;
  #inputDone = false;
  #buffer = "";

  constructor(input: Reader) {
    this.#input = input;
  }

  get buffer() {
    return this.#buffer;
  }

  /** Returns true if the buffer is empty and there is no more input. */
  get atEnd(): boolean {
    return this.#buffer.length === 0 && this.#inputDone;
  }

  /**
   * Reads more input into the buffer.
   * If successful, the buffer's length has increased.
   * @returns false when there's no more input.
   */
  async pull(): Promise<boolean> {
    while (true) {
      const chunk = await this.#input.read();
      if (chunk === DONE) {
        this.#inputDone = true;
        return false;
      } else if (chunk !== "") {
        this.#buffer += chunk;
        return true;
      }
    }
  }

  /**
   * Ensures that the buffer has at least the specified length.
   * @returns false if there's not enough input left.
   */
  async fillTo(n: number) {
    while (this.#buffer.length < n) {
      if (!await this.pull()) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns true if the buffer starts with the given prefix.
   * Pulls more input if needed.
   */
  async startsWith(prefix: string): Promise<boolean> {
    while (this.#buffer.length < prefix.length) {
      if (this.#buffer !== prefix.slice(0, this.#buffer.length)) {
        return false;
      }
      if (!await this.pull()) {
        return false;
      }
    }
    return this.#buffer.startsWith(prefix);
  }

  /** Advances past the given token if it's next in the stream. */
  async skipToken(token: string): Promise<boolean> {
    if (!await this.startsWith(token)) {
      return false;
    }
    this.#buffer = this.#buffer.slice(token.length);
    return true;
  }

  /** Clears and returns the buffer. */
  takeBuffer(): string {
    const result = this.#buffer;
    this.#buffer = "";
    return result;
  }

  /**
   * Pulls the entire input into the buffer and returns it.
   *
   * This method will wait until the entire stream arrives.
   *
   * @returns the entire input, or the empty string if there is none.
   */
  takeAll(): string {
    while (this.pull()) {}
    return this.takeBuffer();
  }

  /**
   * Takes an arbitrary amount of input, up to and including the next newline.
   *
   * Pulls more input if the buffer is currently empty. Otherwise, returns
   * the buffer up to the next newline, including the newline.
   *
   * @returns an empty string at the end of input
   */
  async takeChunkWithinLine(): Promise<string> {
    if (!await this.fillTo(1)) {
      return "";
    }
    let end = this.#buffer.indexOf("\n");
    if (end === -1) {
      return this.takeBuffer();
    }
    const chunk = this.#buffer.slice(0, end + 1);
    this.#buffer = this.#buffer.slice(end + 1);
    return chunk;
  }

  async takeMatchingChar(allowedChars: string): Promise<string> {
    if (!await this.fillTo(1) || !allowedChars.includes(this.#buffer[0])) {
      return "";
    }
    const result = this.#buffer[0];
    this.#buffer = this.#buffer.slice(1);
    return result;
  }

  async takeMatchingPrefix(allowedChars: string): Promise<string> {
    let result = "";
    while (true) {
      const c = await this.takeMatchingChar(allowedChars);
      if (!c) {
        return result;
      }
      result += c;
    }
  }

  /**
   * Reads and removes a line, including the terminating newline.
   * Waits until a newline or the end of input is reached.
   *
   * @returns the next line, including the newline if there is one.
   * @returns the empty string at the end of the input.
   */
  async takeLine(): Promise<string> {
    while (!this.#buffer.includes("\n")) {
      if (!await this.pull()) {
        return this.takeBuffer();
      }
    }

    const end = this.#buffer.indexOf("\n");
    const line = this.#buffer.slice(0, end + 1);
    this.#buffer = this.#buffer.slice(end + 1);
    return line;
  }

  /**
   * Reads and removes a line that only contains whitespace, if there is one.
   * Otherwise, pulls enough input to tell that it's not blank.
   *
   * @returns a complete blank line, including the newline if there is one.
   * @returns the empty string if a non-blank line is next, or at the end of the input.
   */
  async takeBlankLine(): Promise<string> {
    do {
      let end = this.#buffer.indexOf("\n");
      let limit = (end === -1) ? this.#buffer.length : end;
      if (this.#buffer.slice(0, limit).trim() !== "") {
        // not blank
        return "";
      } else if (end >= 0) {
        // blank line
        const line = this.#buffer.slice(0, end + 1);
        this.#buffer = this.#buffer.slice(end + 1);
        return line;
      }
      // don't know; pull more input
    } while (await this.pull());

    // return a partial line at the end of the input.
    return this.takeBuffer();
  }

  /**
   * Copies the next line to a Writer, including the terminating newline if present.
   * Pulls input until a newline or the end of input is reached.
   * 
   * Does nothing at the end of input. (The caller should check this using {@link atEnd}.)
   *
   * @returns false if the Writer cancels.
   */
  async copyLineTo(output: Writer): Promise<boolean> {
    while (true) {
      const chunk = await this.takeChunkWithinLine();
      if (chunk === "") {
        return true;
      }
      if (!await output.write(chunk)) {
        return false;
      }
      if (chunk.endsWith("\n")) {
        return true;
      }
    }
  }
}
