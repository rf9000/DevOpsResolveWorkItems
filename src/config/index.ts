import { z } from "zod";
import type { AppConfig } from "../types/index.ts";

const envSchema = z.object({
  AZURE_DEVOPS_PAT: z.string().min(1, "AZURE_DEVOPS_PAT is required"),
  AZURE_DEVOPS_ORG: z.string().min(1, "AZURE_DEVOPS_ORG is required"),
  AZURE_DEVOPS_PROJECT: z.string().min(1, "AZURE_DEVOPS_PROJECT is required"),
  AZURE_DEVOPS_REPO_IDS: z.string().min(1, "AZURE_DEVOPS_REPO_IDS is required"),
  POLL_INTERVAL_MINUTES: z.coerce.number().default(15),
  RESOLVED_STATE: z.string().default("Resolved"),
  ALLOWED_WORK_ITEM_TYPES: z.string().default("Bug,User Story,Task"),
  STATE_DIR: z.string().default(".state"),
});

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${messages}`);
  }

  const parsed = result.data;

  const repoIds = parsed.AZURE_DEVOPS_REPO_IDS
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const allowedWorkItemTypes = parsed.ALLOWED_WORK_ITEM_TYPES
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return {
    org: parsed.AZURE_DEVOPS_ORG,
    orgUrl: `https://dev.azure.com/${parsed.AZURE_DEVOPS_ORG}`,
    project: parsed.AZURE_DEVOPS_PROJECT,
    pat: parsed.AZURE_DEVOPS_PAT,
    repoIds,
    pollIntervalMinutes: parsed.POLL_INTERVAL_MINUTES,
    resolvedState: parsed.RESOLVED_STATE,
    allowedWorkItemTypes,
    stateDir: parsed.STATE_DIR,
    dryRun: false,
  };
}
