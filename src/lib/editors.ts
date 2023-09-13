import * as vscode from "vscode";

/**
 * Types some text into the current document at the cursor.
 * Returns true if the text was typed successfully.
 */
export async function typeText(
  ed: vscode.TextEditor,
  newText: string,
): Promise<boolean> {
  if (ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeText: selection not empty");
    return false;
  }

  // remove control characters that will mess up the cursor position
  newText = replaceControlChars(newText);

  // insert text

  let here = ed.selection.active;
  if (
    !await ed.edit((builder) => {
      builder.insert(here, newText);
    })
  ) {
    console.log(`typeText: applyEdit failed for: '${newText}'`);
    if (
      !await ed.edit((builder) => {
        builder.insert(here, newText);
      })
    ) {
      console.log(`typeText: applyEdit failed twice for: '${newText}'`);
      return false;
    }
  }

  if (ed.selections.length !== 1 || !ed.selection.isEmpty) {
    console.log("typeText: selection not empty after edit");
    return false;
  }

  // update cursor position

  const lines = newText.split("\n");
  if (lines.length === 1) {
    here = here.translate(0, newText.length);
  } else {
    here = new vscode.Position(
      here.line + lines.length - 1,
      lines[lines.length - 1].length,
    );
  }

  ed.selection = new vscode.Selection(here, here);
  return true;
}

function replaceControlChars(
  input: string,
  replacement: string = "\uFFFD",
): string {
  return input.replace(
    /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/g,
    replacement,
  );
}

export function waitForEditor(
  expectedDoc: vscode.TextDocument,
  timeout: number = 5000,
): Promise<
  vscode.TextEditor | undefined
> {
  return new Promise((resolve) => {
    const ed = vscode.window.activeTextEditor;
    if (ed?.document === expectedDoc) {
      return resolve(ed);
    }

    let resolved = false;
    const disposable = vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (!ed) {
        console.log("waitForEditor: no editor, skipping event");
        return;
      } else if (ed.document !== expectedDoc) {
        console.log("waitForEditor: wrong document, skipping event");
        return;
      }
      disposable.dispose();
      resolve(ed);
      resolved = true;
    });

    setTimeout(() => {
      if (resolved) {
        return;
      }
      console.log("waitForEditor: timeout");
      disposable.dispose();
      resolve(undefined);
    }, timeout);
  });
}

export function decorateWhileEmpty(
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
