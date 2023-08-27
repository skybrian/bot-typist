import * as vscode from "vscode";
import * as child_process from "child_process";
import * as util from "util";

import { getActiveCell, writerForNotebook } from "./lib/editors";
import { splitCells } from "./lib/parsers";
import { ParserWriter, Writer, writeStdout } from "./lib/streams";

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
  if (editor.document.getText() !== '') {
    return;
  }

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
  
  const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
  );
  editor.setDecorations(placeholder, [fullRange]);      

  disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === editor.document && e.document.getText() !== '') {
      editor.setDecorations(placeholder, []);
      cleanup();
    }
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
  
  await vscode.commands.executeCommand("notebook.cell.edit");
  
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    console.log("createUntitledNotebook: no text editor");
    return false;
  }
  decorateWhileEmpty(ed, 'Type your question here and press Control+Alt Enter to get a response.');
  
  return true;
}

/** If in a notebook cell, inserts a new markdown cell with the bot's reply. */
async function insertReply(): Promise<boolean> {
  const cellWriter = writerForNotebook();
  if (!cellWriter) {
    return false;
  }

  const cellSplitter = new ParserWriter(splitCells(cellWriter));

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
  
  try {
    await writeStdout(
      cellSplitter,
      llmPath,
      ["--system", systemPrompt],
      {
        stdin: prompt,
      },
    );
    console.log("command done");
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
