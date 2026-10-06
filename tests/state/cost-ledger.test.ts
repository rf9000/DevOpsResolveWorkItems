import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCostLedger, type LedgerRecord } from '../../src/state/cost-ledger.ts';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'cost-ledger-test-'));
}

const entry = (workItemId: number, extra: Partial<LedgerRecord> = {}): LedgerRecord => ({
  at: '2026-10-07T10:00:00.000Z',
  workItemId,
  outcome: 'resolved',
  costUsd: 0,
  prId: 42,
  ...extra,
});

describe('createCostLedger', () => {
  it('creates missing directories and appends one JSON line per record', () => {
    const path = join(makeTmpDir(), 'nested', 'deeper', 'cost-ledger.jsonl');
    const ledger = createCostLedger({ path });

    ledger.record(entry(1, { title: 'Fix login' }));
    ledger.record(entry(2, { outcome: 'skipped', reason: 'tag' }));

    const lines = readFileSync(path, 'utf-8').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0]!)).toEqual(entry(1, { title: 'Fix login' }));
    expect(JSON.parse(lines[1]!)).toEqual(entry(2, { outcome: 'skipped', reason: 'tag' }));
  });

  it('appends to an existing file instead of overwriting', () => {
    const path = join(makeTmpDir(), 'cost-ledger.jsonl');
    writeFileSync(path, '{"existing":true}\n', 'utf-8');

    createCostLedger({ path }).record(entry(3));

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ existing: true });
    expect(JSON.parse(lines[1]!).workItemId).toBe(3);
  });

  it('never throws on write failure and warns only once', () => {
    const dir = makeTmpDir();
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x', 'utf-8');
    const warnings: string[] = [];
    const ledger = createCostLedger({ path: join(blocker, 'cost-ledger.jsonl'), warn: m => warnings.push(m) });

    expect(() => {
      ledger.record(entry(1));
      ledger.record(entry(2));
    }).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('cost ledger: could not append');
  });
});
