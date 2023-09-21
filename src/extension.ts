import * as vscode from "vscode";

import {
  choosePrompt,
  editCell,
  getActiveCell,
  getNotebookLanguage,
  NotebookWriter,
} from "./lib/notebooks";

import { BotResponse, CANCELLED, checkCueLabel } from "./lib/botresponse";
import { Reader } from "./lib/streams";
import { decorateWhileEmpty } from "./lib/editors";
import * as llm from "./lib/llm";
import { ChildExitError } from "./lib/processes";
import { extraArgsChangedFromDefault, getConfig } from "./lib/config";

export function activate(context: vscode.ExtensionContext) {
  const push = context.subscriptions.push.bind(context.subscriptions);

  let output: vscode.OutputChannel | undefined;
  const getOutput = () => {
    if (!output) {
      output = vscode.window.createOutputChannel("Bot Typist");
    }
    return output;
  };

  const services = new Map<string, llm.Service>();
  const getService = (languageId: string) => {
    let service = services.get(languageId);
    if (service) {
      return service;
    }

    const config = getConfig(languageId);
    service = new llm.Service(config, getOutput);
    services.set(languageId, service);
    return service;
  };

  push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("bot-typist.llm")) {
      services.clear();
    }
  }));

  push(vscode.commands.registerCommand(
    "bot-typist.create-jupyter-notebook",
    createJupyterNotebookForChat,
  ));

  push(vscode.commands.registerCommand(
    "bot-typist.insert-reply",
    () => insertBotReply(getService),
  ));
  push(vscode.commands.registerCommand(
    "bot-typist.show-prompt",
    showBotPrompt,
  ));
}

export function deactivate() {}

const instructions = "# AI Chat Dialog\n" +
  "\n" +
  "Type your question in the next cell and then type **Control-Alt Enter** to get a response. (Command-enter on a Mac.)\n" +
  "\n" +
  "A horizonal rule in a Markdown cell indicates the start of a chat. Anything above it won't be seen by the bot.\n" +
  "\n" +
  "---";

async function createJupyterNotebookForChat(): Promise<boolean> {
  const cells = [instructions, ""].map((text) =>
    new vscode.NotebookCellData(
      vscode.NotebookCellKind.Markup,
      text,
      "markdown",
    )
  );
  // cells.forEach((cell) => cell.metadata = {});
  const data = new vscode.NotebookData(cells);

  /* eslint-disable @typescript-eslint/naming-convention */
  // some metadata copied from ipynb.newUntitledIpynb:
  // https://github.com/microsoft/vscode/blob/42ce7b7a2eeaa102ee40605a446174fce71c285a/extensions/ipynb/src/ipynbMain.ts#L76
  data.metadata = {
    custom: {
      cells: [],
      metadata: {
        orig_nbformat: 4,
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
    console.log("createJupyterNotebookForChat: couldn't edit cell");
    return false;
  }

  decorateWhileEmpty(ed, "Type your question here.");
  return true;
}

/** If in a notebook cell, inserts cells below with the bot's reply. */
async function insertBotReply(
  getService: (languageId: string) => llm.Service,
): Promise<boolean> {
  const cell = getActiveCell();
  if (!cell) {
    vscode.window.showInformationMessage(
      "Please select a notebook cell.",
    );
    return false;
  }

  const prompt = choosePrompt(cell);
  if (!prompt) {
    vscode.window.showInformationMessage(
      "Please type a question or choose a non-empty cell.",
    );
    return false;
  }

  const languageId = getNotebookLanguage(cell);
  const service = getService(languageId);
  const llmPath = await service.checkCommandPath();
  if (!llmPath) {
    const msg =
      "Can't run the llm command. Please check that its path is set correctly in settings.";
    showSettingsError(msg, "bot-typist.llm");
    return false;
  }

  const cue = getConfig(languageId).cue;
  if (!await checkCueLabel(cue)) {
    showSettingsError(
      "Sorry, the cue you chose isn't supported yet.",
      "bot-typist.cue",
    );
    return false;
  }

  const handleBotReply = async (input: Reader) => {
    const writer = new NotebookWriter(cell);

    try {
      await new BotResponse(input, cue).copy(writer);
    } finally {
      if (!await writer.close()) {
        throw CANCELLED;
      }
    }
  };

  try {
    await service.run(prompt, handleBotReply);
    return true;
  } catch (e) {
    if (e === CANCELLED) {
      vscode.window.showInformationMessage("Insert bot reply: cancelled");
    } else if (e instanceof ChildExitError) {
      if (
        e.stderr.includes("Usage: llm") &&
        extraArgsChangedFromDefault(languageId)
      ) {
        const msg =
          "The llm command exited with a usage error. (See output.) Perhaps it's the extra arguments setting?";
        showSettingsError(msg, "bot-typist.llm");
      } else {
        const msg =
          `The llm command stopped with exit code ${e.exitCode}. Check output for details.`;
        showSettingsError(msg, "bot-typist.llm");
      }
    } else {
      console.error(e);
      vscode.window.showInformationMessage(
        `Unexpected error while running llm command: ${e}`,
      );
    }
    return false;
  }
}

function showSettingsError(msg: string, settingsSearch: string) {
  vscode.window.showErrorMessage(msg, "Open Settings").then((choice) => {
    if (choice === "Open Settings") {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        settingsSearch,
      );
    }
  });
}

/** Open a new editor tab with the prompt used for the current position. */
async function showBotPrompt(): Promise<boolean> {
  let cell = getActiveCell();
  if (!cell) {
    vscode.window.showInformationMessage(
      "Can't generate prompt for bot. Please select a notebook cell.",
    );
    return false;
  }

  const prompt = choosePrompt(cell);
  if (!prompt) {
    vscode.window.showInformationMessage(
      "Can't generate prompt for bot. Please type a question.",
    );
    return false;
  }

  const languageId = getNotebookLanguage(cell);
  const system = getConfig(languageId).systemPrompt;
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
