import * as vscode from "vscode";

export const getConfig = () => {
  const conf = vscode.workspace.getConfiguration("bot-typist");

  const path = conf.get<string>("llm.path") ?? "llm";

  const systemPrompt = conf.get<string>("llm.systemPrompt") ??
    `You are a helpful AI assistant that's participating in a conversation in a Jupyter notebook.

You can see any Markdown and Python cells from the conversation so far, indicated by #markdown and #python.
If the user executed a Python cell, each cell output will follow it, indicated by #output.

You can reply using Markdown. Python code blocks should contain real Python code that will run without errors.
They will be converted into Python cells and executed when the user chooses.

To display an image, write Python code that evaluates to an image object. The image will appear as a cell output.

Here is the current date and time: ${new Date()}.
`;

  const extraArgs = conf.get<string[]>("llm.extraArguments") ?? [];

  return { path, systemPrompt, extraArgs };
};

export function extraArgsChangedFromDefault(): boolean {
  return JSON.stringify(getConfig().extraArgs) !== JSON.stringify([]);
}
