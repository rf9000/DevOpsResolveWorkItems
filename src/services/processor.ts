import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRProcessResult,
  PRWorkItemRef,
  WorkItemResponse,
} from '../types/index.ts';
import type { GeneratorContext } from './ai-generator.ts';

import * as sdk from '../sdk/azure-devops-client.ts';
import * as gen from './ai-generator.ts';

export interface ProcessorDeps {
  getPRWorkItems: (
    config: AppConfig,
    repoId: string,
    prId: number,
  ) => Promise<PRWorkItemRef[]>;

  getWorkItem: (
    config: AppConfig,
    workItemId: number,
  ) => Promise<WorkItemResponse>;

  getPRChangedFiles: (
    config: AppConfig,
    repoId: string,
    baseCommit: string,
    targetCommit: string,
  ) => Promise<string[]>;

  updateWorkItemField: (
    config: AppConfig,
    workItemId: number,
    fieldName: string,
    value: string,
  ) => Promise<WorkItemResponse>;

  generateWithAI: (
    config: AppConfig,
    context: GeneratorContext,
  ) => Promise<string>;
}

const defaultDeps: ProcessorDeps = {
  getPRWorkItems: sdk.getPRWorkItems,
  getWorkItem: sdk.getWorkItem,
  getPRChangedFiles: sdk.getPRChangedFiles,
  updateWorkItemField: sdk.updateWorkItemField,
  generateWithAI: gen.generateWithAI,
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

// TODO: Replace this stub with your project-specific processing logic.
// This example processes work items linked to completed PRs and generates
// AI-powered summaries. Adapt the field checks, generation context, and
// update logic to match your use case.

export async function processPR(
  config: AppConfig,
  pr: AzureDevOpsPullRequest,
  deps: ProcessorDeps = defaultDeps,
): Promise<PRProcessResult> {
  const result: PRProcessResult = {
    prId: pr.pullRequestId,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  log(`Processing PR #${pr.pullRequestId}: ${pr.title}`);

  const workItemRefs = await deps.getPRWorkItems(
    config,
    pr.repository.id,
    pr.pullRequestId,
  );

  if (workItemRefs.length === 0) {
    log(`  PR #${pr.pullRequestId}: No linked work items, skipping`);
    return result;
  }

  let changedFiles: string[] = [];
  try {
    changedFiles = await deps.getPRChangedFiles(
      config,
      pr.repository.id,
      pr.lastMergeTargetCommit.commitId,
      pr.lastMergeSourceCommit.commitId,
    );
  } catch (err) {
    log(
      `  PR #${pr.pullRequestId}: Warning — could not fetch changed files: ${err}`,
    );
  }

  for (const ref of workItemRefs) {
    const workItemId = Number(ref.id);
    try {
      const workItem = await deps.getWorkItem(config, workItemId);

      const workItemTitle = String(workItem.fields['System.Title'] ?? '');
      const workItemType = String(
        workItem.fields['System.WorkItemType'] ?? '',
      );

      const context: GeneratorContext = {
        prTitle: pr.title,
        prDescription: pr.description ?? '',
        changedFiles,
        workItemTitle,
        workItemType,
      };

      log(`  WI #${workItemId}: Generating AI output...`);
      const output = await deps.generateWithAI(config, context);

      if (config.dryRun) {
        log(`  WI #${workItemId}: [DRY RUN] Generated:\n    "${output}"`);
        result.processed++;
        continue;
      }

      // TODO: Replace 'System.Description' with the field you want to update
      await deps.updateWorkItemField(
        config,
        workItemId,
        'System.Description',
        output,
      );
      log(`  WI #${workItemId}: Output written`);
      result.processed++;
    } catch (err) {
      log(`  WI #${workItemId}: Error — ${err}`);
      result.errors++;
    }
  }

  return result;
}
