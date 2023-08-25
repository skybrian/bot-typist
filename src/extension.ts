import * as vscode from "vscode";
import * as child_process from "child_process";
import * as util from "util";

import { getActiveCell, writerForNotebook } from "./lib/editors";
import { splitCells } from "./lib/parsers";
import { makePipe, Writer, writeStdout } from "./lib/streams";

const selector: vscode.DocumentSelector = [
  "plaintext",
  "markdown",
];

function getCommandPath() {
  return vscode.workspace.getConfiguration("bot-typist").get<string>(
    "llm.path",
  );
}

enum ConfigState {
  unconfigured,
  commandNotFound,
  commandTimedOut,
  commandDidntRun,
  ok,
}

/** Determines whether the llm command works. */
async function checkCommandPath(
  path: string | undefined,
): Promise<ConfigState> {
  console.log("checkConfig called");

  if (path === undefined) {
    return ConfigState.unconfigured;
  }

  const execFile = util.promisify(child_process.execFile);

  try {
    const { stdout, stderr } = await execFile(path, ["--version"], {
      timeout: 2000,
    });

    if (stderr) {
      console.log(`llm error: '${stdout}'`);
      return ConfigState.commandDidntRun;
    }

    console.log(`llm output: '${stdout}'`);
    return ConfigState.ok;
  } catch (e) {
    if (typeof e === "object" && e !== null && "signal" in e) {
      console.log(`llm error: ${e} signal: ${e.signal}`);
      if (e.signal === "SIGTERM") {
        return ConfigState.commandTimedOut;
      }
      return ConfigState.commandDidntRun;
    }
    console.log(`llm error: ${e}`);
    return ConfigState.commandNotFound;
  }
}

async function typeBotReply(
  out: Writer,
  prompt: string,
  options?: { prefix?: string; suffix?: string },
): Promise<boolean> {
  const path = getCommandPath();
  if (!path || await checkCommandPath(path) !== ConfigState.ok) {
    showConfigError(
      `Can't run llm command. Check that bot-typist.llm.path is set correctly in settings.`,
    );
    return false;
  }

  const prefix = options?.prefix;
  if (prefix && !await out.write(prefix)) {
    return false;
  }

  if (!await writeStdout(out, path, [], { stdin: prompt })) {
    return false;
  }

  const suffix = options?.suffix;
  if (suffix && !await out.write(suffix)) {
    return false;
  }

  return true;
}

function showConfigError(msg: string) {
  vscode.window.showErrorMessage(msg, "Open Settings").then((choice) => {
    if (choice === "Open Settings") {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "bot-typist.llm.path",
      );
    }
  });
}

/**
 * Returns the position of the start of the prompt to send to the llm tool.
 * If there is a <blockquote> element, it returns the start of the line after that.
 * Otherwise, it returns the first line of the document.
 * @param ed The editor to search.
 * @param endLine The line number after the last line of the prompt.
 */
function choosePromptStart(
  ed: vscode.TextEditor,
  endLine: number,
): vscode.Position {
  for (let i = endLine - 1; i >= 0; i--) {
    const line = ed.document.lineAt(i);
    if (line.text.trim() === "<blockquote>") {
      return line.range.start.translate(1);
    }
  }
  return new vscode.Position(0, 0);
}

function choosePrompt(): string | undefined {
  const cell = getActiveCell();
  if (cell) {
    // Include the text of each cell up to the current one.
    let prompt = "";
    for (let i = 0; i <= cell.index; i++) {
      const doc = cell.notebook.cellAt(i).document;
      prompt += `%${doc.languageId}\n${doc.getText()}\n`;
    }

    return prompt;
  }

  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    return undefined;
  }

  const promptStart = choosePromptStart(ed, ed.selection.active.line);
  console.log(`prompt start: ${ed.document.lineAt(promptStart.line).text}`);
  const promptRange = new vscode.Range(promptStart, ed.selection.active);
  const prompt = ed.document.getText(promptRange);
  return prompt;
}

/** If in a notebook cell, insert a new markdown cell with the bot's reply. */
async function insertReply(): Promise<boolean> {
  const cellWriter = writerForNotebook();
  if (!cellWriter) {
    return false;
  }

  const prompt = choosePrompt();
  if (!prompt) {
    console.log("insertReply: no prompt");
    return false;
  }

  const llmPath = getCommandPath();
  if (!llmPath || await checkCommandPath(llmPath) !== ConfigState.ok) {
    showConfigError(
      `Can't run llm command. Check that bot-typist.llm.path is set correctly in settings.`,
    );
    return false;
  }

  const systemPrompt =
    `You are a helpful AI assistant that's participating in a conversation in a Jupyter notebook.

Replies consist of one or more cells. Before writing anything else, always write
'%markdown' or '%python' on a line by itself, to indicate the cell type.

When writing Python code, first write a Markdown cell explaining what you're doing,
followed by the Python code in a separate cell.

To display an image, write an expression that evaluates to the image.
`;

  const [pipeOut, pipeIn] = makePipe();
  const commandDone = writeStdout(
    pipeIn,
    llmPath,
    ["--system", systemPrompt],
    {
      stdin: prompt,
    },
  );
  const parseDone = splitCells(cellWriter, pipeOut);
  try {
    try {
      await commandDone;
    } finally {
      pipeIn.close();
    }
    console.log("command done");

    await parseDone;
    console.log("parse done");
    await cellWriter.startMarkdownCell();
    return true;
  } finally {
    await cellWriter.close();
    console.log("notebook writer closed");
  }
}

/** Open a new editor tab with the prompt used for the current position. */
async function showPrompt(): Promise<boolean> {
  const prompt = choosePrompt();
  if (!prompt) {
    console.log("showPrompt: no prompt to show");
    return false;
  }

  const doc = await vscode.workspace.openTextDocument({
    content: prompt,
    language: "plaintext",
  });
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    preserveFocus: true,
  });
  return true;
}

export function activate(context: vscode.ExtensionContext) {
  const push = context.subscriptions.push.bind(context.subscriptions);

  push(vscode.commands.registerCommand(
    "bot-typist.insert-reply",
    insertReply,
  ));
  push(vscode.commands.registerCommand(
    "bot-typist.show-prompt",
    showPrompt,
  ));
}

export function deactivate() {}
