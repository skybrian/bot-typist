import { expect } from "expect";

import * as llm from "../../lib/llm";
import { readAll } from "../../lib/streams";

class TestChannel implements llm.OutputChannel {
  log = "";

  clear() {
    this.log = "";
  }

  appendLine(value: string): void {
    this.log += value + "\n";
  }

  show(): void {
  }
}

describe("llm.Service", () => {
  describe("run", () => {
    it("sends the appropriate arguments to the command and the output channel", async () => {
      const testChannel = new TestChannel();
      const config = {
        path: "echo",
        systemPrompt: "You're a bot",
        extraArgs: ["--asdf"],
      };

      const service = new llm.Service();
      const result = await service.run(
        config,
        "",
        readAll,
        () => testChannel,
      );
      expect(result).toEqual("--system You're a bot --asdf\n");
      expect(testChannel.log).toEqual("echo --system $systemPrompt --asdf\n\n");
    });
  });
});
