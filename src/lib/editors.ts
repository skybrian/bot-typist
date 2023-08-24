import * as vscode from "vscode";
import { CellWriter, WriteCloser } from "./streams";

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


export function getActiveCell(): vscode.NotebookCell | undefined {
  const ed = vscode.window.activeNotebookEditor;
  if (!ed) {
    return undefined;
  }
  const sel = ed.selection;
  if (sel.end - sel.start !== 1) {
    return undefined;
  }
  return ed.notebook.cellAt(sel.start);
}

/** Returns a writer that appends cells to the active notebook. */
export function writerForNotebook(): CellWriter | undefined {

  let cell = getActiveCell();
  if (!cell) {
    return undefined;
  }

  if (!vscode.window.activeTextEditor) {
    return undefined;
  }
  let ed = vscode.window.activeTextEditor;

  var cancelled = false;

  // Attach listeners to detect cursor movement or text change
  const disposables: vscode.Disposable[] = [];

  const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: "...",
      color: "gray",
    },
  });

  const here = ed.selection.active;
  ed.setDecorations(decorationType, [new vscode.Range(here, here)]);

  disposables.push({
    dispose: () => {
      ed.setDecorations(decorationType, []);
      decorationType.dispose();
    }
  });

  const cleanup = () => {
    for (const disposable of disposables) {
      disposable.dispose();
    }
    disposables.length = 0;
  };

  const checkDone = () => {
    if (disposables.length === 0) {
      return true;
    }

    if (ed !== vscode.window.activeTextEditor) {
      console.log("Active editor changed. Cancelling.");
      cancelled = true;
    } else if (getActiveCell() !== cell) {
      console.log("Active cell changed. Cancelling.");
      cancelled = true;
    }

    if (cancelled) {
      cleanup();
    }
    return disposables.length === 0;
  };

  let cellStarted = false;

  const startCell = async (command: string): Promise<boolean> => {
    if (checkDone()) {
      return false;
    }

    // Remove trailing blank line in previous cell
    await ed.edit((builder) => {
      if (ed.document.lineCount < 2) {
        return;
      }
      const last = ed.document.lineAt(ed.document.lineCount - 1);
      if (!last.isEmptyOrWhitespace) {
        return;
      }
      const prev = ed.document.lineAt(ed.document.lineCount - 2);
      builder.delete(new vscode.Range(prev.range.end, last.rangeIncludingLineBreak.end));
    });

    ed.setDecorations(decorationType, []);

    await vscode.commands.executeCommand(command);
    await vscode.commands.executeCommand("notebook.cell.edit");
    cell = getActiveCell();

    ed = vscode.window.activeTextEditor!;
    const here = ed.selection.active;
    ed.selection = new vscode.Selection(here, here);
    ed.setDecorations(decorationType, [new vscode.Range(here, here)]);

    cellStarted = true;
    return true;
  };

  return {
    startCodeCell: (): Promise<boolean>  => startCell("notebook.cell.insertCodeCellBelow"),
    startMarkdownCell: (): Promise<boolean> => startCell("notebook.cell.insertMarkdownCellBelow"),
    write: async (data: string): Promise<boolean> => {
      if (checkDone()) {
        return false;
      }

      if (!cellStarted) {
        if (!await startCell("notebook.cell.insertMarkdownCellBelow")) {
          console.log("write: couldn't start markdown cell.");
          return false;
        }
      }

      try {
        const ok = await typeText(ed, data);
        if (!ok) {
          console.log("write: typeText failed. Cancelling.");
          cancelled = true;
        }
        return !cancelled;
      } finally {
        if (cancelled) {
          cleanup();
        }
      }
    },

    close: async (): Promise<boolean> => {
      cleanup();
      return !cancelled;
    },
  };
}
