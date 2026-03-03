import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRProcessResult,
} from '../types/index.ts';
import { StateStore } from '../state/state-store.ts';
import * as sdk from '../sdk/azure-devops-client.ts';
import * as proc from './processor.ts';

export interface WatcherDeps {
  listCompletedPRs: (
    config: AppConfig,
    repoId: string,
    top?: number,
  ) => Promise<AzureDevOpsPullRequest[]>;

  processPR: (
    config: AppConfig,
    pr: AzureDevOpsPullRequest,
  ) => Promise<PRProcessResult>;
}

const defaultDeps: WatcherDeps = {
  listCompletedPRs: sdk.listCompletedPRs,
  processPR: proc.processPR,
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

export async function runPollCycle(
  config: AppConfig,
  stateStore: StateStore,
  deps: WatcherDeps = defaultDeps,
): Promise<{ resolved: number; skipped: number; errors: number }> {
  let totalResolved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const repoId of config.repoIds) {
    log(`Polling repo ${repoId}...`);

    const prs = await deps.listCompletedPRs(config, repoId);
    const newPRs = prs.filter(pr =>
      !stateStore.isProcessed(pr.pullRequestId) &&
      pr.closedDate > stateStore.lastRunAt
    );

    log(`  Found ${prs.length} completed PRs, ${newPRs.length} unprocessed`);

    for (const pr of newPRs) {
      try {
        const result = await deps.processPR(config, pr);
        totalResolved += result.resolved;
        totalSkipped += result.skipped;
        totalErrors += result.errors;

        if (result.errors === 0) {
          stateStore.markProcessed(pr.pullRequestId);
        }
      } catch (err) {
        log(`  PR #${pr.pullRequestId}: Fatal error — ${err}`);
        totalErrors++;
      }
    }
  }

  stateStore.save();
  return { resolved: totalResolved, skipped: totalSkipped, errors: totalErrors };
}

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise(resolve => {
    const checkInterval = 1000;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += checkInterval;
      if (signal.aborted || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, checkInterval);
  });
}

export async function startWatcher(config: AppConfig): Promise<void> {
  const stateStore = new StateStore(config.stateDir);
  const signal = { aborted: false };

  const shutdown = () => {
    log('Shutting down...');
    signal.aborted = true;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`Starting watcher — polling every ${config.pollIntervalMinutes} minutes`);
  log(`Watching ${config.repoIds.length} repo(s)`);
  log(`Target state: ${config.resolvedState}`);
  log(`Allowed types: ${config.allowedWorkItemTypes.join(', ')}`);
  log(`${stateStore.processedCount} PRs already processed`);

  while (!signal.aborted) {
    try {
      const result = await runPollCycle(config, stateStore);
      log(`Cycle complete: ${result.resolved} resolved, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (err) {
      log(`Cycle failed: ${err}`);
    }

    if (!signal.aborted) {
      log(`Sleeping ${config.pollIntervalMinutes} minutes...`);
      await sleep(config.pollIntervalMinutes * 60 * 1000, signal);
    }
  }

  log('Watcher stopped');
}
