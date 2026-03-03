import { readFileSync } from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AppConfig } from '../types/index.ts';

export interface GeneratorContext {
  prTitle: string;
  prDescription: string;
  changedFiles: string[];
  workItemTitle: string;
  workItemType: string;
}

export async function generateWithAI(
  config: AppConfig,
  context: GeneratorContext,
): Promise<string> {
  const systemPrompt = readFileSync(config.promptPath, 'utf-8');
  const userPrompt = buildUserPrompt(context);

  let result: string | undefined;

  for await (const message of query({
    prompt: userPrompt,
    options: {
      model: config.claudeModel,
      maxTurns: 1,
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      systemPrompt,
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') {
      result = message.result;
    }
  }

  if (result === undefined) {
    throw new Error('No result received from Claude Agent SDK');
  }

  return result.trim();
}

export function buildUserPrompt(context: GeneratorContext): string {
  const lines: string[] = [
    `## Pull Request`,
    `**Title:** ${context.prTitle}`,
  ];

  if (context.prDescription) {
    lines.push(`**Description:** ${context.prDescription}`);
  }

  if (context.changedFiles.length > 0) {
    lines.push('', '## Changed Files');
    const shown = context.changedFiles.slice(0, 50);
    for (const f of shown) {
      lines.push(`- ${f}`);
    }
    if (context.changedFiles.length > 50) {
      lines.push(`- ...and ${context.changedFiles.length - 50} more files`);
    }
  }

  lines.push('', '## Work Item');
  lines.push(`**Type:** ${context.workItemType}`);
  lines.push(`**Title:** ${context.workItemTitle}`);

  return lines.join('\n');
}
