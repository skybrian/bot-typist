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

describe("llm.run", () => {
  it("sends the appropriate options to the command and the output channel", async () => {
    const testChannel = new TestChannel();
    const options = {
      systemPrompt: () => "You're a bot",
      extraOptions: () => ["--asdf"],
    };

    const result = await llm.run(
      "echo",
      "",
      readAll,
      () => testChannel,
      options,
    );
    expect(result).toEqual("--system You're a bot --asdf\n");
    expect(testChannel.log).toEqual("echo --system $systemPrompt --asdf\n\n");
  });
});
