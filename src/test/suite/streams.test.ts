import * as assert from "assert";
import { DONE, makePipe, Writer, writeStdout } from "../../lib/streams";

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

export class CancellingWriter implements Writer {
  public async write(data: string): Promise<boolean> {
    return false;
  }

  public async end(): Promise<boolean> {
    return true;
  }
}

describe("writeStdout", () => {
  it("writes a command's output to the writer", async () => {
    const buf = new StringWriter();
    assert.ok(await writeStdout(buf, "echo", ["Hello, world!"]));
    assert.strictEqual(buf.buf, "Hello, world!\n");
  });

  it("returns false if the write is cancelled", async () => {
    const buf = new CancellingWriter();
    assert.equal(false, await writeStdout(buf, "echo", ["Hello, world!"]));
  });

  it("runs a command that takes input on stdin", async () => {
    const buf = new StringWriter();
    assert.ok(await writeStdout(buf, "cat", [], { stdin: "Hello, world!" }));
    assert.strictEqual(buf.buf, "Hello, world!");
  });

  it("returns false if the write is cancelled, with input on stdin", async () => {
    const buf = new CancellingWriter();
    assert.equal(false, await writeStdout(buf, "cat", [], { stdin: "Hello, world!" }));
  });

  it("rejects if the command doesn't exist", async () => {
    const buf = new StringWriter();
    assert.rejects(writeStdout(buf, "this-command-does-not-exist", []));
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
