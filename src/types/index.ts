/** Application configuration loaded from environment variables. */
export interface AppConfig {
  org: string;
  orgUrl: string;
  project: string;
  pat: string;
  repoIds: string[];
  pollIntervalMinutes: number;
  claudeModel: string;
  promptPath: string;
  stateDir: string;
  dryRun: boolean;
}

/** Shape returned by the Azure DevOps Pull Request API. */
export interface AzureDevOpsPullRequest {
  pullRequestId: number;
  title: string;
  description: string;
  status: string;
  creationDate: string;
  closedDate: string;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit: { commitId: string };
  lastMergeTargetCommit: { commitId: string };
  repository: { id: string; name: string };
}

/** Reference to a work item linked to a pull request. */
export interface PRWorkItemRef {
  id: string;
  url: string;
}

/** Response shape when fetching a single work item. */
export interface WorkItemResponse {
  id: number;
  fields: Record<string, unknown>;
  rev: number;
  url: string;
}

/** A single change entry inside a diff response. */
export interface DiffChange {
  item: { path: string };
  changeType: string;
}

/** Response shape for a commit diff query. */
export interface DiffResponse {
  changes: DiffChange[];
}

/** Persisted state tracking which PRs have already been processed. */
export interface ProcessedState {
  processedPRIds: number[];
  lastRunAt: string;
}

/** Result summary after processing a single pull request. */
export interface PRProcessResult {
  prId: number;
  processed: number;
  skipped: number;
  errors: number;
}
