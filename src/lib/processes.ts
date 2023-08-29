import { ChildProcessWithoutNullStreams, spawn } from "child_process";

import { copyStream, DONE, ReadFunction, WriteCloser } from "./streams";

/**
 * A child process that accepts writes and sends streaming output to a read function.
 */
export class ChildPipe<T> implements WriteCloser<T> {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #result: Promise<T>;

  /**
   * Spawns a child process and starts sending its result to a read function.
   * @param dest receives data that the child process writes to stdout.
   */
  constructor(path: string, args: string[], dest: ReadFunction<T>) {
    this.#child = spawn(path, args);

    this.#result = copyStream(this.#child.stdout, dest);

    copyStream(this.#child.stderr, async (r) => {
      while (true) {
        const chunk = await r.read();
        if (chunk === DONE) {
          return;
        }
        console.log("ChildPipe stderr:", chunk);
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
      } else if (code !== 0) {
        this.#stop(`process exited with exit code ${code}`);
      }
    });

    this.#child.on("close", (code, signal) => {
      if (signal) {
        this.#stop(`process closed with signal ${signal}`);
      } else {
        this.#stop(`process closed with exit code ${code}`);
      }
    });
  }

  #stopCalled = false;
  #stopError: unknown;

  async #stop(reason?: string, error?: unknown): Promise<void> {
    if (this.#stopCalled) {
      return;
    }
    this.#stopCalled = true;
    this.#stopError = error;
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
      if (this.#stopError) {
        throw this.#stopError;
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
