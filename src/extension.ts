import * as vscode from "vscode";
import * as child_process from "child_process";
import * as util from "util";

import { Writer, TextEditorWriter, writeStdout } from "./lib/stream";
import { getActiveCell, writerForNotebook } from "./lib/notebook";

const selector: vscode.DocumentSelector = [
  'plaintext', 'markdown'
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

async function typeBotReply(out: Writer, prompt: string, options?: {prefix?: string, suffix?: string}): Promise<boolean> {
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

  if (!await writeStdout(out, path, [], {stdin: prompt})) {
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
function choosePromptStart(ed: vscode.TextEditor, endLine: number): vscode.Position {
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
      let prompt = '';
      for (let i = 0; i <= cell.index; i++) {
        const c = cell.notebook.cellAt(i);
        if (i > 0) {
          prompt += '\n%%\n';
        }
        prompt += c.document.getText();
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

async function typeAsBot() {
  console.log("typeAsBot called");

  const prompt = choosePrompt();
  if (!prompt) {
    console.log("typeAsBot: no prompt");
    return;
  }

  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeAsBot: selection not empty");
    return false;
  }

  // Move cursor to end of line
  const line = ed.document.lineAt(ed.selection.active);
  const lineEnd = line.range.end;
  ed.selection = new vscode.Selection(lineEnd, lineEnd);

  // Choose prefix to type at end of line
  console.log(`line: '${line.text}'`);
  let prefix = "\n\nbot: ";
  if (line.text.length === 0) {
    if (
      line.lineNumber > 0 &&
      ed.document.lineAt(line.lineNumber - 1).text.trim().length > 0
    ) {
      prefix = "\nbot:";
    } else {
      prefix = "bot: ";
    }
  } else if (line.text.endsWith(": ")) {
    prefix = "";
  } else if (line.text.endsWith(":")) {
    prefix = " ";
  } else if (line.text === "bot") {
    prefix = ": ";
  }
  console.log(`prefix: '${prefix}'`);

  const writer = new TextEditorWriter(ed);
  try {
    await typeBotReply(writer, prompt, {prefix, suffix: '\n'});
  } finally {
    await writer.close();
  } 
}

/** If in a notebook cell, insert a new markdown cell with the bot's reply. */
async function insertReplyBelow(): Promise<boolean> {
  const prompt = choosePrompt();
  if (!prompt) {
    console.log("insertReplyBelow: no prompt");
    return false;
  }

  const path = getCommandPath();
  if (!path || await checkCommandPath(path) !== ConfigState.ok) {
    showConfigError(
      `Can't run llm command. Check that bot-typist.llm.path is set correctly in settings.`,
    );
    return false;
  }

  if (vscode.window.activeNotebookEditor) {
    const writer = writerForNotebook();
    if (!writer) {
      console.log("insertReplyBelow: no notebook writer");
      return false;
    }

    try {
      if (!await writer.startMarkdownCell()) {
        console.log("insertReplyBelow: couldn't create markdown cell for reply");
        return false;
      }

      if (!await writeStdout(writer, path, [], {stdin: prompt})) {
        return false;
      }

      if (!await writer.startMarkdownCell()) {
        console.log("insertReplyBelow: couldn't create markdown cell after reply");
        return false;
      }
    } finally {
      await writer.close();
    }

    return true;    
  }

  // TODO: non-notebook version
  return false;
}

/** Open a new editor tab with the prompt used for the current position. */
async function showPrompt(): Promise<boolean> {  
  const prompt = choosePrompt();
  if (!prompt) {
    console.log("showPrompt: no prompt to show");
    return false;
  }

  const doc = await vscode.workspace.openTextDocument({content: prompt, language: 'plaintext'});
  await vscode.window.showTextDocument(doc, {viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true});
  return true;
}

const botPattern = /bot:?\s*$/;

const completion: vscode.CompletionItemProvider = {
  provideCompletionItems(document, position) {
    const linePrefix = document.lineAt(position).text.substring(
      0,
      position.character,
    );

    if (!botPattern.test(linePrefix)) {
      return undefined;
    }

    console.log("adding completion item");

    let item = new vscode.CompletionItem("Talk to Bot");
    item.insertText = "";
    item.command = { command: "bot-typist.type", title: "Talk to Bot" };
    return [item];
  },
};

export function activate(context: vscode.ExtensionContext) {
  console.log("activate called");

  const push = context.subscriptions.push.bind(context.subscriptions);

  // commands
  push(vscode.commands.registerCommand("bot-typist.type", typeAsBot));
  push(vscode.commands.registerCommand("bot-typist.insert-reply-below", insertReplyBelow));
  push(vscode.commands.registerCommand("bot-typist.show-prompt", showPrompt));

  push(
    vscode.languages.registerCompletionItemProvider(selector, completion, ":"),
  );
}

export function deactivate() {}
