import * as vscode from "vscode";
import { expect } from "expect";
import * as fc from "fast-check";

import { typeText } from "../../lib/editors";

const startPos = new vscode.Position(0, 0);

describe("typeText", function () {
  let ed: vscode.TextEditor;

  before(async () => {
    ed = await setupTextEditor();
  });

  it("inserts text into an empty text editor", async () => {
    await clear(ed);
    expect(await typeText(ed, "hello!")).toBeTruthy();
    expect(getTextSplit(ed)).toEqual(showPair("hello!", ""));
  });

  const controlChars = [
    charRange(0, 9),
    charRange(0xb, 0x1f),
    charRange(0x7f, 0x9f),
    [
      "\u2028", // line separator
      "\u2029", // paragraph separator
    ],
  ].flat();

  it("replaces control characters with a unicode replacement character", async () => {
    for (const char of controlChars) {
      await clear(ed);
      expect(await typeText(ed, char)).toBeTruthy();
      expect(getTextSplit(ed)).toEqual(showPair("\uFFFD", ""));
    }
  });

  const checkTypeable = async (
    [first, middle, last]: [string, string, string],
  ) => {
    await clear(ed);

    expect(await typeText(ed, first)).toBeTruthy();
    expect(getTextSplit(ed)).toBe(showPair(first, ""));
    const endOfFirst = ed.selection;

    expect(await typeText(ed, last)).toBeTruthy();
    expect(getTextSplit(ed)).toEqual(showPair(first + last, ""));

    ed.selection = endOfFirst;
    expect(getTextSplit(ed)).toEqual(showPair(first, last));

    expect(await typeText(ed, middle)).toBeTruthy();
    expect(getTextSplit(ed)).toEqual(showPair(first + middle, last));
  };

  it("can type the empty string", async () => {
    await checkTypeable(["", "", ""]);
    await checkTypeable(["", "", " "]);
  });

  it("can type the empty string or another character", async () => {
    const choice = fc.constantFrom("", "a", " ");
    const args = fc.tuple(choice, choice, choice);
    await fc.assert(fc.asyncProperty(args, checkTypeable));
  });

  it("can type any non-control ascii character", async () => {
    for (const char of charRange(0x20, 0x7e)) {
      await checkTypeable([char, char, char]);
    }
  });

  const anyTypeableChar = fc.unicode().filter((c) => !controlChars.includes(c));

  it("can type any non-control unicode character", async function () {
    this.timeout(10000);
    await fc.assert(
      fc.asyncProperty(anyTypeableChar, async (char) => {
        await clear(ed);
        expect(await typeText(ed, char)).toBeTruthy();
        expect(getTextSplit(ed)).toEqual(showPair(char, ""));
      }),
      { numRuns: 1000 },
    );
  });

  const anyTypeableText = fc.stringOf(
    fc.oneof(
      fc.constantFrom("", "\n"),
      fc.stringOf(anyTypeableChar, { maxLength: 5 }),
    ),
  );

  it("inserts text into a document out of order", async function () {
    this.timeout(10000);
    const args = fc.tuple(anyTypeableText, anyTypeableText, anyTypeableText);
    await fc.assert(fc.asyncProperty(args, checkTypeable), { numRuns: 1000 });
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});

async function setupTextEditor(): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content: "" });
  return await vscode.window.showTextDocument(doc);
}

async function clear(ed: vscode.TextEditor): Promise<void> {
  const result = await ed.edit((b) => {
    b.delete(new vscode.Range(0, 0, ed.document.lineCount, 0));
  });
  expect(result).toBeTruthy();
  expect(getTextSplit(ed)).toEqual(showPair("", ""));
}

function getTextSplit(ed: vscode.TextEditor): string {
  expect(ed.selections.length).toEqual(1);
  expect(ed.selection.end).toEqual(ed.selection.start);
  const beforeRange = new vscode.Range(startPos, ed.selection.start);
  const afterRange = new vscode.Range(ed.selection.start, endPos(ed.document));
  return showPair(
    ed.document.getText(beforeRange),
    ed.document.getText(afterRange),
  );
}

function endPos(doc: vscode.TextDocument): vscode.Position {
  return new vscode.Position(
    doc.lineCount - 1,
    doc.lineAt(doc.lineCount - 1).text.length,
  );
}

function showPair(before: string, after: string): string {
  return showString(before) + " + " + showString(after);
}

function showString(s: string): string {
  return `'${escapeNonAsciiPrintable(s)}' (${s.length})`;
}

function escapeNonAsciiPrintable(str: string): string {
  let result = "";

  for (const char of str) {
    const codePoint = str.codePointAt(0) as number;

    if (isAsciiPrintable(char)) {
      result += char;
    } else {
      const codePoint = str.codePointAt(0) as number;
      result += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    }
  }

  return result;
}

function isAsciiPrintable(char: string) {
  const codePoint = char.codePointAt(0) as number;
  return codePoint >= 0x20 && codePoint <= 0x7E;
}

function charRange(start: number, end: number): string[] {
  const result = [];
  for (let i = start; i <= end; i++) {
    result.push(String.fromCodePoint(i));
  }
  return result;
}
