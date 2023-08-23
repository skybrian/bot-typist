import * as assert from "assert";
import * as vscode from "vscode";
import { Writer, EditorWriter, writeStdout, makePipe, DONE } from "../../lib/stream";

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

describe("EditorWriter", () => {
  before(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    this.doc = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: "First line\n",
    });
    this.ed = await vscode.window.showTextDocument(this.doc);
    this.ed.selection = new vscode.Selection(1, 0, 1, 0);
    this.writer = new EditorWriter(this.ed);
  });

  describe("write", () => {
    it("writes to the text editor", async function () {
      assert.ok(await this.writer.write("Next line\n"), "write failed");
      assert.strictEqual(this.doc.getText(), "First line\nNext line\n");
    });
  
    it("moves the cursor", function () {
      assert.strictEqual(this.ed.selection.active.line, 2);
      assert.strictEqual(this.ed.selection.active.character, 0);
    });
  });

  describe("dispose", () => {
    it("doesn't modify the document or move the cursor", async function () {
      await this.writer.dispose();
  
      assert.strictEqual(this.doc.getText(), "First line\nNext line\n");
      assert.strictEqual(this.ed.selection.active.line, 2);
      assert.strictEqual(this.ed.selection.active.character, 0);
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
    const end = writer.end();
    assert.strictEqual(await reader.read(), DONE);
    assert.ok(await end);
  });

  it("works when immediately cancelled", async () => {
    const [reader, writer] = makePipe();
    const end = writer.end();
    reader.cancel();
    assert.equal(await end, false);
  });


  it("works for one write", async () => {
    const [reader, writer] = makePipe();
    
    const write = writer.write("hello!");
    assert.strictEqual(await reader.read(), "hello!");
    assert.ok(await write);

    const end = writer.end();
    assert.strictEqual(await reader.read(), DONE);
    assert.ok(await end);
  });

  it("works when cancelled after one write", async () => {
    const [reader, writer] = makePipe();
    
    const write = writer.write("hello!");
    assert.strictEqual(await reader.read(), "hello!");
    assert.ok(await write);

    reader.cancel();
    assert.equal(await writer.end(), false);
  });
});