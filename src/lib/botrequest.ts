import { text } from "stream/consumers";

interface Cell {
  languageId: string;
  text: string;
}

const isHorizontalRule = (line: string): boolean => {
  return /^[-*_]{3,}$/.test(line.trim());
};

type CellParse = ["start", string] | ["text", string];

const parse = (text: string): CellParse => {
  let foundStart = false;
  let result = "";

  let firstLine = true;
  for (const line of text.split("\n")) {
    if (!firstLine) {
      result += "\n";
    }

    if (isHorizontalRule(line)) {
      foundStart = true;
      result = "";
      firstLine = true;
      continue;
    }

    result += line;
    firstLine = false;
  }
  const tag = foundStart ? "start" : "text";
  return [tag, result];
};

/**
 * Determines the prompt to use, given the current cell.
 */
export function chooseBotPrompt(
  cellAt: (idx: number) => Cell,
  cellIndex: number,
): string {
  let prompt = "";

  const pushCell = (languageId: string, text: string) => {
    prompt += `%${languageId}\n${text}\n`;
  };

  for (let i = 0; i <= cellIndex; i++) {
    const cell = cellAt(i);
    if (cell.text.trim() === "") {
      continue;
    } else if (cell.languageId !== "markdown") {
      pushCell(cell.languageId, cell.text);
      continue;
    }

    const parsed = parse(cellAt(i).text);
    if (parsed[0] === "start") {
      prompt = "";
    }
    if (parsed[1].trim() !== "") {
      pushCell(cell.languageId, parsed[1]);
    }
  }

  return prompt;
}
