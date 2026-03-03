#!/usr/bin/env bun

import { loadConfig } from '../config/index.ts';
import { startWatcher, runPollCycle } from '../services/watcher.ts';
import { StateStore } from '../state/state-store.ts';
import { getPullRequest } from '../sdk/azure-devops-client.ts';
import { processPR } from '../services/processor.ts';

const HELP = `
DevOps Pull Template

Usage:
  devops-pull <command>

Commands:
  watch            Start the long-running watcher (polls every N minutes)
  run-once         Run a single poll cycle and exit
  test-pr <id>     Process a single PR (dry-run, no writes)
  reset-state      Clear the processed PR state and exit
  help             Show this help message

Options:
  --dry-run        Read-only mode: generate but skip Azure DevOps writes

Environment variables:
  AZURE_DEVOPS_PAT          Azure DevOps personal access token (required)
  AZURE_DEVOPS_ORG          Azure DevOps organization name (required)
  AZURE_DEVOPS_PROJECT      Azure DevOps project name (required)
  AZURE_DEVOPS_REPO_IDS     Comma-separated repository IDs (required)
  POLL_INTERVAL_MINUTES     Polling interval (default: 15)
  CLAUDE_MODEL              Claude model to use (default: claude-sonnet-4-6)
  PROMPT_PATH               Path to prompt file (default: .claude/commands/do-process-item.md)
  STATE_DIR                 State directory (default: .state)
`.trim();

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

switch (command) {
  case 'watch': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun) console.log('[DRY RUN] No writes will be made to Azure DevOps\n');
    await startWatcher(config);
    break;
  }

  case 'run-once': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun) console.log('[DRY RUN] No writes will be made to Azure DevOps\n');
    const stateStore = new StateStore(config.stateDir);
    const result = await runPollCycle(config, stateStore);
    console.log(`Done: ${result.processed} processed, ${result.skipped} skipped, ${result.errors} errors`);
    break;
  }

  case 'test-pr': {
    const prIdArg = process.argv[3];
    if (!prIdArg || isNaN(Number(prIdArg))) {
      console.error('Usage: devops-pull test-pr <pr-id>');
      process.exitCode = 1;
      break;
    }
    const config = loadConfig();
    config.dryRun = true;
    console.log(`[DRY RUN] Testing processing for PR #${prIdArg}\n`);
    const repoId = config.repoIds[0]!;
    const pr = await getPullRequest(config, repoId, Number(prIdArg));
    const result = await processPR(config, pr);
    console.log(`\nDone: ${result.processed} generated, ${result.skipped} skipped, ${result.errors} errors`);
    break;
  }

  case 'reset-state': {
    const config = loadConfig();
    const stateStore = new StateStore(config.stateDir);
    stateStore.reset();
    console.log('State has been reset');
    break;
  }

  case 'help':
  default:
    console.log(HELP);
    break;
}
