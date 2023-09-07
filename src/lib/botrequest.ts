interface Cell {
  languageId: string;
  text: string;
}

/**
 * Determines the prompt to use, given the current cell.
 */
export function chooseBotPrompt(
  cellAt: (idx: number) => Cell,
  cellIndex: number,
): string {
  let prompt = "";
  for (let i = 0; i <= cellIndex; i++) {
    const cell = cellAt(i);
    if (cell.text.trim() !== "") {
      prompt += `%${cell.languageId}\n${cell.text}\n`;
    }
  }

  return prompt;
}
