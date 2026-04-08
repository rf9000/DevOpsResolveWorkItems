import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRProcessResult,
  PRWorkItemRef,
  WorkItemResponse,
} from '../types/index.ts';

import * as sdk from '../sdk/azure-devops-client.ts';

/** Terminal states that should not be transitioned. */
const TERMINAL_STATES = ['Resolved', 'Closed'];

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

  updateWorkItemFields: (
    config: AppConfig,
    workItemId: number,
    fields: Array<{ field: string; value: unknown }>,
  ) => Promise<WorkItemResponse>;
}

const defaultDeps: ProcessorDeps = {
  getPRWorkItems: sdk.getPRWorkItems,
  getWorkItem: sdk.getWorkItem,
  updateWorkItemFields: sdk.updateWorkItemFields,
};

function log(message: string): void {
  const ts = new Date().toLocaleString('sv-SE', { hour12: false }).replace('T', ' ');
  console.log(`[${ts}] ${message}`);
}

export async function processPR(
  config: AppConfig,
  pr: AzureDevOpsPullRequest,
  deps: ProcessorDeps = defaultDeps,
): Promise<PRProcessResult> {
  const result: PRProcessResult = {
    prId: pr.pullRequestId,
    resolved: 0,
    skipped: 0,
    errors: 0,
  };

  log(`Processing PR #${pr.pullRequestId}: ${pr.title} (status: ${pr.status})`);

  if (pr.status !== 'completed') {
    log(`  PR #${pr.pullRequestId}: Status is "${pr.status}", only completed PRs are processed`);
    return result;
  }

  const workItemRefs = await deps.getPRWorkItems(
    config,
    pr.repository.id,
    pr.pullRequestId,
  );

  if (workItemRefs.length === 0) {
    log(`  PR #${pr.pullRequestId}: No linked work items, skipping`);
    return result;
  }

  for (const ref of workItemRefs) {
    const workItemId = Number(ref.id);
    try {
      const workItem = await deps.getWorkItem(config, workItemId);

      const workItemType = String(workItem.fields['System.WorkItemType'] ?? '');
      const currentState = String(workItem.fields['System.State'] ?? '');

      if (!config.allowedWorkItemTypes.includes(workItemType)) {
        log(`  WI #${workItemId}: Type "${workItemType}" not in allowed list, skipping`);
        result.skipped++;
        continue;
      }

      if (TERMINAL_STATES.includes(currentState)) {
        log(`  WI #${workItemId}: Already "${currentState}", skipping`);
        result.skipped++;
        continue;
      }

      const tags = String(workItem.fields['System.Tags'] ?? '')
        .split(';')
        .map(t => t.trim());
      const matchedTag = config.skipTags.find(st => tags.includes(st));
      if (matchedTag) {
        log(`  WI #${workItemId}: Has "${matchedTag}" tag, skipping`);
        result.skipped++;
        continue;
      }

      if (config.dryRun) {
        log(`  WI #${workItemId}: [DRY RUN] Would resolve: ${currentState} → ${config.resolvedState}`);
        result.resolved++;
        continue;
      }

      const assignedTo = workItem.fields['System.AssignedTo'] ?? '';

      await deps.updateWorkItemFields(config, workItemId, [
        { field: 'System.State', value: config.resolvedState },
        { field: 'System.AssignedTo', value: assignedTo },
      ]);
      log(`  WI #${workItemId}: ${currentState} → ${config.resolvedState}`);
      result.resolved++;
    } catch (err) {
      log(`  WI #${workItemId}: Error — ${err}`);
      result.errors++;
    }
  }

  return result;
}
