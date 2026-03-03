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

  test('can get work item details', async () => {
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
      }
    }
  });
});
