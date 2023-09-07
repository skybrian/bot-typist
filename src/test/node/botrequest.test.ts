import expect from "expect";
import * as fc from "fast-check";

import { chooseBotPrompt } from "../../lib/botrequest";

describe("chooseBotPrompt", () => {
  const checkEmptyPrompt = ([languageId, text]: [string, string]) => {
    const cells = [{ languageId: languageId, text }];
    const cellAt = (idx: number) => cells[idx];
    const prompt = chooseBotPrompt(cellAt, 0);
    expect(prompt).toEqual("");
  };

  it("returns an empty string when given an empty cell", () => {
    checkEmptyPrompt(["markdown", ""]);
    checkEmptyPrompt(["python", ""]);
  });

  it("returns an empty string for a blank cell", () => {
    const blank = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), {
      minLength: 1,
    });
    const args = fc.tuple(fc.constantFrom("markdown", "python"), blank);
    fc.assert(fc.property(args, checkEmptyPrompt));
  });

  const nonEmptyText = fc.unicodeString({ minLength: 1 }).filter((s) =>
    s.trim() !== ""
  );

  it("returns the text of a non-empty cell", () => {
    fc.assert(fc.property(nonEmptyText, (text) => {
      const cells = [{ languageId: "markdown", text }];
      const cellAt = (idx: number) => cells[idx];
      const prompt = chooseBotPrompt(cellAt, 0);
      expect(prompt).toEqual(`%markdown\n${text}\n`);
    }));
  });

  it("doesn't include text after the active cell index", () => {
    const cells = [
      { languageId: "markdown", text: "first" },
      { languageId: "markdown", text: "second" },
    ];
    const cellAt = (idx: number) => cells[idx];
    const prompt = chooseBotPrompt(cellAt, 0);
    expect(prompt).toEqual(`%markdown\nfirst\n`);
  });

  const anyCue = fc.constantFrom("bot: ", "q: ", "1: ", "gpt4: ");

  const anyCueCell = fc.tuple(anyCue, fc.unicodeString({}))
    .map(([cue, text]) => ({ languageId: "markdown", text: cue + text }));

  const anyPythonCell = fc.unicodeString({ minLength: 1 })
    .filter((s) => s.trim() !== "").map((text) => ({
      languageId: "python",
      text,
    }));

  it("returns the text of a conversation", () => {
    const args = fc.array(fc.oneof(anyCueCell, anyPythonCell), {
      minLength: 1,
    });

    fc.assert(fc.property(args, (cells) => {
      const cellAt = (idx: number) => cells[idx];
      const prompt = chooseBotPrompt(cellAt, cells.length - 1);
      const expected = cells
        .map((cell) => `%${cell.languageId}\n${cell.text}\n`)
        .join("");
      expect(prompt).toEqual(expected);
    }));
  });

  const anyHorizontalRule = fc.stringOf(fc.constantFrom("-", "*", "_"), {
    minLength: 3,
    maxLength: 10,
  });

  it("doesn't include text before a horizontal rule", () => {
    const textBefore = fc.unicodeString({ minLength: 1 }).map((text) =>
      text + "\n\n"
    );

    const textAfter = fc.unicodeString({ minLength: 1 }).map((text) =>
      "\n" + text
    );

    const args = fc.tuple(textBefore, anyHorizontalRule, textAfter).map((
      [before, hr, after],
    ) => ({
      input: { languageId: "markdown", text: before + hr + "\n" + after },
      expected: after.trim() === "" ? "" : "%markdown\n" + after + "\n",
    }));

    fc.assert(fc.property(args, ({ input, expected }) => {
      const cells = [input];
      const cellAt = (idx: number) => cells[idx];
      const prompt = chooseBotPrompt(cellAt, 0);
      expect(prompt).toEqual(expected);
    }));
  });

  const hrCell = anyHorizontalRule.map((hr) => ({
    languageId: "markdown",
    text: hr,
  }));

  it("returns an empty string if there's nothing after a horizontal rule", () => {
    fc.assert(fc.property(hrCell.map((c) => [c]), (cells) => {
      const cellAt = (idx: number) => cells[idx];
      const prompt = chooseBotPrompt(cellAt, cells.length - 1);
      expect(prompt).toEqual("");
    }));
  });

  it("returns text from cells after a horizontal rule", () => {
    const args = fc.tuple(
      fc.oneof(anyCueCell, anyPythonCell),
      hrCell,
      fc.oneof(anyCueCell, anyPythonCell),
    );

    fc.assert(fc.property(args, (cells) => {
      const cellAt = (idx: number) => cells[idx];
      const prompt = chooseBotPrompt(cellAt, cells.length - 1);
      const after = cells[2];
      expect(prompt).toEqual(`%${after.languageId}\n${after.text}\n`);
    }));
  });
});
