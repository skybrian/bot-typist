import * as vscode from "vscode";
import * as child_process from "child_process";

import { Completer } from "./async";

export const DONE = Symbol("DONE");

export type ReadResult = string | typeof DONE;

export interface Reader {
  /**
   * Reads a chunk from a source. Blocks until a chunk is available 
   * 
   * @returns a chunk or DONE if no more data is available.
   */
  read(): Promise<ReadResult>;

  /**
   * Signals that no more data will be read and resources can be cleaned up.
   */
  cancel(): void;
}

export interface Writer {
  /**
   * Writes a string to some destination. Blocks until the data is handed off.
   *
   * Returns false if writing has been cancelled.
   */
  write(data: string): Promise<boolean>;
}

export interface WriteCloser extends Writer {
  /**
   * Signals that no more data will be written and resources can be cleaned up.
   * 
   * @returns false if any writes were cancelled.
   */
  close(): Promise<boolean>;
}

export interface CellWriter extends WriteCloser {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
}

/**
 * Returns a Reader and Writer that are connected to each other.
 * There is no buffering; writes will block until the reader is ready.
 */
export function makePipe(): [Reader, WriteCloser] {
  let readerWaiting = new Completer<boolean>();
  let nextRead = new Completer<ReadResult>();

  let isReading = false;
  let done = false;

  const reader: Reader = {
    read: async (): Promise<ReadResult> => {
      if (isReading) {
        throw new Error("Already reading");
      } else if (done) {
        return DONE;
      }

      isReading = true;
      readerWaiting.resolve(true);
      try {
        const chunk = await nextRead.promise;
        nextRead = new Completer<ReadResult>();
        return chunk;
      } finally {
        isReading = false;
      }
    },

    cancel: function (): void {
      readerWaiting.resolve(false);
      nextRead.resolve(DONE);
      done = true;
    },
  };

  let sending = false;

  const send = async (data: ReadResult): Promise<boolean> => {
    if (sending) {
      throw new Error("Already writing");
    }

    sending = true;
    try {
      if (!await readerWaiting.promise) {
        return false; // cancelled
      }
      readerWaiting = new Completer<boolean>();
      nextRead.resolve(data);
      if (data === DONE) {
        done = true;
      }
      return true;
    } finally {
      sending = false;
    }
  };

  const writer: WriteCloser = {
    write: async (data: string): Promise<boolean> => {
      return send(data);
    },

    close: function (): Promise<boolean> {
      return send(DONE);
    },
  };

  return [reader, writer];
}

/**
 * Writes to a text editor at the current cursor position.
 *
 * Writing will be cancelled if the cursor moves or the document is edited.
 */
export class TextEditorWriter implements WriteCloser {
  private readonly ed: vscode.TextEditor;

  private readonly disposables: vscode.Disposable[] = [];

  private insertingOutput = false;
  private cancelled = false;

  constructor(ed: vscode.TextEditor) {
    this.ed = ed;

    this.disposables.push(vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === ed && !this.insertingOutput) {
        this.cancelled = true;
      }
    }));

    this.disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === ed.document && !this.insertingOutput) {
        this.cancelled = true;
      }
    }));

    const decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: "...",
        color: "gray",
      },
    });

    const here = ed.selection.active;
    ed.setDecorations(decorationType, [new vscode.Range(here, here)]);

    this.disposables.push({
      dispose: () => {
        this.ed.setDecorations(decorationType, []);
        decorationType.dispose();
      },
    });
  }

  async write(data: string): Promise<boolean> {
    if (this.disposables.length === 0) {
      return false;
    }

    this.insertingOutput = true;
    try {
      const ok = await typeText(this.ed, data);
      this.cancelled = this.cancelled || !ok;
      return !this.cancelled;
    } finally {
      this.insertingOutput = false;
      if (this.cancelled) {
        this.close();
      }
    }
  }

  async close(): Promise<boolean> {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    return !this.cancelled;
  }
}

/**
 * Types some text into the current document at the cursor.
 * Returns true if the text was typed successfully.
 */
export async function typeText(
  ed: vscode.TextEditor,
  newText: string,
): Promise<boolean> {
  if (ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeText: selection not empty");
    return false;
  }

  // insert text

  const here = ed.selection.active;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(ed.document.uri, here, newText);

  if (!await vscode.workspace.applyEdit(edit)) {
    console.log(`typeText: applyEdit failed for: '${newText}'`);
    return false;
  }

  if (ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeText: selection not empty after edit");
    return false;
  }

  // update cursor position

  const lines = newText.split("\n");
  const lineDelta = lines.length - 1;
  const charDelta = lines[lineDelta].length;
  const newPosition = here.translate(lineDelta, charDelta);

  ed.selection = new vscode.Selection(newPosition, newPosition);
  return true;
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

    let shuttingDown = false;

    const cleanup = () => {
      shuttingDown = true;
      child.kill();
    };

    // Send stdin
    if (options && options.stdin) {
      child.stdin.write(options.stdin, (err) => {
        if (err) {
          console.error(
            `writeStdout: error writing to stdin of external command: ${err}`,
          );
          cleanup();
          resolve(false);
        }
      });
      child.stdin.end();
    }

    // Handle stdout
    child.stdout.on("data", async (data) => {
      if (shuttingDown) {
        return;
      }

      child.stdout.pause();

      if (!await dest.write(data.toString())) {
        console.error("External command cancelled");
        cleanup();
        resolve(false);
      }

      child.stdout.resume();
    });

    // Handle errors
    child.stderr.on("data", (data) => {
      console.error(`stderr: ${data}`);
      cleanup();
      reject(new Error("External command wrote to stderr"));
    });

    // Cleanup on close
    child.on("close", (code, signal) => {
      cleanup();
      if (signal) {
        console.error(`External command was killed by signal ${signal}`);
        resolve(false);
      } else if (code !== 0) {
        reject(
          new Error(`External command exited with code ${code}`),
        );
      } else {
        resolve(true);
      }
    });
  });
}
