import * as vscode from "vscode";
import { Cell, CellOutput } from "./botrequest";
import { CellWriter } from "./botresponse";

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
  if (
    !await ed.edit((builder) => {
      builder.insert(here, newText);
    })
  ) {
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

const textMimeTypes = ["text/plain", "application/vnd.code.notebook.stdout"];

export function convertCell(cell: vscode.NotebookCell): Cell {
  const doc = cell.document;
  return {
    languageId: doc.languageId,
    text: doc.getText(),
    outputs: cell.outputs.map(convertOutput),
  };
}

function convertOutput(output: vscode.NotebookCellOutput): CellOutput {
  const decoder = new TextDecoder();
  for (const mimeType of textMimeTypes) {
    const item = output.items.find((item) => item.mime === mimeType);
    if (item) {
      return ["text", decoder.decode(item.data)];
    }
  }

  const error = output.items.find((item) =>
    item.mime === "application/vnd.code.notebook.error"
  );
  if (error) {
    const json = JSON.parse(decoder.decode(error.data));
    return ["error", {
      name: json.name,
      message: json.message,
      stack: json.stack,
    }];
  }

  const first = output.items.at(0);
  if (first) {
    return ["text", `[${output.items[0].mime}] (not shown)`];
  }

  return ["text", "(empty output)"];
}

function getEditorAfterNextChange(): Promise<vscode.TextEditor | undefined> {
  return new Promise((resolve) => {
    const disposable = vscode.window.onDidChangeActiveTextEditor((ed) => {
      disposable.dispose();
      resolve(ed);
    });
  });
}

export async function editActiveCell(): Promise<vscode.TextEditor | undefined> {
  const cell = getActiveCell();
  if (!cell) {
    return undefined;
  }

  const nextEditor = getEditorAfterNextChange();
  await vscode.commands.executeCommand("notebook.cell.edit");
  const ed = await nextEditor;

  return (ed && ed.document === cell.document) ? ed : undefined;
}

export class NotebookWriter implements CellWriter {
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
      },
    });
    this.#disposables.push(this.#decorationType);

    const ed = this.editor;
    if (ed) {
      this.decorate(ed);
    } else {
      this.cancel("No current editor.");
    }
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

    const ed = vscode.window.visibleTextEditors.find((ed) =>
      ed.document === this.#cell.document
    );
    if (!ed || ed !== vscode.window.activeTextEditor) {
      this.cancel("Active editor changed.");
      return undefined;
    }

    return ed;
  }

  /** Inserts a new cell after the current one and starts editing it. */
  private insertCellBelow = async (
    kind: vscode.NotebookCellKind,
  ): Promise<boolean> => {
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
      builder.delete(
        new vscode.Range(prev.range.end, last.rangeIncludingLineBreak.end),
      );
    });

    const command = kind === vscode.NotebookCellKind.Markup
      ? "notebook.cell.insertMarkdownCellBelow"
      : "notebook.cell.insertCodeCellBelow";
    await vscode.commands.executeCommand(command);

    const ed = await editActiveCell();
    if (!ed) {
      console.log("couldn't edit new cell");
      return false;
    }

    const cell = getActiveCell();
    if (
      !cell || cell.index !== this.#cell.index + 1 || cell.kind !== kind ||
      cell.document !== ed.document
    ) {
      console.log("new cell is not the expected one");
      return false;
    }
    this.#cell = cell;

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
  }

  startMarkdownCell(): Promise<boolean> {
    return this.insertCellBelow(vscode.NotebookCellKind.Markup);
  }

  async write(data: string): Promise<boolean> {
    if (!this.#insertedCell) {
      if (!await this.startMarkdownCell()) {
        console.log("NotebookWriter.write: couldn't insert markdown cell.");
        return false;
      }
    }

    const ed = this.editor;
    if (!ed) {
      return false;
    }

    const here = ed.selection.active;
    if (
      here.line !== ed.document.lineCount - 1 ||
      here.character < ed.document.lineAt(here.line).text.length
    ) {
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
    if (this.#cancelled) {
      return false;
    }
    if (this.#disposables.length === 0) {
      return true;
    }
    await this.startMarkdownCell();
    this.cleanup();
    return true;
  }
}
