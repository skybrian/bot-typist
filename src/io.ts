import * as vscode from "vscode";
import * as child_process from "child_process";

export interface Writer {
  /**
   * Writes a string to a destination. Blocks until finished.
   *
   * Returns false if writing has finished or has been cancelled.
   */
  write(data: string): Promise<boolean>;

  /**
   * Signals that no more data will be written and resources can be cleaned up.
   * 
   * Returns false if writing has been cancelled.
   */
  end(): Promise<boolean>;
}

/**
 * Returns a Writer that writes to an editor at the current cursor position.
 * 
 * Writing will be cancelled if the cursor moves or the document is edited.
 */
export function writerForEditor(ed: vscode.TextEditor): Writer {

  var insertingOutput = false;
  var cancelled = false;

  // Attach listeners to detect cursor movement or text change
  const disposables: vscode.Disposable[] = [];

  disposables.push(vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor === ed && !insertingOutput) {
      cancelled = true;
    }
  }));

  disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === ed.document && !insertingOutput) {
      cancelled = true;
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

  const cleanup = () => {
    ed.setDecorations(decorationType, []);
    decorationType.dispose();
    for (const disposable of disposables) {
      disposable.dispose();
    }
    disposables.length = 0;
  };

  return {
    write: async (data: string): Promise<boolean> => {
      if (cancelled || disposables.length === 0) {
        return false;
      }

      insertingOutput = true;
      try {
        const ok = await typeText(ed, data);
        cancelled = cancelled || !ok;
        return !cancelled;
      } finally {
        insertingOutput = false;
        if (cancelled) {
          cleanup();
        }
      }
    },

    end: async (): Promise<boolean> => {
      cleanup();
      return !cancelled;
    },
  };
}

/**
 * Types some text into the current document at the cursor.
 * Returns true if the text was typed successfully.
 */
export async function typeText(ed: vscode.TextEditor, newText: string): Promise<boolean> {
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
 * Runs a command and sends stdout to a Writer.
 * Returns true if the command finished without being interrupted.
 */
export function writeStdout(dest: Writer, command: string, args: string[], options?: {stdin?: string}): Promise<boolean> {
  return new Promise((resolve, reject) => {

    const child = child_process.spawn(command, args);

    let shuttingDown = false;

    const cleanup = () => {
      shuttingDown = true;
      child.kill();
      dest.end();
    };

    // Send stdin
    if (options && options.stdin) {
      child.stdin.write(options.stdin, (err) => {
        if (err) {
          console.error(`writeStdout: error writing to stdin of external command: ${err}`);
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