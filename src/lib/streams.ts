import * as child_process from "child_process";

import { Completer } from "./async";

export const DONE = Symbol("DONE");

export type ReadResult = string | typeof DONE;

export interface Reader {
  /**
   * Receives the next chunk of data from a stream. Blocks until it's available.
   * 
   * @returns the next chunk or DONE if there are no more.
   */
  read(): Promise<ReadResult>;
}

export interface Writer {
  /**
   * Sends a chunk of data to a stream. Blocks until it's handed off.
   *
   * @returns false if the destination is no longer reading the stream.
   * (Any further writes will be ignored.)
   */
  write(data: string): Promise<boolean>;
}

export interface WriteCloser<T> extends Writer {
  /**
   * Signals that the stream is finished. Blocks until acknowledged.
   */
  close(): Promise<T>;
}

export interface CellWriter extends WriteCloser<boolean> {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

/**
 * An async function that reads a stream.
 */
export type Parser<T> = (reader: Reader) => Promise<T>;

/**
 * A writer that sends data to a parse function. The parser blocks on read()
 * calls until the writer sends data, and the writer blocks on write() calls
 * until the the parser reads the data or disconnects.
 * 
 * The parser can disconnect at any time by returning or throwing.
 */
export class ParserWriter<T> implements WriteCloser<T> {

  #writesDone = false;

  /** Resolves to true if the parser called read() or false if it disconnected. */
  #parserWaiting = new Completer<boolean>();
  #nextWrite = new Completer<ReadResult>();

  #parseResult = new Completer<T>();

  constructor(parse: Parser<T>) {

    let isReading = false;
    const reader: Reader = {
      read:  async (): Promise<ReadResult> => {
        if (isReading) {
          throw new Error("Already reading");
        } else if (this.#writesDone) {
          return DONE;
        }

        isReading = true;
        this.#parserWaiting.resolve(true);
        try {
          const result = await this.#nextWrite.promise;
          this.#nextWrite = new Completer<ReadResult>();
          return result;
        } finally {
          isReading = false;
        }
      }
    };

    parse(reader).then((result) => {
      this.#parseResult.resolve(result);
    }).catch((err) => {
      this.#parseResult.reject(err);
    }).finally(() => {
      this.#parserWaiting.resolve(false);
    });
  }

  #sending = false;

  async #send(data: ReadResult): Promise<boolean> {
    if (this.#sending) {
      throw new Error("Already writing");
    }

    this.#sending = true;
    try {
      if (!await this.#parserWaiting.promise) {
        return false; // disconnected
      }
      this.#parserWaiting = new Completer<boolean>();
      this.#nextWrite.resolve(data);
      if (data === DONE) {
        this.#writesDone = true;
      }
      return true;
    } finally {
      this.#sending = false;
    }
  };

  /**
   * Sends a chunk of data to the parser. Blocks until the parser
   * reads it or exits.
   * @returns false if the parse function exited.
   */
  write(data: string): Promise<boolean> {
    return this.#send(data);
  }

  /**
   * Signals the end the input stream to the parser.
   * @returns the result of the parse function.
   * @throws if the parse function threw.
   */
  close(): Promise<T> {
    this.#send(DONE);
    return this.#parseResult.promise;
  }
}

/**
 * Runs an external command and sends stdout to a Writer.
 * Returns true if the command finished without being interrupted.
 * Doesn't close the writer.
 */
export function writeStdout(
  dest: Writer,
  command: string,
  args: string[],
  options?: { stdin?: string },
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(command, args);

    let lastAction = Promise.resolve(true);

    let shuttingDown = false;
    let error: unknown;

    const stop = (msg?: string, error?: unknown) => {
      if (shuttingDown) {
        return; // already shutting down
      }
      shuttingDown = true;

      if (msg) {
        console.error("writeStdout:", msg, error);
        if (!error) {
          error = new Error(msg);
        }
      }

      error = error;

      // Resolve or reject after all writes are done (or skipped).
      lastAction = lastAction.then(async (ok: boolean) => {
        if (error) {
          throw error;
        }
        resolve(ok);
        return ok;
      }).catch((err: unknown) => {
        reject(err);
        return false;
      });

      child.kill();
    };

    // Send stdin
    if (options && options.stdin) {
      child.stdin.write(options.stdin, (err) => {
        if (err) {
          stop("error writing to stdin of external command", err);
        }
      });
      child.stdin.end();
    }

    // Schedule writes to stdout in the order received
    child.stdout.on("data", (data) => {
      if (shuttingDown) {
        return; // don't schedule any more writes
      }
      lastAction = lastAction.then(async (ok: boolean) => {
        return ok && !error && await dest.write(data.toString());
      });
    });

    // Stop on any error
    child.stderr.on("data", (data) => {
      stop(`stderr: ${data}`);
    });

    child.on("error", (err) => {
      stop(undefined, err);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        stop(`External command was killed by signal ${signal}`);
      } else if (code !== 0) {
        stop(`External command exited with code ${code}`);
      }
    });

    child.on("close", (code, signal) => {
      if (signal) {
        stop(`External command was killed by signal ${signal}`);
      } else if (code !== 0) {
        stop(`External command exited with code ${code}`);
      } else {
        stop();
      }
    });
  });
}
