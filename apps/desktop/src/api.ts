import { invoke } from "@tauri-apps/api/core";
import type {
  CleanupResult,
  Collection,
  Environment,
  RetentionPolicy,
  Run,
} from "./types";

const inTauri = () => "__TAURI_INTERNALS__" in window;

export async function listCollections(): Promise<Collection[]> {
  if (!inTauri()) return [];
  return invoke("list_collections");
}

export async function importCollection(source: string): Promise<Collection> {
  if (!inTauri()) throw new Error("Import is available in the desktop app");
  return invoke("import_collection", { source });
}

export async function saveCollection(collection: Collection): Promise<void> {
  return invoke("save_collection", { collection });
}

export async function runCollection(
  collectionId: string,
  baselineRunId?: string,
  environmentId?: string,
): Promise<Run> {
  return invoke("run_collection", {
    collectionId,
    baselineRunId,
    environmentId,
  });
}

export async function runRequest(
  collectionId: string,
  requestId: string,
  baselineRunId?: string,
  environmentId?: string,
): Promise<Run> {
  return invoke("run_request", {
    collectionId,
    requestId,
    baselineRunId,
    environmentId,
  });
}

export async function listRuns(collectionId?: string): Promise<Run[]> {
  if (!inTauri()) return [];
  return invoke("list_runs", { collectionId });
}

export async function listEnvironments(): Promise<Environment[]> {
  if (!inTauri()) return [];
  return invoke("list_environments");
}

export async function importEnvironment(source: string): Promise<Environment> {
  if (!inTauri())
    throw new Error("Environment import is available in the desktop app");
  return invoke("import_environment", { source });
}

export async function saveEnvironment(environment: Environment): Promise<void> {
  return invoke("save_environment", { environment });
}

export async function setRunPinned(id: string, pinned: boolean): Promise<void> {
  return invoke("set_run_pinned", { id, pinned });
}

export async function retentionPolicy(): Promise<RetentionPolicy> {
  return invoke("retention_policy");
}

export async function saveRetentionPolicy(
  policy: RetentionPolicy,
): Promise<void> {
  return invoke("save_retention_policy", { policy });
}

export async function cleanupHistory(): Promise<CleanupResult> {
  return invoke("cleanup_history");
}

export async function exportWorkspace(): Promise<string> {
  return invoke("export_workspace_bundle");
}

export async function exportWorkspaceFile(): Promise<string> {
  return invoke("export_workspace_file");
}

export async function importWorkspace(source: string): Promise<Collection[]> {
  return invoke("import_workspace_bundle", { source });
}
