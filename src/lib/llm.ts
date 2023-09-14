import { ChildExitError, ChildPipe } from "./processes";
import { readAll, ReadHandler } from "./streams";
import { CANCELLED } from "./botresponse";

export type Config = {
  path: string;
  systemPrompt: string;
  extraArgs: string[];
};

export interface OutputChannel {
  clear(): void;
  appendLine(value: string): void;
  show(): void;
}

export class Service {
  /**
   * Reads the llm command's location and verifies that it works.
   *
   * @returns the path, or the empty string if it doesn't work.
   */
  async checkCommandPath(config: { path: string }): Promise<string> {
    const path = config.path;
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
  async run<T>(
    config: Config,
    prompt: string,
    handler: ReadHandler<T>,
    output: () => OutputChannel,
  ): Promise<T> {
    const out = output();
    out.clear();
    out.appendLine(
      `${config.path} --system $systemPrompt ${config.extraArgs.join(" ")}\n`,
    );

    const args = ["--system", config.systemPrompt].concat(config.extraArgs);
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
