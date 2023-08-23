import * as vscode from "vscode";
import { Writer, typeText } from "./stream";

interface CellWriter extends Writer {
  startCodeCell(): Promise<boolean>;
  startMarkdownCell(): Promise<boolean>;
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

export function writerForNotebook(): CellWriter | undefined {

  let cell = getActiveCell();
  if (!cell) {
    return undefined;
  }

  if (!vscode.window.activeTextEditor) {
    return undefined;
  }
  let ed = vscode.window.activeTextEditor;

  var editing = false;
  var cancelled = false;

  // Attach listeners to detect cursor movement or text change
  const disposables: vscode.Disposable[] = [];

  disposables.push(vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor === ed && !editing) {
      cancelled = true;
    }
  }));

  disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === ed.document && !editing) {
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

  const checkDone = () => {
    if (disposables.length === 0) {
      return true;
    }
    cancelled ||= ed !== vscode.window.activeTextEditor;
    cancelled ||= getActiveCell() !== cell;
    if (cancelled) {
      cleanup();
    }
    return disposables.length === 0;
  };

  const startCell = async (command: string): Promise<boolean> => {
    if (checkDone()) {
      return false;
    }
    editing = true;
    try {

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

      await vscode.commands.executeCommand(command);
      await vscode.commands.executeCommand("notebook.cell.edit");
      cell = getActiveCell();
      ed = vscode.window.activeTextEditor!;
      return true;
    } finally {
      editing = false;
    }
  };

  return {
    startCodeCell: (): Promise<boolean>  => startCell("notebook.cell.insertCodeCellBelow"),
    startMarkdownCell: (): Promise<boolean> => startCell("notebook.cell.insertMarkdownCellBelow"),
    write: async (data: string): Promise<boolean> => {
      if (checkDone()) {
        return false;
      }

      editing = true;
      try {
        const ok = await typeText(ed, data);
        cancelled = cancelled || !ok;
        return !cancelled;
      } finally {
        editing = false;
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