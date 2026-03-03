# DevOps Resolve Work Items

Automatically resolves Azure DevOps work items when their linked pull requests are completed.

## What it does

Every 15 minutes (configurable), this tool:
1. Lists completed pull requests across configured repositories
2. Finds work items linked to each PR
3. Checks the work item type (Bug, User Story, Task by default)
4. Skips items already in terminal states (Resolved, Closed)
5. Sets `System.State` to "Resolved" for eligible work items

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Set required environment variables:
   ```bash
   export AZURE_DEVOPS_PAT="your-personal-access-token"
   export AZURE_DEVOPS_ORG="your-org"
   export AZURE_DEVOPS_PROJECT="your-project"
   export AZURE_DEVOPS_REPO_IDS="repo-id-1,repo-id-2"
   ```

3. Run:
   ```bash
   bun run start
   ```

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `AZURE_DEVOPS_PAT` | Yes | — | Personal access token |
| `AZURE_DEVOPS_ORG` | Yes | — | Organization name |
| `AZURE_DEVOPS_PROJECT` | Yes | — | Project name |
| `AZURE_DEVOPS_REPO_IDS` | Yes | — | Comma-separated repository IDs |
| `POLL_INTERVAL_MINUTES` | No | 15 | Polling interval in minutes |
| `RESOLVED_STATE` | No | Resolved | Target work item state |
| `ALLOWED_WORK_ITEM_TYPES` | No | Bug,User Story,Task | Comma-separated types to resolve |
| `STATE_DIR` | No | .state | State persistence directory |

## Commands

| Command | Description |
|---------|-------------|
| `bun run start` | Start the watcher (polls every N minutes) |
| `bun run once` | Run a single poll cycle and exit |
| `bun src/cli/index.ts test-pr <id>` | Test resolution for a single PR (dry-run) |
| `bun src/cli/index.ts reset-state` | Clear processed state |
| `bun test` | Run all tests |
| `bun run typecheck` | Run TypeScript type checking |

Add `--dry-run` to any command to log what would happen without making changes.

## Project structure

```
src/
├── cli/index.ts              # CLI entry point (watch, run-once, test-pr, reset-state)
├── config/index.ts           # Zod-based environment variable validation
├── sdk/azure-devops-client.ts # Azure DevOps REST API client with retry
├── services/
│   ├── watcher.ts            # Polling loop with graceful shutdown
│   └── processor.ts          # Work item resolution logic
├── state/state-store.ts      # JSON-based state persistence
└── types/index.ts            # Shared TypeScript interfaces

tests/                        # Mirror of src/ with full test coverage
```
