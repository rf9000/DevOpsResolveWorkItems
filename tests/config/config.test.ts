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

  it("splits and trims allowed work item types", () => {
    const env = {
      ...validEnv,
      ALLOWED_WORK_ITEM_TYPES: " Bug , User Story , Task ",
    };
    const config = loadConfig(env);
    expect(config.allowedWorkItemTypes).toEqual(["Bug", "User Story", "Task"]);
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
});
