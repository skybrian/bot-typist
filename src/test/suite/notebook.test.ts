import * as assert from "assert";
import * as vscode from "vscode";
import { writerForNotebook } from "../../lib/notebook";

function checkCells(expectedCells: string[]) {
  const noteEd = vscode.window.activeNotebookEditor;
  assert.ok(noteEd);
  for (let i = 0; i < expectedCells.length; i++) {
    assert.ok(i < noteEd.notebook.cellCount);
    const cell: vscode.NotebookCell = noteEd.notebook.cellAt(i);
    assert.strictEqual(cell.document.getText(), expectedCells[i]);
  }
  assert.strictEqual(noteEd.notebook.cellCount, expectedCells.length);
}

function checkCellKinds(expectedKinds: vscode.NotebookCellKind[]) {
  const noteEd = vscode.window.activeNotebookEditor;
  assert.ok(noteEd);
  for (let i = 0; i < expectedKinds.length; i++) {
    assert.ok(i < noteEd.notebook.cellCount);
    const cell: vscode.NotebookCell = noteEd.notebook.cellAt(i);
    assert.strictEqual(cell.kind, expectedKinds[i], `cell ${i} kinds differ`);
  }
  assert.strictEqual(noteEd.notebook.cellCount, expectedKinds.length);
}

function checkCursor(expectedCell: number, expectedLine: number, expectedCharacter: number) {
  const noteEd = vscode.window.activeNotebookEditor;
  assert.ok(noteEd);
  assert.strictEqual(noteEd.selection.start, expectedCell);
  assert.strictEqual(noteEd.selection.end, expectedCell + 1);
  const cell = noteEd.notebook.cellAt(expectedCell);

  const ed = vscode.window.activeTextEditor;
  assert.ok(ed);
  assert.strictEqual(ed.document, cell.document);
  assert.strictEqual(ed.selection.active.line, expectedLine);
  assert.strictEqual(ed.selection.active.character, expectedCharacter);
}

describe("writerForNotebook", () => {
  before(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    const cell = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      "First line\n",
      "python",
    );
    this.notebook = await vscode.workspace.openNotebookDocument(
      "jupyter-notebook",
      new vscode.NotebookData([cell]),
    );

    const noteEd = await vscode.window.showNotebookDocument(this.notebook);
    checkCellKinds([vscode.NotebookCellKind.Code]);

    assert.strictEqual(noteEd.selection.start, 0);
    assert.strictEqual(noteEd.selection.end, 1);
    this.noteEd = noteEd;

    const ed = vscode.window.activeTextEditor;
    assert.ok(ed, "no active editor");
    ed.selection = new vscode.Selection(1, 0, 1, 0);
    this.ed = ed;
  });

  it("creates a writer when a notebook cell is active", async function () {
    const w = writerForNotebook();
    assert.ok(w);
    assert.ok(w.write);
    this.writer = w;
  });

  it("writes to the text editor", async function () {
    const edit = "Next line\n";
    assert.ok(await this.writer.write(edit), "write failed");
    checkCells(["First line\nNext line\n"]);
  });

  it("moves the cursor", function () {
    checkCursor(0, 2, 0);
  });

  it("appends a markdown cell", async function () {
    assert.ok(await this.writer.startMarkdownCell());
    checkCells(["First line\nNext line", ""]);
    checkCursor(1, 0, 0);
  });

  it("writes to the new cell", async function () {
    const edit = "Cell 2\n";
    assert.ok(await this.writer.write(edit));
    checkCells(["First line\nNext line", "Cell 2\n"]);
    checkCellKinds([vscode.NotebookCellKind.Code, vscode.NotebookCellKind.Markup]);
    checkCursor(1, 1, 0);
  });

  it("end doesn't change the cells or cursor", async function () {
    assert.ok(await this.writer.end());
    checkCells(["First line\nNext line", "Cell 2\n"]);
    checkCursor(1, 1, 0);
  });
});
