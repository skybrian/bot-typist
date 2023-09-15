import * as vscode from "vscode";
import * as llm from "./llm";

export const getConfig = (): llm.Config => {
  const conf = vscode.workspace.getConfiguration("bot-typist");

  const path = conf.get<string>("llm.path")?.trim() ?? "llm";
  const systemPrompt = conf.get<string>("llm.systemPrompt")?.trim() ?? "";
  const model = conf.get<string>("llm.model")?.trim() ?? "";
  const extraArgs = conf.get<string[]>("llm.extraArguments") ?? [];

  return { path, model, systemPrompt, extraArgs };
};

export function extraArgsChangedFromDefault(): boolean {
  return JSON.stringify(getConfig().extraArgs) !== JSON.stringify([]);
}
