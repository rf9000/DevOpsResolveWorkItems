# PR Work Item Resolver — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adapt the existing DevOps pull template to resolve work items linked to completed PRs every 15 minutes.

**Architecture:** Reuse existing watcher/state/SDK infrastructure. Replace the AI-powered processor with a mechanical state-transition processor that sets `System.State` to `Resolved` for allowed work item types. Remove all AI dependencies.

**Tech Stack:** Bun, TypeScript, Zod, Azure DevOps REST API v7.0

---

### Task 1: Update types — remove AI fields, add resolver fields

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Update AppConfig and PRProcessResult**

Replace the full contents of `src/types/index.ts` with:

```typescript
/** Application configuration loaded from environment variables. */
export interface AppConfig {
  org: string;
  orgUrl: string;
  project: string;
  pat: string;
  repoIds: string[];
  pollIntervalMinutes: number;
  resolvedState: string;
  allowedWorkItemTypes: string[];
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
  resolved: number;
  skipped: number;
  errors: number;
}
```

Changes from current:
- `AppConfig`: removed `claudeModel`, `promptPath`; added `resolvedState`, `allowedWorkItemTypes`
- `PRProcessResult`: renamed `processed` to `resolved`

**Step 2: Run typecheck to see all compile errors**

Run: `bun run typecheck`
Expected: Multiple type errors in files that reference the old AppConfig fields — this is expected and will be fixed in subsequent tasks.

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: update types for work item resolver — remove AI fields, add resolver config"
```

---

### Task 2: Update config — new env vars for resolver

**Files:**
- Modify: `src/config/index.ts`
- Modify: `tests/config/config.test.ts`

**Step 1: Write the failing tests**

Replace full contents of `tests/config/config.test.ts` with:

```typescript
import { describe, expect, it } from "bun:test";
import { loadConfig } from "../../src/config/index.ts";

const validEnv: Record<string, string> = {
  AZURE_DEVOPS_PAT: "test-pat-token",
  AZURE_DEVOPS_ORG: "my-org",
  AZURE_DEVOPS_PROJECT: "my-project",
  AZURE_DEVOPS_REPO_IDS: "repo1,repo2",
};

describe("loadConfig", () => {
  it("returns correct AppConfig for valid env", () => {
    const config = loadConfig(validEnv);

    expect(config.pat).toBe("test-pat-token");
    expect(config.org).toBe("my-org");
    expect(config.orgUrl).toBe("https://dev.azure.com/my-org");
    expect(config.project).toBe("my-project");
    expect(config.repoIds).toEqual(["repo1", "repo2"]);
  });

  it("throws when AZURE_DEVOPS_PAT is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_PAT;
    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_ORG is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_ORG;
    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_PROJECT is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_PROJECT;
    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_REPO_IDS is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_REPO_IDS;
    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("applies default values when optional vars are absent", () => {
    const config = loadConfig(validEnv);

    expect(config.pollIntervalMinutes).toBe(15);
    expect(config.resolvedState).toBe("Resolved");
    expect(config.allowedWorkItemTypes).toEqual(["Bug", "User Story", "Task"]);
    expect(config.stateDir).toBe(".state");
  });

  it("overrides defaults when optional vars are provided", () => {
    const env = {
      ...validEnv,
      POLL_INTERVAL_MINUTES: "30",
      RESOLVED_STATE: "Closed",
      ALLOWED_WORK_ITEM_TYPES: "Bug,Feature",
      STATE_DIR: "/tmp/state",
    };

    const config = loadConfig(env);

    expect(config.pollIntervalMinutes).toBe(30);
    expect(config.resolvedState).toBe("Closed");
    expect(config.allowedWorkItemTypes).toEqual(["Bug", "Feature"]);
    expect(config.stateDir).toBe("/tmp/state");
  });

  it("splits repo IDs and trims whitespace", () => {
    const env = {
      ...validEnv,
      AZURE_DEVOPS_REPO_IDS: "id1, id2, id3",
    };

    const config = loadConfig(env);
    expect(config.repoIds).toEqual(["id1", "id2", "id3"]);
  });

  it("handles single repo ID without commas", () => {
    const env = {
      ...validEnv,
      AZURE_DEVOPS_REPO_IDS: "single-repo",
    };

    const config = loadConfig(env);
    expect(config.repoIds).toEqual(["single-repo"]);
  });

  it("derives orgUrl from org name", () => {
    const env = { ...validEnv, AZURE_DEVOPS_ORG: "contoso" };
    const config = loadConfig(env);
    expect(config.orgUrl).toBe("https://dev.azure.com/contoso");
  });

  it("splits and trims allowed work item types", () => {
    const env = {
      ...validEnv,
      ALLOWED_WORK_ITEM_TYPES: " Bug , User Story , Task ",
    };
    const config = loadConfig(env);
    expect(config.allowedWorkItemTypes).toEqual(["Bug", "User Story", "Task"]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/config/config.test.ts`
Expected: FAIL — `resolvedState` and `allowedWorkItemTypes` don't exist on config yet.

**Step 3: Update the config implementation**

Replace full contents of `src/config/index.ts` with:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/config/config.test.ts`
Expected: All 10 tests PASS.

**Step 5: Commit**

```bash
git add src/config/index.ts tests/config/config.test.ts
git commit -m "feat: update config for work item resolver — add resolvedState and allowedWorkItemTypes"
```

---

### Task 3: Delete AI generator and prompt

**Files:**
- Delete: `src/services/ai-generator.ts`
- Delete: `tests/services/ai-generator.test.ts`
- Delete: `.claude/commands/do-process-item.md`

**Step 1: Delete the files**

```bash
rm src/services/ai-generator.ts
rm tests/services/ai-generator.test.ts
rm .claude/commands/do-process-item.md
```

**Step 2: Remove claude-agent-sdk from package.json**

Edit `package.json` — remove `"@anthropic-ai/claude-agent-sdk": "latest"` from dependencies. The dependencies section should become:

```json
  "dependencies": {
    "zod": "latest"
  },
```

**Step 3: Commit**

```bash
git add -u
git add package.json
git commit -m "refactor: remove AI generator and claude-agent-sdk dependency"
```

---

### Task 4: Rewrite processor for work item resolution

**Files:**
- Modify: `src/services/processor.ts`
- Modify: `tests/services/processor.test.ts`

**Step 1: Write the failing tests**

Replace full contents of `tests/services/processor.test.ts` with:

```typescript
import { describe, test, expect, mock } from 'bun:test';
import type { AppConfig, AzureDevOpsPullRequest } from '../../src/types/index.ts';
import { processPR } from '../../src/services/processor.ts';
import type { ProcessorDeps } from '../../src/services/processor.ts';

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    repoIds: ['repo-1'],
    pollIntervalMinutes: 5,
    resolvedState: 'Resolved',
    allowedWorkItemTypes: ['Bug', 'User Story', 'Task'],
    stateDir: '.state',
    dryRun: false,
    ...overrides,
  };
}

function mockPR(overrides: Partial<AzureDevOpsPullRequest> = {}): AzureDevOpsPullRequest {
  return {
    pullRequestId: 42,
    title: 'Add new feature',
    description: 'Adds a great new feature to the system',
    status: 'completed',
    creationDate: '2025-01-01T00:00:00Z',
    closedDate: '2025-01-02T00:00:00Z',
    sourceRefName: 'refs/heads/feature/new-feature',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'source-commit-abc' },
    lastMergeTargetCommit: { commitId: 'target-commit-def' },
    repository: { id: 'repo-1', name: 'my-repo' },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    getPRWorkItems: mock(() => Promise.resolve([])),
    getWorkItem: mock(() =>
      Promise.resolve({
        id: 100,
        fields: {
          'System.Title': 'Work item',
          'System.WorkItemType': 'Bug',
          'System.State': 'Active',
        },
        rev: 1,
        url: 'https://example.com/100',
      }),
    ),
    updateWorkItemField: mock(() =>
      Promise.resolve({
        id: 100,
        fields: {},
        rev: 2,
        url: 'https://example.com/100',
      }),
    ),
    ...overrides,
  };
}

describe('processPR', () => {
  test('PR with no linked work items returns zeroed result', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() => Promise.resolve([])),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 0, skipped: 0, errors: 0 });
    expect(deps.getPRWorkItems).toHaveBeenCalledTimes(1);
    expect(deps.getWorkItem).toHaveBeenCalledTimes(0);
  });

  test('resolves work item in Active state', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Fix login bug',
            'System.WorkItemType': 'Bug',
            'System.State': 'Active',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 1, skipped: 0, errors: 0 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(1);

    const updateCall = (deps.updateWorkItemField as ReturnType<typeof mock>).mock.calls[0]!;
    expect(updateCall[1]).toBe(100);
    expect(updateCall[2]).toBe('System.State');
    expect(updateCall[3]).toBe('Resolved');
  });

  test('skips work item already in Resolved state', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Already done',
            'System.WorkItemType': 'Bug',
            'System.State': 'Resolved',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 0, skipped: 1, errors: 0 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });

  test('skips work item already in Closed state', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Already closed',
            'System.WorkItemType': 'Task',
            'System.State': 'Closed',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 0, skipped: 1, errors: 0 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });

  test('skips work item with disallowed type', async () => {
    const config = mockConfig({ allowedWorkItemTypes: ['Bug', 'Task'] });
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Epic item',
            'System.WorkItemType': 'Epic',
            'System.State': 'Active',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 0, skipped: 1, errors: 0 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });

  test('update failure counts as error', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '300', url: 'https://example.com/300' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 300,
          fields: {
            'System.Title': 'Broken feature',
            'System.WorkItemType': 'Bug',
            'System.State': 'Active',
          },
          rev: 1,
          url: 'https://example.com/300',
        }),
      ),
      updateWorkItemField: mock(() =>
        Promise.reject(new Error('API error')),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 0, skipped: 0, errors: 1 });
  });

  test('dry run logs but does not update', async () => {
    const config = mockConfig({ dryRun: true });
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Feature',
            'System.WorkItemType': 'User Story',
            'System.State': 'Active',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 1, skipped: 0, errors: 0 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });

  test('mixed work items: resolve one, skip one terminal, skip one wrong type', async () => {
    const config = mockConfig({ allowedWorkItemTypes: ['Bug', 'Task'] });
    const pr = mockPR();

    let getCallIndex = 0;
    const workItems = [
      { id: 101, fields: { 'System.Title': 'Bug fix', 'System.WorkItemType': 'Bug', 'System.State': 'Active' }, rev: 1, url: '' },
      { id: 102, fields: { 'System.Title': 'Done task', 'System.WorkItemType': 'Task', 'System.State': 'Closed' }, rev: 1, url: '' },
      { id: 103, fields: { 'System.Title': 'An epic', 'System.WorkItemType': 'Epic', 'System.State': 'Active' }, rev: 1, url: '' },
    ];

    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([
          { id: '101', url: '' },
          { id: '102', url: '' },
          { id: '103', url: '' },
        ]),
      ),
      getWorkItem: mock(() => {
        const wi = workItems[getCallIndex]!;
        getCallIndex++;
        return Promise.resolve(wi);
      }),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, resolved: 1, skipped: 2, errors: 0 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/services/processor.test.ts`
Expected: FAIL — processor still has old AI-based implementation.

**Step 3: Write the processor implementation**

Replace full contents of `src/services/processor.ts` with:

```typescript
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

  updateWorkItemField: (
    config: AppConfig,
    workItemId: number,
    fieldName: string,
    value: string,
  ) => Promise<WorkItemResponse>;
}

const defaultDeps: ProcessorDeps = {
  getPRWorkItems: sdk.getPRWorkItems,
  getWorkItem: sdk.getWorkItem,
  updateWorkItemField: sdk.updateWorkItemField,
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
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

      if (config.dryRun) {
        log(`  WI #${workItemId}: [DRY RUN] Would resolve: ${currentState} → ${config.resolvedState}`);
        result.resolved++;
        continue;
      }

      await deps.updateWorkItemField(
        config,
        workItemId,
        'System.State',
        config.resolvedState,
      );
      log(`  WI #${workItemId}: ${currentState} → ${config.resolvedState}`);
      result.resolved++;
    } catch (err) {
      log(`  WI #${workItemId}: Error — ${err}`);
      result.errors++;
    }
  }

  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/services/processor.test.ts`
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add src/services/processor.ts tests/services/processor.test.ts
git commit -m "feat: rewrite processor to resolve work items linked to completed PRs"
```

---

### Task 5: Update watcher — fix result field name

**Files:**
- Modify: `src/services/watcher.ts`
- Modify: `tests/services/watcher.test.ts`

**Step 1: Write updated watcher tests**

Replace full contents of `tests/services/watcher.test.ts` with:

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AppConfig, AzureDevOpsPullRequest } from '../../src/types/index.ts';
import { runPollCycle } from '../../src/services/watcher.ts';
import type { WatcherDeps } from '../../src/services/watcher.ts';
import { StateStore } from '../../src/state/state-store.ts';

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    repoIds: ['repo-1'],
    pollIntervalMinutes: 5,
    resolvedState: 'Resolved',
    allowedWorkItemTypes: ['Bug', 'User Story', 'Task'],
    stateDir: '.state',
    dryRun: false,
    ...overrides,
  };
}

function mockPR(overrides: Partial<AzureDevOpsPullRequest> = {}): AzureDevOpsPullRequest {
  return {
    pullRequestId: 42,
    title: 'Add new feature',
    description: 'Adds a great new feature to the system',
    status: 'completed',
    creationDate: '2025-01-01T00:00:00Z',
    closedDate: '2025-01-02T00:00:00Z',
    sourceRefName: 'refs/heads/feature/new-feature',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'source-commit-abc' },
    lastMergeTargetCommit: { commitId: 'target-commit-def' },
    repository: { id: 'repo-1', name: 'my-repo' },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
  return {
    listCompletedPRs: mock(() => Promise.resolve([])),
    processPR: mock(() =>
      Promise.resolve({ prId: 0, resolved: 0, skipped: 0, errors: 0 }),
    ),
    ...overrides,
  };
}

describe('runPollCycle', () => {
  let tmpDir: string;
  let stateStore: StateStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'watcher-test-'));
    stateStore = new StateStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('no new PRs returns all zeros', async () => {
    const config = mockConfig();
    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([])),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ resolved: 0, skipped: 0, errors: 0 });
    expect(deps.listCompletedPRs).toHaveBeenCalledTimes(1);
    expect(deps.processPR).toHaveBeenCalledTimes(0);
  });

  test('new PR found calls processPR, marks as processed, and saves state', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 101 });

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
      processPR: mock(() =>
        Promise.resolve({ prId: 101, resolved: 1, skipped: 0, errors: 0 }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ resolved: 1, skipped: 0, errors: 0 });
    expect(deps.processPR).toHaveBeenCalledTimes(1);
    expect(stateStore.isProcessed(101)).toBe(true);

    const reloadedStore = new StateStore(tmpDir);
    expect(reloadedStore.isProcessed(101)).toBe(true);
  });

  test('already processed PR is filtered out', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 200 });

    stateStore.markProcessed(200);
    stateStore.save();

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ resolved: 0, skipped: 0, errors: 0 });
    expect(deps.processPR).toHaveBeenCalledTimes(0);
  });

  test('processPR throws: PR not marked as processed, error counted', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 300 });

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
      processPR: mock(() => Promise.reject(new Error('Fatal processing error'))),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ resolved: 0, skipped: 0, errors: 1 });
    expect(stateStore.isProcessed(300)).toBe(false);
  });

  test('PR with errors in result is not marked as processed', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 400 });

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
      processPR: mock(() =>
        Promise.resolve({ prId: 400, resolved: 0, skipped: 0, errors: 1 }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ resolved: 0, skipped: 0, errors: 1 });
    expect(stateStore.isProcessed(400)).toBe(false);
  });

  test('multiple repos polls each one', async () => {
    const config = mockConfig({ repoIds: ['repo-a', 'repo-b', 'repo-c'] });

    const prA = mockPR({
      pullRequestId: 501,
      repository: { id: 'repo-a', name: 'repo-a' },
    });
    const prB = mockPR({
      pullRequestId: 502,
      repository: { id: 'repo-b', name: 'repo-b' },
    });

    const listMock = mock((cfg: AppConfig, repoId: string) => {
      if (repoId === 'repo-a') return Promise.resolve([prA]);
      if (repoId === 'repo-b') return Promise.resolve([prB]);
      return Promise.resolve([]);
    });

    const deps = makeDeps({
      listCompletedPRs: listMock,
      processPR: mock(() =>
        Promise.resolve({ prId: 0, resolved: 1, skipped: 0, errors: 0 }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ resolved: 2, skipped: 0, errors: 0 });
    expect(deps.listCompletedPRs).toHaveBeenCalledTimes(3);
    expect(deps.processPR).toHaveBeenCalledTimes(2);
    expect(stateStore.isProcessed(501)).toBe(true);
    expect(stateStore.isProcessed(502)).toBe(true);
  });
});
```

**Step 2: Update the watcher implementation**

In `src/services/watcher.ts`, change `result.processed` references to `result.resolved` and update the log message. Replace the `runPollCycle` function body:

Replace `totalProcessed` → `totalResolved` and `result.processed` → `result.resolved` in the function. Also update the log message in `startWatcher`.

Full replacement of `src/services/watcher.ts`:

```typescript
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
    const newPRs = prs.filter(pr => !stateStore.isProcessed(pr.pullRequestId));

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
```

**Step 3: Run watcher tests**

Run: `bun test tests/services/watcher.test.ts`
Expected: All 6 tests PASS.

**Step 4: Commit**

```bash
git add src/services/watcher.ts tests/services/watcher.test.ts
git commit -m "refactor: update watcher to use resolved counts instead of processed"
```

---

### Task 6: Update CLI and SDK test helpers

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `tests/sdk/azure-devops-client.test.ts`

**Step 1: Update the CLI**

Replace full contents of `src/cli/index.ts` with:

```typescript
#!/usr/bin/env bun

import { loadConfig } from '../config/index.ts';
import { startWatcher, runPollCycle } from '../services/watcher.ts';
import { StateStore } from '../state/state-store.ts';
import { getPullRequest } from '../sdk/azure-devops-client.ts';
import { processPR } from '../services/processor.ts';

const HELP = `
DevOps Work Item Resolver

Polls for completed pull requests and resolves linked work items.

Usage:
  devops-resolve <command>

Commands:
  watch            Start the long-running watcher (polls every N minutes)
  run-once         Run a single poll cycle and exit
  test-pr <id>     Process a single PR (dry-run, no writes)
  reset-state      Clear the processed PR state and exit
  help             Show this help message

Options:
  --dry-run        Read-only mode: log state changes but skip Azure DevOps writes

Environment variables:
  AZURE_DEVOPS_PAT              Azure DevOps personal access token (required)
  AZURE_DEVOPS_ORG              Azure DevOps organization name (required)
  AZURE_DEVOPS_PROJECT          Azure DevOps project name (required)
  AZURE_DEVOPS_REPO_IDS         Comma-separated repository IDs (required)
  POLL_INTERVAL_MINUTES         Polling interval (default: 15)
  RESOLVED_STATE                Target work item state (default: Resolved)
  ALLOWED_WORK_ITEM_TYPES       Comma-separated types to resolve (default: Bug,User Story,Task)
  STATE_DIR                     State directory (default: .state)
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
    console.log(`Done: ${result.resolved} resolved, ${result.skipped} skipped, ${result.errors} errors`);
    break;
  }

  case 'test-pr': {
    const prIdArg = process.argv[3];
    if (!prIdArg || isNaN(Number(prIdArg))) {
      console.error('Usage: devops-resolve test-pr <pr-id>');
      process.exitCode = 1;
      break;
    }
    const config = loadConfig();
    config.dryRun = true;
    console.log(`[DRY RUN] Testing resolution for PR #${prIdArg}\n`);
    const repoId = config.repoIds[0]!;
    const pr = await getPullRequest(config, repoId, Number(prIdArg));
    const result = await processPR(config, pr);
    console.log(`\nDone: ${result.resolved} resolved, ${result.skipped} skipped, ${result.errors} errors`);
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
```

**Step 2: Update SDK test mockConfig helper**

In `tests/sdk/azure-devops-client.test.ts`, update the `mockConfig()` function to match new AppConfig shape. Replace the mockConfig function (lines 17-29):

```typescript
function mockConfig(): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    repoIds: ['repo-1'],
    pollIntervalMinutes: 5,
    resolvedState: 'Resolved',
    allowedWorkItemTypes: ['Bug', 'User Story', 'Task'],
    stateDir: '.state',
    dryRun: false,
  };
}
```

**Step 3: Update package.json name**

In `package.json`, change `"name"` from `"devops-pull-template"` to `"devops-resolve-work-items"`.

**Step 4: Run all tests**

Run: `bun test`
Expected: All tests PASS (config: 10, sdk: 12, state: 10, processor: 8, watcher: 6 = 46 total).

**Step 5: Commit**

```bash
git add src/cli/index.ts tests/sdk/azure-devops-client.test.ts package.json
git commit -m "feat: update CLI for work item resolver, fix SDK test helpers, rename package"
```

---

### Task 7: Update integration tests

**Files:**
- Modify: `tests/integration/end-to-end.test.ts`

**Step 1: Update integration test to verify work item state field**

Replace full contents of `tests/integration/end-to-end.test.ts` with:

```typescript
import { describe, test, expect } from 'bun:test';
import { loadConfig } from '../../src/config/index.ts';
import { listCompletedPRs, getPRWorkItems, getWorkItem } from '../../src/sdk/azure-devops-client.ts';

const hasCredentials = Boolean(
  process.env.AZURE_DEVOPS_PAT &&
  process.env.AZURE_DEVOPS_ORG &&
  process.env.AZURE_DEVOPS_PROJECT &&
  process.env.AZURE_DEVOPS_REPO_IDS,
);

describe.skipIf(!hasCredentials)('Integration: Azure DevOps API', () => {
  test('can list completed PRs', async () => {
    const config = loadConfig();
    const repoId = config.repoIds[0]!;
    const prs = await listCompletedPRs(config, repoId, 5);
    expect(Array.isArray(prs)).toBe(true);
    if (prs.length > 0) {
      const pr = prs[0]!;
      expect(pr.pullRequestId).toBeNumber();
      expect(pr.title).toBeString();
      expect(pr.status).toBe('completed');
    }
  });

  test('can get PR work items', async () => {
    const config = loadConfig();
    const repoId = config.repoIds[0]!;
    const prs = await listCompletedPRs(config, repoId, 5);
    if (prs.length > 0) {
      const pr = prs[0]!;
      const workItems = await getPRWorkItems(config, repoId, pr.pullRequestId);
      expect(Array.isArray(workItems)).toBe(true);
    }
  });

  test('can get work item with state field', async () => {
    const config = loadConfig();
    const repoId = config.repoIds[0]!;
    const prs = await listCompletedPRs(config, repoId, 5);
    if (prs.length > 0) {
      const pr = prs[0]!;
      const workItems = await getPRWorkItems(config, repoId, pr.pullRequestId);
      if (workItems.length > 0) {
        const wi = await getWorkItem(config, Number(workItems[0]!.id));
        expect(wi.id).toBeNumber();
        expect(wi.fields).toBeDefined();
        expect(wi.fields['System.Title']).toBeString();
        expect(wi.fields['System.State']).toBeString();
        expect(wi.fields['System.WorkItemType']).toBeString();
      }
    }
  });
});
```

**Step 2: Run integration tests (will skip if no credentials)**

Run: `bun test tests/integration/end-to-end.test.ts`
Expected: SKIP (no credentials in dev environment) or PASS (if credentials set).

**Step 3: Commit**

```bash
git add tests/integration/end-to-end.test.ts
git commit -m "test: update integration tests to verify work item state field"
```

---

### Task 8: Run full test suite and typecheck

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass.

**Step 3: If any failures, fix and re-run**

Fix any remaining issues and commit.

---

### Task 9: Update README and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md project description**

Update the Project Overview section to describe the work item resolver instead of the template. Update Key Patterns to remove AI references.

**Step 2: Update README.md**

Update to describe the work item resolver, its configuration, and usage.

**Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for work item resolver"
```
