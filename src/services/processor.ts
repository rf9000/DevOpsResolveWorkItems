import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRProcessResult,
  PRWorkItemRef,
  WorkItemResponse,
} from '../types/index.ts';

import * as sdk from '../sdk/azure-devops-client.ts';
import { getCostLedger, type LedgerRecord } from '../state/cost-ledger.ts';

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

  /** Append one ledger line. Best-effort; must not throw into the run. */
  recordLedger: (config: AppConfig, entry: LedgerRecord) => void;
}

const defaultDeps: ProcessorDeps = {
  getPRWorkItems: sdk.getPRWorkItems,
  getWorkItem: sdk.getWorkItem,
  updateWorkItemFields: sdk.updateWorkItemFields,
  recordLedger: (config, entry) => getCostLedger(config.costLogPath).record(entry),
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
    let title: string | undefined;

    const record = (outcome: LedgerRecord['outcome'], reason?: string): void => {
      if (config.dryRun) return;
      const entry: LedgerRecord = {
        at: new Date().toISOString(),
        workItemId,
        outcome,
        costUsd: 0,
        ...(title ? { title } : {}),
        prId: pr.pullRequestId,
        ...(reason ? { reason } : {}),
      };
      try {
        deps.recordLedger(config, entry);
      } catch {
        // Bookkeeping must never affect the run.
      }
    };

    try {
      const workItem = await deps.getWorkItem(config, workItemId);
      const rawTitle = workItem.fields['System.Title'];
      if (typeof rawTitle === 'string' && rawTitle.length > 0) title = rawTitle;

      const workItemType = String(workItem.fields['System.WorkItemType'] ?? '');
      const currentState = String(workItem.fields['System.State'] ?? '');

      if (!config.allowedWorkItemTypes.includes(workItemType)) {
        log(`  WI #${workItemId}: Type "${workItemType}" not in allowed list, skipping`);
        record('skipped', 'type');
        result.skipped++;
        continue;
      }

      if (TERMINAL_STATES.includes(currentState)) {
        log(`  WI #${workItemId}: Already "${currentState}", skipping`);
        record('skipped', 'terminal');
        result.skipped++;
        continue;
      }

      const tags = String(workItem.fields['System.Tags'] ?? '')
        .split(';')
        .map(t => t.trim());
      const matchedTag = config.skipTags.find(st => tags.includes(st));
      if (matchedTag) {
        log(`  WI #${workItemId}: Has "${matchedTag}" tag, skipping`);
        record('skipped', 'tag');
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
      record('resolved');
      result.resolved++;
    } catch (err) {
      log(`  WI #${workItemId}: Error — ${err}`);
      record('failed', err instanceof Error ? err.message : String(err));
      result.errors++;
    }
  }

  return result;
}
