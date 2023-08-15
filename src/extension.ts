import * as vscode from "vscode";
import * as child_process from "child_process";
import * as util from "util";

const selector: vscode.DocumentSelector = [
  'plaintext', 'markdown'
];

const decorationType = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: "...",
    color: "gray",
  },
});

function getCommandPath() {
  return vscode.workspace.getConfiguration("bot-typist").get<string>(
    "llm.path",
  );
}

enum ConfigState {
  unconfigured,
  commandNotFound,
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
      timeout: 1000,
    });

    if (stderr) {
      console.log(`llm error: '${stdout}'`);
      return ConfigState.commandDidntRun;
    }

    console.log(`llm output: '${stdout}'`);
    return ConfigState.ok;
  } catch (e) {
    console.log(`llm error: ${e}`);
    return ConfigState.commandNotFound;
  }
}

/**
 * Types some text into the current document at the cursor.
 * Returns true if the text was typed successfully.
 */
async function typeText(newText: string): Promise<boolean> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    return false;
  }

  if (ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeText: selection not empty");
    return false;
  }

  const here = ed.selection.active;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(ed.document.uri, here, newText);

  if (!await vscode.workspace.applyEdit(edit)) {
    console.log(`typeText: applyEdit failed for: '${newText}'. Retrying.`);
    if (!await vscode.workspace.applyEdit(edit)) {
      console.log(`typeText: applyEdit failed again. Giving up.`);
      return false;
    }
    console.log(`typeText: applyEdit succeeded on second try.`);
  }

  if (ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeText: selection not empty after edit");
    return false;
  }

  const lines = newText.split("\n");
  const lineDelta = lines.length - 1;
  const charDelta = lines[lineDelta].length;
  const newPosition = here.translate(lineDelta, charDelta);

  ed.selection = new vscode.Selection(newPosition, newPosition);
  return true;
}

/**
 * Runs a command and types stdout into the editor.
 * Returns true if the command finished without being interrupted.
 */
function typeOutputToEditor(command: string, args: string[], stdin: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      resolve(false);
      return;
    }

    const child = child_process.spawn(command, args);
    child.stdin.write(stdin, (err) => {
      if (err) {
        console.error(`error writing to stdin of llm: ${err}`);
        child.kill();
        resolve(false);  
      }
    });
    child.stdin.end();

    let shuttingDown = false;
    let insertingOutput = false;

    // Handle stdout
    child.stdout.on("data", async (data) => {
      if (shuttingDown) {
        return;
      }

      child.stdout.pause();

      insertingOutput = true;
      if (!await typeText(data.toString())) {
        console.error("typeOutputToEditor: typeText failed, stopping");
        child.kill();
        resolve(false);
      }   
      insertingOutput = false;

      child.stdout.resume();
    });

    // Handle errors
    child.stderr.on("data", (data) => {
      console.error(`stderr: ${data}`);
      reject(new Error("External command printed an error while typing"));
      child.kill();
    });

    // Attach listeners to detect cursor movement or text change
    const disposables: vscode.Disposable[] = [];

    disposables.push(vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === editor && !insertingOutput) {
        child.kill();
        shuttingDown = true;
      }
    }));

    disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === editor.document && !insertingOutput) {
        child.kill();
        shuttingDown = true;
      }
    }));

    // Cleanup the listeners once the command completes
    child.on("close", (code, signal) => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      if (signal) {
        console.error(`llm was killed by signal ${signal}`);
        resolve(false);
      } else if (code !== 0) {
        reject(
          new Error(`External command exited with code ${code} while typing`),
        );
      } else {
        console.log("llm exited normally");
        resolve(true);
      }
    });
  });
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

async function typeAsBot() {
  console.log("typeAsBot called");

  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeAsBot: selection not empty");
    return false;
  }

  const path = getCommandPath();
  if (!path || await checkCommandPath(path) !== ConfigState.ok) {
    showConfigError(
      `Can't run llm command. Check that bot-typist.llm.path is set correctly in settings.`,
    );
    return false;
  }

  // Move cursor to end of line
  const line = ed.document.lineAt(ed.selection.active);
  const lineEnd = line.range.end;
  ed.selection = new vscode.Selection(lineEnd, lineEnd);

  // Choose prompt and prefix to type, if needed
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
  console.log(`prompt: '${prefix}'`);

  const here = ed.selection.active;
  ed.setDecorations(decorationType, [new vscode.Range(here, here)]);
  try {
    if (!await typeText(prefix)) {
      return;
    }
    const promptRange = new vscode.Range(new vscode.Position(0, 0), ed.selection.active);
    const prompt = ed.document.getText(promptRange);

    await typeOutputToEditor(path, [], prompt);
    await typeText('\n');
  } finally {
    ed.setDecorations(decorationType, []);
  }
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
  push(vscode.commands.registerCommand("bot-typist.type", typeAsBot));
  push(
    vscode.languages.registerCompletionItemProvider(selector, completion, ":"),
  );
}

export function deactivate() {}
