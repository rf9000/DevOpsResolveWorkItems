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
    skipTags: ['Recurring'],
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

  test('skips work item with a skip tag', async () => {
    const config = mockConfig({ skipTags: ['Recurring', 'DoNotResolve'] });
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Recurring task',
            'System.WorkItemType': 'Task',
            'System.State': 'Active',
            'System.Tags': 'Important; Recurring',
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
});
