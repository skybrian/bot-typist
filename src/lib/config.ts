import * as vscode from "vscode";
import * as llm from "./llm";

export interface Config extends llm.Config {
  cue: string;
}

export const getConfig = (languageId: string): Config => {
  const scope = languageId ? { "languageId": languageId } : undefined;
  const conf = vscode.workspace.getConfiguration("bot-typist", scope);

  const path = conf.get<string>("llm.path")?.trim() ?? "llm";
  const systemPrompt = conf.get<string>("llm.systemPrompt")?.trim() ?? "";
  const model = conf.get<string>("llm.model")?.trim() ?? "";
  const stop = conf.get<string>("llm.stop") ?? "";
  const extraArgs = conf.get<string[]>("llm.extraArguments") ?? [];

  const cue = conf.get<string>("cue")?.trim() ?? "🤖";

  return { path, model, systemPrompt, stop, extraArgs, cue };
};

export function extraArgsChangedFromDefault(languageId: string): boolean {
  return JSON.stringify(getConfig(languageId).extraArgs) !== JSON.stringify([]);
}
