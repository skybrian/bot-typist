import * as assert from "assert";
import * as vscode from "vscode";
import { Writer, TextEditorWriter, writeStdout, makePipe, DONE } from "../../lib/stream";

export class StringWriter implements Writer {
  buf = "";

  public async write(data: string): Promise<boolean> {
    this.buf += data;
    return true;
  }

  public async end(): Promise<boolean> {
    return true;
  }
}

describe("EditorWriter", async () => {

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

describe("writeStdout", () => {
  it("writes a command's output to the writer", async () => {
    const buf = new StringWriter();
    assert.ok(await writeStdout(buf, "echo", ["Hello, world!"]));
  });

  it("runs a command that takes input on stdin", async () => {
    const buf = new StringWriter();
    assert.ok(await writeStdout(buf, "cat", [], { stdin: "Hello, world!" }));
    assert.strictEqual(buf.buf, "Hello, world!");
  });
});

describe("makePipe", () => {
  it("works when there's no data to send", async () => {
    const [reader, writer] = makePipe();
    const end = writer.close();
    assert.strictEqual(await reader.read(), DONE);
    assert.ok(await end);
  });

  it("works when immediately cancelled", async () => {
    const [reader, writer] = makePipe();
    const end = writer.close();
    reader.cancel();
    assert.equal(await end, false);
  });


  it("works for one write", async () => {
    const [reader, writer] = makePipe();
    
    const write = writer.write("hello!");
    assert.strictEqual(await reader.read(), "hello!");
    assert.ok(await write);

    const end = writer.close();
    assert.strictEqual(await reader.read(), DONE);
    assert.ok(await end);
  });

  it("works when cancelled after one write", async () => {
    const [reader, writer] = makePipe();
    
    const write = writer.write("hello!");
    assert.strictEqual(await reader.read(), "hello!");
    assert.ok(await write);

    reader.cancel();
    assert.equal(await writer.close(), false);
  });
});