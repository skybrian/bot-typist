import * as vscode from "vscode";

import { ChildExitError, ChildPipe } from "./processes";
import { readAll, ReadHandler } from "./streams";

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
  configProvider = () => getConfig(),
): Promise<T> {
  const config = configProvider();

  const out = output();
  out.clear();
  out.appendLine(
    `${llmPath} --system $systemPrompt ${config.extraArgs.join(" ")}\n`,
  );

  const args = ["--system", config.systemPrompt].concat(config.extraArgs);
  const stdin = new ChildPipe(llmPath, args, handler);
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

export const getConfig = () => {
  const conf = vscode.workspace.getConfiguration("bot-typist");

  const systemPrompt = conf.get<string>("llm.systemPrompt") ??
    `You are a helpful AI assistant that's participating in a conversation in a Jupyter notebook.

You can see any Markdown and Python cells from the conversation so far, indicated by #markdown and #python.
If the user executed a Python cell, each cell output will follow it, indicated by #output.

You can reply using Markdown. Python code blocks should contain real Python code that will run without errors.
They will be converted into Python cells and executed when the user chooses.

To display an image, write Python code that evaluates to an image object. The image will appear as a cell output.

Here is the current date and time: ${new Date()}.
`;

  const extraArgs = conf.get<string[]>("llm.extraArguments") ?? [];

  return { systemPrompt, extraArgs };
};

export function extraArgsChangedFromDefault(): boolean {
  return JSON.stringify(getConfig().extraArgs) !== JSON.stringify([]);
}
