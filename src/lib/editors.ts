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
  if (!sel || sel.end - sel.start !== 1) {
    return undefined;
  }
  return ed.notebook.cellAt(sel.start);
}

/** Returns a CellWriter that inserts cells into the active notebook, below the current cell. */
export function writerForNotebook(): NotebookWriter | undefined {
  let cell = getActiveCell();
  return cell ? new NotebookWriter(cell) : undefined;
}

class NotebookWriter implements CellWriter {
  #cell: vscode.NotebookCell; 
  
  #decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: "...",
      color: "gray",
    },
  });

  #decoratedEd: vscode.TextEditor | undefined;

  #disposables: vscode.Disposable[] = [];

  /** The size of the cell after the last edit. Used to detect interference. */
  #cellSize = 0;

  /** True if editing was cancelled because something changed. */
  #cancelled = false;

  /** True if at least one new cell was inserted. */
  #insertedCell = false;

  constructor(cell: vscode.NotebookCell) {
    this.#cell = cell;
    
    this.#disposables.push({
      dispose: () => {
        if (this.#decoratedEd) {
          this.#decoratedEd.setDecorations(this.#decorationType, []);
        }
      }
    });
    this.#disposables.push(this.#decorationType);
  }     

  private cleanup = () => {
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables.length = 0;
  };

  private cancel(msg: string) {
    console.log(`notebook editing cancelled: ${msg}`);
    this.#cancelled = true;
    this.cleanup();
  }

  /** Returns the editor for the current cell, or undefined if no longer editing. */
  private get editor(): vscode.TextEditor | undefined {
    if (this.#disposables.length === 0) {
      return undefined;
    }

    if (getActiveCell() !== this.#cell) {
      this.cancel("Active cell changed.");
      return undefined;
    }

    const ed = vscode.window.visibleTextEditors.find((ed) => ed.document === this.#cell.document);
    if (!ed || ed !== vscode.window.activeTextEditor) {
      this.cancel("Active editor changed.");
      return undefined;
    }

    return ed;
  }

  /** Inserts a new cell after the current one and starts editing it. */
  private insertCellBelow = async (kind: vscode.NotebookCellKind): Promise<boolean> => {
    const prevEd = this.editor;
    if (!prevEd) {
      return false;
    }

    // Remove any trailing blank line in the previous cell.
    await prevEd.edit((builder) => {
      if (prevEd.document.lineCount < 2) {
        return;
      }
      const last = prevEd.document.lineAt(prevEd.document.lineCount - 1);
      if (!last.isEmptyOrWhitespace) {
        return;
      }
      const prev = prevEd.document.lineAt(prevEd.document.lineCount - 2);
      builder.delete(new vscode.Range(prev.range.end, last.rangeIncludingLineBreak.end));
    });

    const command = kind === vscode.NotebookCellKind.Markup ? "notebook.cell.insertMarkdownCellBelow" : "notebook.cell.insertCodeCellBelow";
    await vscode.commands.executeCommand(command);
    await vscode.commands.executeCommand("notebook.cell.edit");

    const cell = getActiveCell();
    if (!cell) {
      return false;
    }
    this.#cell = cell;

    const ed = this.editor;
    if (!ed) {
      return false;
    }

    this.decorate(ed);
    this.#insertedCell = true;
    this.#cellSize = ed.document.getText().length;
    return true;
  };

  private decorate(ed: vscode.TextEditor) {
    if (this.#decoratedEd) {
      this.#decoratedEd.setDecorations(this.#decorationType, []);
    }
    const here = ed.selection.active;
    ed.setDecorations(this.#decorationType, [new vscode.Range(here, here)]);
    this.#decoratedEd = ed;
  }

  startCodeCell(): Promise<boolean> {
    return this.insertCellBelow(vscode.NotebookCellKind.Code);
  };

  startMarkdownCell(): Promise<boolean> {
    return this.insertCellBelow(vscode.NotebookCellKind.Markup);
  }

  async write(data: string): Promise<boolean> {
    if (!this.#insertedCell) {
      if (!await this.insertCellBelow(vscode.NotebookCellKind.Markup)) {
        console.log("NotebookWriter.write: couldn't insert markdown cell.");
        return false;
      }
    }

    const ed = this.editor;
    if (!ed) {
      return false;
    }

    const here = ed.selection.active;
    if (here.line !== ed.document.lineCount - 1 || here.character < ed.document.lineAt(here.line).text.length) {
      this.cancel("Cursor not at end of cell.");
      return false;
    }

    if (ed.document.getText().length !== this.#cellSize) {
      this.cancel("Cell was edited.");
      return false;
    }

    const ok = await typeText(ed, data);
    if (!ok) {
      this.cancel("TypeText failed.");
      return false;
    }

    this.#cellSize = ed.document.getText().length;
    return true;
  }

  async close(): Promise<boolean> {
    this.cleanup();
    return !this.#cancelled;
  }
}
