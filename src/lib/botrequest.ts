export interface Cell {
  languageId: string;
  text: string;
  outputs?: CellOutput[];
}

export type CellOutput =
  | ["text", string]
  | ["error", CellError];

export type CellError = { name: string; message: string; stack: string };

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

export const chooseSystemPrompt = () =>
  `You are a helpful AI assistant that's participating in a conversation in a Jupyter notebook.

You can see any Markdown and Python cells from the conversation so far, indicated by #markdown and #python.
If the user executed a Python cell, each cell output will follow it, indicated by #output.

You can reply using Markdown. Python code blocks should contain real Python code that will run without errors.
They will be converted into Python cells and executed when the user chooses.

To display an image, write Python code that evaluates to an image object. The image will appear as a cell output.

Here is the current date and time: ${new Date()}.
`;

/**
 * Determines the prompt to use, given the current cell.
 */
export function chooseBotPrompt(
  cellAt: (idx: number) => Cell,
  cellIndex: number,
): string {
  let prompt = "";

  const pushCell = (cell: Cell, text: string) => {
    const outputs = cell.outputs || [];
    const outputText = outputs.map((output) => `%output\n${output}\n`).join("");
    prompt += `%${cell.languageId}\n${text}\n`;
    for (const output of outputs) {
      switch (output[0]) {
        case "text":
          prompt += `%output\n${output[1]}\n`;
          break;
        case "error":
          const error = output[1];
          // The stack includes the error name and message.
          // Not sure what the format is, but the bot can likely figure it out.
          prompt += `%output\n${error.stack}\n`;
          break;
      }
    }
  };

  for (let i = 0; i <= cellIndex; i++) {
    const cell = cellAt(i);
    if (cell.text.trim() === "") {
      continue;
    } else if (cell.languageId !== "markdown") {
      pushCell(cell, cell.text);
      continue;
    }

    const parsed = parse(cellAt(i).text);
    if (parsed[0] === "start") {
      prompt = "";
    }
    if (parsed[1].trim() !== "") {
      pushCell(cell, parsed[1]);
    }
  }

  return prompt;
}
