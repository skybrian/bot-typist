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
export function writerForNotebook(): NotebookWriter | undefined {

  let cell = getActiveCell();
  if (!cell) {
    return undefined;
  }

  if (!vscode.window.activeTextEditor) {
    return undefined;
  }
  let ed = vscode.window.activeTextEditor;

  return new NotebookWriter(cell, ed);
}

class NotebookWriter implements CellWriter {
  #cell: vscode.NotebookCell; 
  #ed: vscode.TextEditor;

  #cancelled = false;
  #disposables: vscode.Disposable[] = [];

  #decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: "...",
      color: "gray",
    },
  });

  constructor(cell: vscode.NotebookCell, ed: vscode.TextEditor) {
    this.#cell = cell;
    this.#ed = ed;

    const here = ed.selection.active;
    ed.setDecorations(this.#decorationType, [new vscode.Range(here, here)]);

    this.#disposables.push({
      dispose: () => {
        ed.setDecorations(this.#decorationType, []);
        this.#decorationType.dispose();
      }
    });
  }

  private cleanup = () => {
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables.length = 0;
  };

  private checkDone = () => {
    if (this.#disposables.length === 0) {
      return true;
    }

    if (this.#ed !== vscode.window.activeTextEditor) {
      console.log("Active editor changed. Cancelling.");
      this.#cancelled = true;
    } else if (getActiveCell() !== this.#cell) {
      console.log("Active cell changed. Cancelling.");
      this.#cancelled = true;
    }

    if (this.#cancelled) {
      this.cleanup();
    }
    return this.#disposables.length === 0;
  };

  private cellStarted = false;

  private startCell = async (command: string): Promise<boolean> => {
    if (this.checkDone()) {
      return false;
    }

    // Remove trailing blank line in previous cell
    await this.#ed.edit((builder) => {
      if (this.#ed.document.lineCount < 2) {
        return;
      }
      const last = this.#ed.document.lineAt(this.#ed.document.lineCount - 1);
      if (!last.isEmptyOrWhitespace) {
        return;
      }
      const prev = this.#ed.document.lineAt(this.#ed.document.lineCount - 2);
      builder.delete(new vscode.Range(prev.range.end, last.rangeIncludingLineBreak.end));
    });

    this.#ed.setDecorations(this.#decorationType, []);

    await vscode.commands.executeCommand(command);
    await vscode.commands.executeCommand("notebook.cell.edit");

    const cell = getActiveCell();
    if (!cell) {
      return false;
    }

    this.#cell = cell;
    this.#ed = vscode.window.activeTextEditor!;
    const here = this.#ed.selection.active;
    this.#ed.selection = new vscode.Selection(here, here);
    this.#ed.setDecorations(this.#decorationType, [new vscode.Range(here, here)]);

    this.cellStarted = true;
    return true;
  };

  startCodeCell(): Promise<boolean> {
    return this.startCell("notebook.cell.insertCodeCellBelow");
  };

  startMarkdownCell(): Promise<boolean> {
    return this.startCell("notebook.cell.insertMarkdownCellBelow");
  }

  async write(data: string): Promise<boolean> {
      if (this.checkDone()) {
        return false;
      }

      if (!this.cellStarted) {
        if (!await this.startCell("notebook.cell.insertMarkdownCellBelow")) {
          console.log("write: couldn't start markdown cell.");
          return false;
        }
      }

      try {
        const ok = await typeText(this.#ed, data);
        if (!ok) {
          console.log("write: typeText failed. Cancelling.");
          this.#cancelled = true;
        }
        return !this.#cancelled;
      } finally {
        if (this.#cancelled) {
          this.cleanup();
        }
      }
    }

  async close(): Promise<boolean> {
    this.cleanup();
    return !this.#cancelled;
  }
}
