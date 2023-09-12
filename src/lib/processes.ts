import { ChildProcessWithoutNullStreams, spawn } from "child_process";

import { copyStream, DONE, ReadFunction, WriteCloser } from "./streams";
import { Completer } from "./async";

/** Indicates that a child process exited with a non-zero exit code. */
export class ChildExitError extends Error {
  readonly path: string;
  readonly args: string[];
  readonly exitCode: number;
  readonly stderr: string;

  constructor(path: string, args: string[], exitCode: number, stderr: string) {
    super(
      `child process '${
        path.split("/")[-1]
      }' stopped with exit code ${exitCode}`,
    );
    this.path = path;
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }

  toString() {
    return this.message;
  }
}

/**
 * A child process that accepts writes and sends streaming output to a read function.
 */
export class ChildPipe<T> implements WriteCloser<T> {
  readonly #path: string;
  readonly #args: string[];
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #result: Promise<T>;

  #stderr = "";

  /**
   * Spawns a child process and starts sending its result to a read function.
   * @param dest receives data that the child process writes to stdout.
   */
  constructor(path: string, args: string[], dest: ReadFunction<T>) {
    this.#path = path;
    this.#args = args;
    this.#child = spawn(path, args);

    this.#result = copyStream(this.#child.stdout, dest);

    copyStream(this.#child.stderr, async (r) => {
      while (true) {
        const chunk = await r.read();
        if (chunk === DONE) {
          return;
        }
        console.log("ChildPipe stderr:", chunk);
        this.#stderr += chunk;
      }
    });

    this.#child.on("error", (err) => {
      this.#stop("process emitted an error", err);
    });

    this.#child.stdin.on("error", (err) => {
      this.#stop("stdin emitted an error", err);
    });

    this.#child.on("exit", (code, signal) => {
      if (signal) {
        this.#stop(`process exited with signal ${signal}`);
      } else if (code !== null && code !== 0) {
        this.#throwExitError(code);
      }
    });

    this.#child.on("close", (code, signal) => {
      if (signal) {
        this.#stop(`process closed with signal ${signal}`);
      } else if (code !== null && code !== 0) {
        this.#throwExitError(code);
      }
      this.#stop();
    });
  }

  #stopCalled = false;
  #stopError = new Completer<unknown>();

  #throwExitError(code: number) {
    const err = new ChildExitError(this.#path, this.#args, code, this.#stderr);
    return this.#stop(undefined, err);
  }

  async #stop(reason?: string, error?: unknown): Promise<void> {
    if (this.#stopCalled) {
      return;
    }
    this.#stopCalled = true;
    this.#stopError.resolve(error);
    this.#child.kill();

    if (reason && error) {
      console.error("ChildPipe: stopped because", reason, error);
    } else if (reason) {
      console.log("ChildPipe: stopped because", reason);
    }
  }

  #isWriting = false;

  /**
   * Sends data to stdin of the child process.
   * Waits for a drain event if the buffer is full.
   */
  async write(data: string): Promise<boolean> {
    if (this.#isWriting) {
      throw new Error(
        "ChildPipe.write called while another write is in progress",
      );
    }
    this.#isWriting = true;
    try {
      return new Promise((resolve, _reject) => {
        if (this.#child.stdin.write(data)) {
          resolve(true);
        } else {
          // Wait for the drain event.
          this.#child.stdin.once("drain", () => {
            resolve(true);
          });
        }
      });
    } finally {
      this.#isWriting = false;
    }
  }

  /**
   * Closes standard input of the child process and waits for the read function to return a value.
   *
   * @returns the result from the read function.
   */
  async close(): Promise<T> {
    this.#child.stdin.end();
    try {
      const result = await this.#result;

      const err = await this.#stopError.promise;
      if (err) {
        throw err;
      }

      return result;
    } finally {
      this.#stop();
    }
  }

  /**
   * Sends a kill signal to the child process.
   */
  kill() {
    this.#child.kill();
  }
}
