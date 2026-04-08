import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRWorkItemRef,
  WorkItemResponse,
  DiffResponse,
} from '../types/index.ts';

export class AzureDevOpsError extends Error {
  override readonly name = 'AzureDevOpsError';
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function adoFetch<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${config.orgUrl}/${config.project}/_apis/${path}`;
  const authHeader =
    'Basic ' + Buffer.from(':' + config.pat).toString('base64');

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AzureDevOpsError(
      `Azure DevOps API error ${res.status}: ${body}`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000];

export async function adoFetchWithRetry<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS,
): Promise<T> {
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await adoFetch<T>(config, path, options);
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxAttempts;

      if (err instanceof AzureDevOpsError) {
        if (err.statusCode < 500) {
          throw err;
        }
        if (isLastAttempt) {
          throw err;
        }
      } else {
        if (isLastAttempt) {
          throw err;
        }
      }

      const delay = retryDelays[attempt - 1] ?? 0;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('adoFetchWithRetry: unexpected code path');
}

export async function listCompletedPRs(
  config: AppConfig,
  repoId: string,
  top = 50,
): Promise<AzureDevOpsPullRequest[]> {
  const path = `git/repositories/${repoId}/pullrequests?searchCriteria.status=completed&$top=${top}&api-version=7.0`;
  const data = await adoFetchWithRetry<{ value: AzureDevOpsPullRequest[] }>(
    config,
    path,
  );
  return data.value;
}

export async function getPullRequest(
  config: AppConfig,
  repoId: string,
  prId: number,
): Promise<AzureDevOpsPullRequest> {
  const path = `git/repositories/${repoId}/pullrequests/${prId}?api-version=7.0`;
  return adoFetchWithRetry<AzureDevOpsPullRequest>(config, path);
}

export async function getPRWorkItems(
  config: AppConfig,
  repoId: string,
  prId: number,
): Promise<PRWorkItemRef[]> {
  const path = `git/repositories/${repoId}/pullrequests/${prId}/workitems?api-version=7.0`;
  const data = await adoFetchWithRetry<{ value: PRWorkItemRef[] }>(
    config,
    path,
  );
  return data.value;
}

export async function getWorkItem(
  config: AppConfig,
  workItemId: number,
): Promise<WorkItemResponse> {
  const path = `wit/workitems/${workItemId}?$expand=all&api-version=7.0`;
  return adoFetchWithRetry<WorkItemResponse>(config, path);
}

export async function getPRChangedFiles(
  config: AppConfig,
  repoId: string,
  baseCommit: string,
  targetCommit: string,
): Promise<string[]> {
  const path = `git/repositories/${repoId}/diffs/commits?baseVersion=${baseCommit}&targetVersion=${targetCommit}&api-version=7.0`;
  const data = await adoFetchWithRetry<DiffResponse>(config, path);
  return data.changes.map((c) => c.item.path);
}

export async function updateWorkItemFields(
  config: AppConfig,
  workItemId: number,
  fields: Array<{ field: string; value: unknown }>,
): Promise<WorkItemResponse> {
  const path = `wit/workitems/${workItemId}?api-version=7.0`;
  const ops = fields.map(({ field, value }) => ({
    op: 'add',
    path: `/fields/${field}`,
    value,
  }));
  return adoFetchWithRetry<WorkItemResponse>(config, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify(ops),
  });
}
