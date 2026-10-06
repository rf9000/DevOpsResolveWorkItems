import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * One line of the ledger, shared contract with the sibling DevOps agents.
 * This agent spends nothing on LLMs, so costUsd is always 0; the ledger still
 * records what happened to each linked work item.
 */
export interface LedgerRecord {
  /** ISO timestamp of when the work item was handled. */
  at: string;
  workItemId: number;
  outcome: 'resolved' | 'skipped' | 'failed';
  costUsd: number;
  title?: string;
  /** The completed PR the work item was linked to. */
  prId: number;
  /** Why a work item was skipped ('type' | 'terminal' | 'tag') or failed. */
  reason?: string;
}

export interface CostLedger {
  record(entry: LedgerRecord): void;
}

/**
 * Append-only JSONL ledger. Every write is best-effort: a ledger failure must
 * never turn a run into a failed one. Warns once per ledger instance.
 */
export function createCostLedger(deps: {
  path: string;
  warn?: (message: string) => void;
}): CostLedger {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  let warned = false;

  return {
    record(entry: LedgerRecord): void {
      try {
        mkdirSync(dirname(deps.path), { recursive: true });
        appendFileSync(deps.path, `${JSON.stringify(entry)}\n`, 'utf-8');
      } catch (err) {
        if (!warned) {
          warned = true;
          warn(
            `cost ledger: could not append to ${deps.path} :: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },
  };
}

const ledgers = new Map<string, CostLedger>();

/** Process-wide ledger per path, so warn-once holds across PRs and cycles. */
export function getCostLedger(path: string): CostLedger {
  let ledger = ledgers.get(path);
  if (!ledger) {
    ledger = createCostLedger({ path });
    ledgers.set(path, ledger);
  }
  return ledger;
}
