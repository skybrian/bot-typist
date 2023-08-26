import * as assert from "assert";
import { DONE, ParserWriter, Reader, ReadResult, Writer, writeStdout } from "../../lib/streams";

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

const pushAll = (dest: ReadResult[]) => async (reader: Reader): Promise<boolean> => {
  while (true) {
    const chunk = await reader.read();
    dest.push(chunk);
    if (chunk === DONE) {
      return true;
    }
  }
};

describe("ParserWriter", () => {
  describe("for zero writes", () => {
    const reads = [] as ReadResult[];
    const writer = new ParserWriter(pushAll(reads));

    it("doesn't send anything at the start", async () => {
      assert.strictEqual(reads.length, 0);
    });

    it("sends DONE when closed", async () => {
      assert.ok(await writer.close());
      assert.deepStrictEqual(reads, [DONE]);
    });
  });

  describe("for one write", async () => {
    const reads = [] as ReadResult[];
    const writer = new ParserWriter(pushAll(reads));

    it("sends the write", async () => {
      assert.ok(await writer.write("hello!"));
      await Promise.resolve();
      assert.deepStrictEqual(reads, ["hello!"]);
    });

    it("sends DONE when closed", async () => {
      assert.ok(await writer.close());
      assert.deepStrictEqual(reads, ["hello!", DONE]);
    });
  });

  describe("for two writes", async () => {
    const reads = [] as ReadResult[];
    const writer = new ParserWriter(pushAll(reads));

    it("sends the writes", async () => {
      assert.ok(await writer.write("hello!"));
      await Promise.resolve();
      assert.deepStrictEqual(reads, ["hello!"]);
      assert.ok(await writer.write("goodbye!"));
      await Promise.resolve();
      assert.deepStrictEqual(reads, ["hello!", "goodbye!"]);
    });

    it("sends DONE when closed", async () => {
      assert.ok(await writer.close());
      assert.deepStrictEqual(reads, ["hello!", "goodbye!", DONE]);
    });
  });

  describe("write", () => {
    it("returns false if the parser exited", async () => {
      const writer = new ParserWriter(async (_reader) => {
        return true;
      });
      assert.strictEqual(false, await writer.write("hello!"));
    });
  });

  describe("close", () => {
    it("returns the value from the parser", async () => {
      const writer = new ParserWriter(async (_reader) => {
        return "whatever";
      });  
      assert.strictEqual("whatever", await writer.close());
    });

    it("throws an error when the parser throws", async () => {
      const writer = new ParserWriter(async (_reader) => {
        await Promise.resolve();
        throw new Error("parser error");
      });  
      await assert.rejects(writer.close());
    });
  });
});
