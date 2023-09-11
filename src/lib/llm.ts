import * as vscode from "vscode";

import { ChildPipe } from "./processes";
import { readAll, Reader } from "./streams";
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

/**
 * Runs the llm command with the given prompt, sending the bot's response to a handler.
 */
export async function run(
  llmPath: string,
  prompt: string,
  handler: (input: Reader) => Promise<void>,
) {
  const stdin = new ChildPipe(
    llmPath,
    ["--system", chooseSystemPrompt()],
    handler,
  );
  await stdin.write(prompt);
  await stdin.close();
  return true;
}
