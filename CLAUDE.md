# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevOpsResolveWorkItems polls Azure DevOps for completed pull requests every 15 minutes, finds linked work items, and sets their state to "Resolved". It targets Bug, User Story, and Task work item types by default, skipping items already in terminal states (Resolved/Closed).

## Architecture

- **Runtime:** Bun (TypeScript)
- **Validation:** Zod for environment config
- **Testing:** Bun's built-in test framework

## Key Patterns

- **Dependency injection** via interfaces on all services for testability
- **Exponential backoff retry** on Azure DevOps API calls (5xx/network errors)
- **JSON state store** with Set-based O(1) lookups
- **Polling watcher** with graceful SIGINT/SIGTERM shutdown

## Commands

- `bun test` — run all tests
- `bun run typecheck` — TypeScript type checking
- `bun run start` — start the watcher
- `bun run once` — single poll cycle

## File Layout

- `src/config/` — Zod env validation
- `src/sdk/` — Azure DevOps REST client
- `src/services/` — business logic (processor, watcher)
- `src/state/` — JSON persistence
- `src/types/` — shared interfaces
- `tests/` — mirrors src/ structure
