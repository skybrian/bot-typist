import * as assert from "assert";
import { ChildPipe } from "../../lib/processes";
import { readAll, Reader } from "../../lib/streams";

describe("ChildPipe", () => {
  describe("using echo", () => {
    it("emits a newline with no arguments", async () => {
      const stdout = await new ChildPipe("echo", [], readAll).close();
      assert.strictEqual("\n", stdout);
    });

    it("writes the command's output to stdout", async () => {
      const stdout = await new ChildPipe("echo", ["hello!"], readAll).close();
      assert.strictEqual("hello!\n", stdout);
    });

    it("throws an exception if an attempt is made to write to stdin", async () => {
      const stdin = new ChildPipe("echo", [], readAll);
      assert.rejects(() => stdin.write("hello!"));
    });
  });

  describe("using cat", () => {
    it("does nothing when closed immediately", async () => {
      const stdout = await new ChildPipe("cat", [], readAll).close();
      assert.strictEqual("", stdout);
    });

    it("copies one write from stdin to stdout", async () => {
      const stdin = new ChildPipe("cat", [], readAll);
      stdin.write("Hello!");
      const stdout = await stdin.close();
      assert.strictEqual(stdout, "Hello!");
    });

    it("throws an exception for invalid usage", async () => {
      const expectedError = {
        name: "ChildProcessError",
        message: "process exited with exit code 1",
        stderr: /usage: cat/,
      };

      const stdin = new ChildPipe("cat", ["-+"], readAll);
      assert.rejects(stdin.close(), expectedError);
    });

    it("throws whatever exception the handler threw", async () => {
      const handler = async (_: Reader) => {
        throw new Error("cancelled");
      };

      const expectedError = {
        name: "Error",
        message: "cancelled",
      };

      const stdin = new ChildPipe("cat", [], handler);
      assert.rejects(stdin.close(), expectedError);
    });
  });
});
