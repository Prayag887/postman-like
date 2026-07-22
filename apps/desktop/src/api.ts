import { invoke } from "@tauri-apps/api/core";
import type { Collection, Run } from "./types";

const inTauri = () => "__TAURI_INTERNALS__" in window;

export async function listCollections(): Promise<Collection[]> {
  if (!inTauri()) return [];
  return invoke("list_collections");
}

export async function importCollection(source: string): Promise<Collection> {
  if (!inTauri()) throw new Error("Import is available in the desktop app");
  return invoke("import_collection", { source });
}

export async function runCollection(collectionId: string, baselineRunId?: string): Promise<Run> {
  return invoke("run_collection", { collectionId, baselineRunId });
}

export async function listRuns(collectionId?: string): Promise<Run[]> {
  if (!inTauri()) return [];
  return invoke("list_runs", { collectionId });
}
