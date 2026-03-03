# Design: PR Work Item Resolver

**Date:** 2026-03-03
**Goal:** Every 15 minutes, find completed pull requests, check linked work items, and set their state to "Resolved".

## Decisions

- **Target state:** `Resolved` (configurable via `RESOLVED_STATE` env var)
- **Source states:** Any non-terminal state (skip items already `Resolved` or `Closed`)
- **Allowed work item types:** Bug, User Story, Task (configurable via `ALLOWED_WORK_ITEM_TYPES`)
- **AI:** Not needed — purely mechanical state transition
- **Approach:** Adapt existing template scaffolding in-place

## Architecture

Reuse existing infrastructure:
- **Watcher** polls every 15 min, lists completed PRs, filters already-processed
- **State store** tracks processed PR IDs in `.state/processed-prs.json`
- **SDK** already has `updateWorkItemField` for PATCH operations
- **Config** validated via Zod

## Processor Algorithm

```
processPR(config, pr):
  1. Get linked work items via Azure DevOps API
  2. If none -> return early
  3. For each work item:
     a. Fetch full work item details
     b. Check System.WorkItemType against allowedWorkItemTypes -> skip if not allowed
     c. Check System.State -> skip if already "Resolved" or "Closed"
     d. If dry-run: log what would happen, count as resolved
     e. Else: PATCH System.State to config.resolvedState
     f. Log the transition (e.g., "WI #1234: Active -> Resolved")
  4. Return { prId, resolved, skipped, errors }
```

## Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `AZURE_DEVOPS_PAT` | Yes | — | Personal access token |
| `AZURE_DEVOPS_ORG` | Yes | — | Organization name |
| `AZURE_DEVOPS_PROJECT` | Yes | — | Project name |
| `AZURE_DEVOPS_REPO_IDS` | Yes | — | Comma-separated repo IDs |
| `POLL_INTERVAL_MINUTES` | No | 15 | Polling interval |
| `RESOLVED_STATE` | No | Resolved | Target work item state |
| `ALLOWED_WORK_ITEM_TYPES` | No | Bug,User Story,Task | Types to resolve |
| `STATE_DIR` | No | .state | State persistence directory |

## Files to Remove

- `src/services/ai-generator.ts`
- `tests/services/ai-generator.test.ts`
- `.claude/commands/do-process-item.md`

## Files to Modify

- `src/config/index.ts` — add resolvedState, allowedWorkItemTypes; remove claudeModel, promptPath
- `src/types/index.ts` — update AppConfig, rename result fields
- `src/services/processor.ts` — replace with resolution logic
- `src/services/watcher.ts` — update deps (remove AI reference)
- `src/cli/index.ts` — remove AI references, update help text
- `tests/` — update all tests
- `package.json` — remove @anthropic-ai/claude-agent-sdk
