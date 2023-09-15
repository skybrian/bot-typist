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
    it("doesn't run an empty configuation", async () => {
      const config: llm.Config = {
        path: "",
        systemPrompt: "",
        model: "",
        extraArgs: [],
      };

      const testChannel = new TestChannel();
      const service = new llm.Service(config, () => testChannel);
      expect(service.run("", readAll)).rejects.toThrowError();
    });

    it("sends no arguments for an almost empty configuation", async () => {
      const config: llm.Config = {
        path: "echo",
        systemPrompt: "",
        model: "",
        extraArgs: [],
      };

      const testChannel = new TestChannel();
      const service = new llm.Service(config, () => testChannel);

      const result = await service.run("", readAll);
      expect(result).toEqual("\n");
      expect(testChannel.log).toEqual(
        "echo\n\n",
      );
    });

    it("sends all arguments for a filled configuration", async () => {
      const config = {
        path: "echo",
        systemPrompt: "You're a bot",
        model: "gpt5",
        extraArgs: ["--asdf"],
      };

      const testChannel = new TestChannel();
      const service = new llm.Service(config, () => testChannel);

      const result = await service.run("", readAll);
      expect(result).toEqual("--system You're a bot --model gpt5 --asdf\n");
      expect(testChannel.log).toEqual(
        "systemPrompt=```\n" +
          "You're a bot\n" +
          "```\n" +
          "echo --system $systemPrompt --model gpt5 --asdf\n\n",
      );
    });

    it("uses the new config after it changes", async () => {
      const config = {
        path: "echo",
        systemPrompt: "You're a bat",
        model: "huh",
        extraArgs: ["--jkl"],
      };
      const testChannel = new TestChannel();
      const service = new llm.Service(config, () => testChannel);

      service.config = {
        path: "echo",
        systemPrompt: "",
        model: "",
        extraArgs: [],
      };

      const result = await service.run("", readAll);
      expect(result).toEqual("\n");
      expect(testChannel.log).toEqual("echo\n\n");
    });
  });
});
