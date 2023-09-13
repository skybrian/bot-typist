import { ChildProcessWithoutNullStreams, spawn } from "child_process";

import { copyStream, DONE, ReadHandler, WriteCloser } from "./streams";
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
 * A pipeline that streams data through a child process to a handler function.
 */
export class ChildPipe<T> implements WriteCloser<T> {
  readonly #path: string;
  readonly #args: string[];
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #handlerResult: Promise<T>;

  #stderr = "";

  /**
   * Spawns a child process, sending stdout to a handler.
   *
   * @param handler an async function that will be called with stdout of the child process.
   * When the handler resolves or rejects, stdout will be closed.
   *
   * @see close to get the handler's result.
   */
  constructor(path: string, args: string[], handler: ReadHandler<T>) {
    this.#path = path;
    this.#args = args;
    this.#child = spawn(path, args);
    this.#handlerResult = copyStream(this.#child.stdout, handler);

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
  #stopped = new Completer<void>();

  #throwExitError(code: number) {
    const err = new ChildExitError(this.#path, this.#args, code, this.#stderr);
    return this.#stop(undefined, err);
  }

  async #stop(reason?: string, error?: unknown): Promise<void> {
    if (this.#stopCalled) {
      return;
    }
    this.#stopCalled = true;
    if (error) {
      this.#stopped.reject(error);
    } else {
      this.#stopped.resolve();
    }
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
   * Closes stdin of the child process and waits for pipeline to shut down.
   *
   * The pipeline shuts down successfully if the handler returns a value and the process exits with a zero exit code.
   * Otherwise, an exception will be thrown.
   *
   * @returns whatever the handler returned.
   * @throws whatever the handler threw.
   * @throws ChildExitError if handler didn't throw and the child process exited with a non-zero exit code.
   */
  async close(): Promise<T> {
    this.#child.stdin.end();

    // await the handler first, so that its exception takes priority.
    let result: T | undefined;
    try {
      result = await this.#handlerResult;
    } catch (e) {
      // Wait for process to exit, but ignore broken pipes, etc due to cancelling.
      try {
        await this.#stopped.promise;
      } catch (_ignored) {}
      throw e;
    }

    await this.#stopped.promise;
    return result;
  }

  /**
   * Sends a kill signal to the child process.
   */
  kill() {
    this.#child.kill();
  }
}
