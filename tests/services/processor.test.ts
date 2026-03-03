import { describe, test, expect, mock } from 'bun:test';
import type { AppConfig, AzureDevOpsPullRequest } from '../../src/types/index.ts';
import { processPR } from '../../src/services/processor.ts';
import type { ProcessorDeps } from '../../src/services/processor.ts';

function mockConfig(): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    repoIds: ['repo-1'],
    pollIntervalMinutes: 5,
    claudeModel: 'claude-sonnet-4-6',
    promptPath: './prompt.md',
    stateDir: '.state',
    dryRun: false,
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
        fields: { 'System.Title': 'Work item', 'System.WorkItemType': 'User Story' },
        rev: 1,
        url: 'https://example.com/100',
      }),
    ),
    getPRChangedFiles: mock(() => Promise.resolve(['/src/index.ts', '/README.md'])),
    updateWorkItemField: mock(() =>
      Promise.resolve({
        id: 100,
        fields: {},
        rev: 2,
        url: 'https://example.com/100',
      }),
    ),
    generateWithAI: mock(() => Promise.resolve('Generated output')),
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

    expect(result).toEqual({ prId: 42, processed: 0, skipped: 0, errors: 0 });
    expect(deps.getPRWorkItems).toHaveBeenCalledTimes(1);
    expect(deps.getWorkItem).toHaveBeenCalledTimes(0);
    expect(deps.getPRChangedFiles).toHaveBeenCalledTimes(0);
  });

  test('PR with work item generates and writes output', async () => {
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
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
      getPRChangedFiles: mock(() =>
        Promise.resolve(['/src/auth/login.ts']),
      ),
      generateWithAI: mock(() => Promise.resolve('AI generated output')),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, processed: 1, skipped: 0, errors: 0 });
    expect(deps.generateWithAI).toHaveBeenCalledTimes(1);
  });

  test('PR with generation failure counts as error', async () => {
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
          },
          rev: 1,
          url: 'https://example.com/300',
        }),
      ),
      generateWithAI: mock(() =>
        Promise.reject(new Error('Claude API error')),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, processed: 0, skipped: 0, errors: 1 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });

  test('changed files fetch failure still processes work items', async () => {
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
            'System.Title': 'Some feature',
            'System.WorkItemType': 'User Story',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
      getPRChangedFiles: mock(() =>
        Promise.reject(new Error('Diff API failed')),
      ),
      generateWithAI: mock(() =>
        Promise.resolve('Output without file context'),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, processed: 1, skipped: 0, errors: 0 });

    const genCall = (deps.generateWithAI as ReturnType<typeof mock>).mock.calls[0]!;
    expect(genCall[1]).toEqual({
      prTitle: 'Add new feature',
      prDescription: 'Adds a great new feature to the system',
      changedFiles: [],
      workItemTitle: 'Some feature',
      workItemType: 'User Story',
    });
  });

  test('dry run generates but does not write', async () => {
    const config = { ...mockConfig(), dryRun: true };
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
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
      generateWithAI: mock(() => Promise.resolve('Dry run output')),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({ prId: 42, processed: 1, skipped: 0, errors: 0 });
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });
});
