import * as assert from 'assert';
import * as vscode from 'vscode';
import { StringWriter, Writer, writerForEditor, writeStdout } from '../../io';

test('write to text editor', async () => {
    const doc = await vscode.workspace.openTextDocument({
        language: "plaintext",
        content: "First line\n",
    });
    const ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(1, 0, 1, 0);

    const writer: Writer = writerForEditor(ed);
    const edit = "Next line\n";
    
    assert.ok(await writer.write(edit));

    assert.strictEqual(doc.getText(), "First line\nNext line\n");
    assert.strictEqual(ed.selection.active.line, 2);
    assert.strictEqual(ed.selection.active.character, 0);

    assert.ok(await writer.end());

    assert.strictEqual(doc.getText(), "First line\nNext line\n");
    assert.strictEqual(ed.selection.active.line, 2);
    assert.strictEqual(ed.selection.active.character, 0);
});

test('run a command', async () => {
    const buf = new StringWriter();
    assert.ok(await writeStdout(buf, "echo", ["Hello, world!"]));
});

test('run a command with input', async () => {
    const buf = new StringWriter();
    assert.ok(await writeStdout(buf, "cat", [], {stdin: "Hello, world!"}));
    assert.strictEqual(buf.buf, "Hello, world!");
});