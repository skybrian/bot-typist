import { ChildExitError, ChildPipe } from "./processes";
import { readAll, ReadHandler } from "./streams";
import { CANCELLED } from "./botresponse";

export type Config = {
  path: string;
  systemPrompt: string;
  model: string;
  extraArgs: string[];
};

export interface OutputChannel {
  clear(): void;
  appendLine(value: string): void;
  show(): void;
}

export class Service {
  #config: Config;
  #output: () => OutputChannel;

  constructor(config: Config, output: () => OutputChannel) {
    this.#config = config;
    this.#output = output;
  }

  set config(newConfig: Config) {
    this.#config = newConfig;
  }

  /**
   * Reads the llm command's location and verifies that it works.
   *
   * @returns the path, or the empty string if it doesn't work.
   */
  async checkCommandPath(): Promise<string> {
    const path = this.#config.path;
    if (path === undefined) {
      return "";
    }

    let child: ChildPipe<string> | undefined;
    try {
      child = new ChildPipe(path, ["--version"], readAll);
    } catch (e) {
      console.log(`llm error: ${e}`);
      return "";
    }

    const TIMEOUT = Symbol("timeout");
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(TIMEOUT), 2000)
    );

    try {
      const first = await Promise.race([child.close(), timeout]) as
        | string
        | typeof TIMEOUT;

      if (first === TIMEOUT) {
        child.kill();
        console.log("llm command timed out");
        return "";
      }

      if (!first.startsWith("llm, version ")) {
        console.log(`llm --version output: ${first}`);
      }
      return path;
    } catch (e) {
      console.log(`llm error: ${e}`);
      return "";
    }
  }

  /**
   * Runs the llm command with the given prompt, sending the bot's response to a handler.
   */
  async run<T>(prompt: string, handler: ReadHandler<T>): Promise<T> {
    const config = this.#config;

    const out = this.#output();
    out.clear();
    if (config.path === "") {
      throw new Error("can't run llm command because its path isn't set");
    }

    logCommand(config, out);

    const systemFlag = config.systemPrompt
      ? ["--system", config.systemPrompt]
      : [];
    const modelFlag = config.model ? ["--model", config.model] : [];
    const args = systemFlag.concat(modelFlag, config.extraArgs);

    const stdin = new ChildPipe(config.path, args, handler);
    await stdin.write(prompt);
    try {
      return await stdin.close();
    } catch (e) {
      if (e === CANCELLED) {
        out.appendLine("(cancelled by user)");
      } else if (e instanceof ChildExitError && e.stderr !== "") {
        out.appendLine(e.stderr);
        out.show();
      } else if (e instanceof Error) {
        out.appendLine(`Unexpected error: ${e}`);
        out.show();
      }
      throw e;
    }
  }
}

function logCommand(config: Config, out: OutputChannel) {
  let line = config.path;
  if (config.systemPrompt) {
    out.appendLine("systemPrompt=```");
    out.appendLine(config.systemPrompt);
    out.appendLine("```");
    line += " --system $systemPrompt";
  }
  if (config.model) {
    line += ` --model ${config.model}`;
  }
  if (config.extraArgs.length > 0) {
    line += " " + config.extraArgs.join(" ");
  }
  out.appendLine(line + "\n");
}
