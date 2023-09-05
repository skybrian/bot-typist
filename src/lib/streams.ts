import { Completer } from "./async";
import { Readable } from "stream";

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

export class StringWriter implements Writer {
  buffer = "";
  async write(data: string): Promise<boolean> {
    this.buffer += data;
    return true;
  }
}

export interface WriteCloser<T> extends Writer {
  /** Signals that the stream is finished. Blocks until acknowledged. */
  close(): Promise<T>;
}

/** An async function that reads from a stream (such as a parser). */
export type ReadFunction<T> = (input: Reader) => Promise<T>;

/** Reads an entire stream into a string. */
export const readAll: ReadFunction<string> = async (
  r: Reader,
): Promise<string> => {
  let output = "";
  while (true) {
    const chunk = await r.read();
    if (chunk === DONE) {
      return output;
    }
    output += chunk;
  }
};

/**
 * Copies a stream to an async function. Completes when the function does.
 *
 * The function doesn't have to read the entire stream before returning.
 * The Readable will be destroyed whenever the function exits.
 *
 * If the stream emits an error, the next read() call will throw. The error
 * will be ignored if the function never calls read() again.
 *
 * @return the result of the task.
 * @throws if the ReadFunction throws.
 */
export async function copyStream<T>(
  source: Readable,
  dest: ReadFunction<T>,
): Promise<T> {
  let currentRead: Completer<ReadResult> | null = null;

  const onReadable = () => {
    if (currentRead) {
      const chunk = source.read();
      if (chunk) {
        currentRead.resolve(chunk.toString());
        currentRead = null;
      }
    }
  };
  source.on("readable", onReadable);

  let streamEnded = false;

  const onEnd = () => {
    streamEnded = true;
    if (currentRead) {
      currentRead.resolve(DONE);
      currentRead = null;
    }
  };
  source.once("end", onEnd);

  let streamError: Error | null = null;

  const onError = (error: Error) => {
    streamError = error;
    if (currentRead) {
      currentRead.reject(error);
      currentRead = null;
    }
  };
  source.once("error", onError);

  const adapter: Reader = {
    read(): Promise<ReadResult> {
      if (currentRead) {
        throw new Error("previous read still in progress");
      }

      currentRead = new Completer<ReadResult>();
      const result = currentRead.promise;

      if (streamEnded) {
        currentRead.resolve(DONE);
        currentRead = null;
      } else if (streamError) {
        currentRead.reject(streamError);
        currentRead = null;
      } else {
        const chunk = source.read();
        if (chunk !== null) {
          currentRead.resolve(chunk.toString());
          currentRead = null;
        }
      }

      return result;
    },
  };

  try {
    return await dest(adapter);
  } finally {
    source.removeListener("readable", onReadable);
    source.removeListener("end", onEnd);
    source.removeListener("error", onError);
    source.destroy();
  }
}
