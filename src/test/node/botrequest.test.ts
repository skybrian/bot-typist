import expect from "expect";
import * as fc from "fast-check";

import { chooseBotPrompt } from "../../lib/botrequest";

describe("chooseBotPrompt", () => {
  const checkEmptyPrompt = (text: string) => {
    const cells = [{ languageId: "markdown", text }];
    const cellAt = (idx: number) => cells[idx];
    const prompt = chooseBotPrompt(cellAt, 0);
    expect(prompt).toEqual("");
  };

  it("returns an empty string when given an empty cell", () => {
    checkEmptyPrompt("");
  });

  it("returns an empty string for a blank cell", () => {
    const args = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), {
      minLength: 1,
    });
    fc.assert(fc.property(args, checkEmptyPrompt));
  });

  it("returns the text of a non-empty cell", () => {
    const args = fc.unicodeString({ minLength: 1 }).filter((s) =>
      s.trim() !== ""
    );

    fc.assert(fc.property(args, (text) => {
      const cells = [{ languageId: "markdown", text }];
      const cellAt = (idx: number) => cells[idx];
      const prompt = chooseBotPrompt(cellAt, 0);
      expect(prompt).toEqual(`%markdown\n${text}\n`);
    }));
  });

  const anyCue = fc.constantFrom("bot: ", "q: ", "1: ", "gpt4: ");

  const anyCueCell = fc.tuple(anyCue, fc.unicodeString({}))
    .map(([cue, text]) => ({ languageId: "markdown", text: cue + text }));

  const anyPythonCell = fc.unicodeString({ minLength: 1 }).map((text) => ({
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
});
