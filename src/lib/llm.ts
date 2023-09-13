import * as vscode from "vscode";

import { ChildExitError, ChildPipe } from "./processes";
import { readAll, ReadHandler } from "./streams";
import { chooseSystemPrompt } from "./botrequest";

/**
 * Reads the llm command's location and verifies that it works.
 *
 * @returns the path, or the empty string if it doesn't work.
 */
export async function checkCommandPath(): Promise<string> {
  const path = vscode.workspace.getConfiguration("bot-typist").get<string>(
    "llm.path",
  );

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

export interface OutputChannel {
  clear(): void;
  appendLine(value: string): void;
  show(): void;
}

/**
 * Runs the llm command with the given prompt, sending the bot's response to a handler.
 */
export async function run<T>(
  llmPath: string,
  prompt: string,
  handler: ReadHandler<T>,
  output: () => OutputChannel,
  options = {
    systemPrompt: chooseSystemPrompt,
    extraOptions: readOptions,
  },
): Promise<T> {
  const extra = options.extraOptions();

  const out = output();
  out.clear();
  out.appendLine(
    `${llmPath} --system $systemPrompt ${extra.join(" ")}\n`,
  );

  const flags = ["--system", options.systemPrompt()].concat(extra);
  const stdin = new ChildPipe(llmPath, flags, handler);
  await stdin.write(prompt);
  try {
    return await stdin.close();
  } catch (e) {
    if (e instanceof ChildExitError && e.stderr !== "") {
      out.appendLine(e.stderr);
      out.show();
    } else {
      out.appendLine(`Unexpected error: ${e}`);
    }
    throw e;
  }
}

export function optionsChangedFromDefault(): boolean {
  return JSON.stringify(readOptions()) !== JSON.stringify(defaultOptions);
}

const defaultOptions: string[] = [];

function readOptions(): string[] {
  return vscode.workspace.getConfiguration("bot-typist").get<string[]>(
    "llm.options",
  ) ?? defaultOptions;
}
