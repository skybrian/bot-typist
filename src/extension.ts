import * as vscode from "vscode";

import {
  convertCell,
  editCell,
  getActiveCell,
  NotebookWriter,
} from "./lib/notebooks";

import { BotResponse } from "./lib/botresponse";
import { ChildPipe } from "./lib/processes";
import { readAll, Reader } from "./lib/streams";
import { chooseBotPrompt, chooseSystemPrompt } from "./lib/botrequest";

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
  if (path === undefined) {
    return ConfigState.unconfigured;
  }

  let child: ChildPipe<string> | undefined;
  try {
    child = new ChildPipe(path, ["--version"], readAll);
  } catch (e) {
    console.log(`llm error: ${e}`);
    return ConfigState.commandNotFound;
  }

  const TIMEOUT = Symbol("timeout");
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(TIMEOUT), 2000)
  );

  try {
    const first = await Promise.race([child.close(), timeout]);

    if (first === TIMEOUT) {
      child.kill();
      return ConfigState.commandTimedOut;
    }

    console.log(`llm --version output: ${first}`);
    return ConfigState.ok;
  } catch (e) {
    console.log(`llm error: ${e}`);
    return ConfigState.commandDidntRun;
  }
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
  const activeCell = getActiveCell();
  if (activeCell) {
    const notebook = activeCell.notebook;
    const cellAt = (index: number) => convertCell(notebook.cellAt(index));
    return chooseBotPrompt(cellAt, activeCell.index);
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

function decorateWhileEmpty(
  editor: vscode.TextEditor,
  placeholderText: string,
) {
  const disposables = [] as vscode.Disposable[];

  const cleanup = () => {
    for (const d of disposables) {
      d.dispose();
    }
  };

  const placeholder = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: {
      contentText: placeholderText,
      color: "rgba(180,180,220,0.5)",
      fontStyle: "italic",
    },
  });
  disposables.push(placeholder);

  let decorated = false;
  const renderDecoration = (doc: vscode.TextDocument) => {
    if (doc !== editor.document) {
      return;
    }
    if (editor.document.getText().length === 0) {
      if (!decorated) {
        const zero = editor.document.positionAt(0);
        editor.setDecorations(placeholder, [new vscode.Range(zero, zero)]);
        decorated = true;
      }
    } else {
      editor.setDecorations(placeholder, []);
      decorated = false;
    }
  };

  renderDecoration(editor.document);

  disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
    renderDecoration(e.document);
  }));

  disposables.push(vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc === editor.document) {
      cleanup();
    }
  }));
}

async function createUntitledNotebook(): Promise<boolean> {
  const cells = [
    new vscode.NotebookCellData(
      vscode.NotebookCellKind.Markup,
      "Type your question in the next cell and then type **Control-Alt Enter** to get a response. (Command-return on a Mac.)\n" +
        "\n" +
        "A horizonal rule in a Markdown cell indicates the start of a chat. Anything above it won't be seen by the bot.\n" +
        "\n" +
        "---\n",
      "markdown",
    ),
    new vscode.NotebookCellData(
      vscode.NotebookCellKind.Markup,
      "",
      "markdown",
    ),
  ];
  cells[0].metadata = {};
  cells[1].metadata = {};
  const data = new vscode.NotebookData(cells);

  /* eslint-disable @typescript-eslint/naming-convention */
  // some metadata copied from ipynb.newUntitledIpynb:
  // https://github.com/microsoft/vscode/blob/42ce7b7a2eeaa102ee40605a446174fce71c285a/extensions/ipynb/src/ipynbMain.ts#L76
  data.metadata = {
    custom: {
      cells: [],
      metadata: {
        orig_nbformat: 4,
        // Try to select a Python 3 kernel.
        // These settings assume a virtual environment containing Jupyter.
        // See: jupyter kernelspec list
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
      },
      nbformat: 4,
      nbformat_minor: 2,
    },
  };

  const doc = await vscode.workspace.openNotebookDocument(
    "jupyter-notebook",
    data,
  );
  await vscode.window.showNotebookDocument(doc);

  const ed = await editCell(doc.cellAt(1));
  if (!ed) {
    console.log("createUntitledNotebook: couldn't edit cell");
    return false;
  }

  decorateWhileEmpty(
    ed,
    "Type your question here.",
  );
  return true;
}

/** If in a notebook cell, inserts cells below with the bot's reply. */
async function insertReply(): Promise<boolean> {
  let cell = getActiveCell();
  if (!cell) {
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

  try {
    const writer = new NotebookWriter(cell);

    const copyResponse = async (input: Reader) => {
      if (!await new BotResponse(input, "🤖").copy(writer)) {
        console.log("bot response cancelled");
        return;
      }
      await writer.close();
    };

    const stdin = new ChildPipe(
      llmPath,
      ["--system", chooseSystemPrompt()],
      copyResponse,
    );
    await stdin.write(prompt);
    await stdin.close();
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/** Open a new editor tab with the prompt used for the current position. */
async function showPrompt(): Promise<boolean> {
  const prompt = choosePrompt();
  if (!prompt) {
    console.log("showPrompt: no prompt to show");
    return false;
  }

  const system = chooseSystemPrompt();
  const content = `System Prompt\n---\n${system}\nUser Prompt\n---\n${prompt}`;

  const doc = await vscode.workspace.openTextDocument({
    content: content,
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
    "bot-typist.create-untitled-notebook",
    createUntitledNotebook,
  ));

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
