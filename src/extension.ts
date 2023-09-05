import * as vscode from "vscode";

import { NotebookWriter, getActiveCell, editActiveCell } from "./lib/editors";
import { BotResponse } from "./lib/botresponse";
import { ChildPipe } from "./lib/processes";
import { Reader, readAll } from "./lib/streams";

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
  const timeout = new Promise((_, reject) => setTimeout(() => reject(TIMEOUT), 2000));

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

function decorateWhileEmpty(editor: vscode.TextEditor, placeholderText: string) {
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
      color: 'rgba(180,180,220,0.5)',
      fontStyle: 'italic',
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

  const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '', 'markdown');
  cell.metadata = {
  };
  const data = new vscode.NotebookData([cell]);
  
  /* eslint-disable @typescript-eslint/naming-convention */
  // metadata copied from ipynb.newUntitledIpynb:
  // https://github.com/microsoft/vscode/blob/42ce7b7a2eeaa102ee40605a446174fce71c285a/extensions/ipynb/src/ipynbMain.ts#L76
  data.metadata = {
    custom: {
      cells: [],
      metadata: {
        orig_nbformat: 4
      },
      nbformat: 4,
      nbformat_minor: 2
    }
  };

  const doc = await vscode.workspace.openNotebookDocument('jupyter-notebook', data);
  await vscode.window.showNotebookDocument(doc);

  const ed = await editActiveCell();
  if (!ed) {
    console.log("createUntitledNotebook: couldn't edit cell");
    return false;
  }

  decorateWhileEmpty(ed, 'Type your question here and press Control+Alt Enter to get a response.');
  return true;
}

const systemPrompt =
`You are a helpful AI assistant that's participating in a conversation in a Jupyter notebook.
You can reply with a mixture of Markdown and Python, but instead of using triple quotes
for a Python code block, use the following format:

%python
print("hello!")
%markdown

To display an image in the notebook, write a Python expression that evaluates to the image object.
`;

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
      if (!await new BotResponse(input).copy(writer)) {
        console.log("bot response cancelled");
        return;
      }
      await writer.close();
    };
  
    const stdin = new ChildPipe(llmPath, ["--system", systemPrompt], copyResponse);
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
