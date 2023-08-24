import * as assert from "assert";
import * as vscode from "vscode";

import { TextEditorWriter, writerForNotebook } from "../../lib/editors";

describe("TextEditorWriter", async () => {

  let doc: vscode.TextDocument;
  let ed: vscode.TextEditor;
  let writer: TextEditorWriter;

  before(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    doc = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: "First line\n",
    });
    ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(1, 0, 1, 0);
    writer = new TextEditorWriter(ed);
  });

  describe("write", () => {
    it("writes to the text editor", async function () {
      assert.ok(await writer.write("Next line\n"), "write failed");
      assert.strictEqual(doc.getText(), "First line\nNext line\n");
    });
  
    it("moves the cursor", function () {
      assert.strictEqual(ed.selection.active.line, 2);
      assert.strictEqual(ed.selection.active.character, 0);
    });
  });

  describe("close", () => {
    it("doesn't modify the document or move the cursor", async function () {
      await writer.close();
  
      assert.strictEqual(doc.getText(), "First line\nNext line\n");
      assert.strictEqual(ed.selection.active.line, 2);
      assert.strictEqual(ed.selection.active.character, 0);
    });  
  });
});

interface Cell {
  lang: string;
  text: string;
}

async function setupNotebook(cells: Cell[]): Promise<vscode.NotebookEditor> {
  const langToKind = (lang: string): vscode.NotebookCellKind => {
    switch (lang) {
      case "markdown":
        return vscode.NotebookCellKind.Markup;
      case "python":
        return vscode.NotebookCellKind.Code;
      default:
        throw new Error(`Unknown language: ${lang}`);
    }
  };
  const cellData = cells.map((c) =>
    new vscode.NotebookCellData(langToKind(c.lang), c.text, c.lang)
  );
  const notebook = await vscode.workspace.openNotebookDocument(
    "jupyter-notebook",
    new vscode.NotebookData(cellData),
  );
  return vscode.window.showNotebookDocument(notebook);
}

function checkCells(expectedCells: string[]) {
  const noteEd = vscode.window.activeNotebookEditor;
  assert.ok(noteEd);
  for (let i = 0; i < expectedCells.length; i++) {
    if (i >= noteEd.notebook.cellCount) {
      assert.fail(`cell ${i} doesn't exist`);
    }
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

function checkCursor(
  expectedCell: number,
  expectedLine: number,
  expectedCharacter: number,
) {
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

    const noteEd = await setupNotebook([{
      lang: "python",
      text: "First line\n",
    }]);
    checkCellKinds([vscode.NotebookCellKind.Code]);

    assert.strictEqual(noteEd.selection.start, 0);
    assert.strictEqual(noteEd.selection.end, 1);
    this.noteEd = noteEd;

    const ed = vscode.window.activeTextEditor;
    assert.ok(ed, "no active editor");
    ed.selection = new vscode.Selection(1, 0, 1, 0);
    this.ed = ed;
  });

  it("creates a writer for an active notebook cell", async function () {
    const w = writerForNotebook();
    assert.ok(w);
    assert.ok(w.write);
    this.writer = w;
  });

  describe("write", () => {
    it("starts a new markdown cell automatically", async function () {
      const edit = "Next line\n";
      assert.ok(await this.writer.write(edit), "write failed");
      checkCells(["First line", "Next line\n"]);
      checkCellKinds([
        vscode.NotebookCellKind.Code,
        vscode.NotebookCellKind.Markup,
      ]);
    });

    it("moves the cursor", function () {
      checkCursor(1, 1, 0);
    });
  });

  describe("startMarkdownCell", () => {
    it("appends a markdown cell", async function () {
      assert.ok(await this.writer.startMarkdownCell());
      checkCells(["First line", "Next line", ""]);
      checkCellKinds([
        vscode.NotebookCellKind.Code,
        vscode.NotebookCellKind.Markup,
        vscode.NotebookCellKind.Markup,
      ]);
    });

    it("moves the cursor", function () {
      checkCursor(2, 0, 0);
    });
  });

  describe("write", () => {
    it("writes to the new cell", async function () {
      assert.ok(await this.writer.write("Cell 2\n"), "write failed");
      checkCells(["First line", "Next line", "Cell 2\n"]);
    });

    it("moves the cursor", function () {
      checkCursor(2, 1, 0);
    });
  });

  describe("close", () => {
    it("close doesn't change the cells or cursor", async function () {
      assert.ok(await this.writer.close());
      checkCells(["First line", "Next line", "Cell 2\n"]);
      checkCursor(2, 1, 0);
    });
  });
});
