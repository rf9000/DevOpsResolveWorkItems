import { describe, test, expect } from 'bun:test';
import { buildUserPrompt } from '../../src/services/ai-generator.ts';
import type { GeneratorContext } from '../../src/services/ai-generator.ts';

describe('buildUserPrompt', () => {
  const baseContext: GeneratorContext = {
    prTitle: 'Fix login timeout',
    prDescription: 'Increased timeout from 5s to 30s',
    changedFiles: ['src/auth/login.ts', 'src/auth/config.ts'],
    workItemTitle: 'Login times out too quickly',
    workItemType: 'Bug',
  };

  test('includes PR title', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('**Title:** Fix login timeout');
  });

  test('includes PR description when present', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('**Description:** Increased timeout from 5s to 30s');
  });

  test('omits description when empty', () => {
    const prompt = buildUserPrompt({ ...baseContext, prDescription: '' });
    expect(prompt).not.toContain('**Description:**');
  });

  test('lists changed files', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('## Changed Files');
    expect(prompt).toContain('- src/auth/login.ts');
    expect(prompt).toContain('- src/auth/config.ts');
  });

  test('omits changed files section when empty', () => {
    const prompt = buildUserPrompt({ ...baseContext, changedFiles: [] });
    expect(prompt).not.toContain('## Changed Files');
  });

  test('truncates at 50 files with overflow message', () => {
    const manyFiles = Array.from({ length: 60 }, (_, i) => `src/file${i}.ts`);
    const prompt = buildUserPrompt({ ...baseContext, changedFiles: manyFiles });
    expect(prompt).toContain('- src/file49.ts');
    expect(prompt).not.toContain('- src/file50.ts');
    expect(prompt).toContain('...and 10 more files');
  });

  test('includes work item type and title', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('**Type:** Bug');
    expect(prompt).toContain('**Title:** Login times out too quickly');
  });

  test('includes all sections in order', () => {
    const prompt = buildUserPrompt(baseContext);
    const prSection = prompt.indexOf('## Pull Request');
    const filesSection = prompt.indexOf('## Changed Files');
    const wiSection = prompt.indexOf('## Work Item');
    expect(prSection).toBeLessThan(filesSection);
    expect(filesSection).toBeLessThan(wiSection);
  });
});
