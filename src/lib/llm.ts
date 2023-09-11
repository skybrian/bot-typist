import * as vscode from "vscode";

import { ChildPipe } from "./processes";
import { readAll } from "./streams";

export function getCommandPath() {
  return vscode.workspace.getConfiguration("bot-typist").get<string>(
    "llm.path",
  );
}

/** Determines whether the llm command works. */
export async function checkCommandPath(
  path: string | undefined,
): Promise<boolean> {
  if (path === undefined) {
    return false;
  }

  let child: ChildPipe<string> | undefined;
  try {
    child = new ChildPipe(path, ["--version"], readAll);
  } catch (e) {
    console.log(`llm error: ${e}`);
    return false;
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
      return false;
    }

    if (!first.startsWith("llm, version ")) {
      console.log(`llm --version output: ${first}`);
    }
    return true;
  } catch (e) {
    console.log(`llm error: ${e}`);
    return false;
  }
}
