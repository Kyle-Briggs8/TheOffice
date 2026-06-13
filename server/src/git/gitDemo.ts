/**
 * Step 2 proof: exercises the GitService branch + worktree lifecycle directly —
 * zero SDK calls. Happy path (branch → edit → commit → diffstat → merge →
 * cleanup) and a real merge conflict (detected, aborted, reported).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { GitService } from "./GitService.js";

async function main(): Promise<void> {
  const config = loadConfig([]);
  const git = new GitService(config.projectDir, path.join(config.officeHqDir, "worktrees"));

  console.log(`project repo: ${config.projectDir}\n`);
  await git.ensureProjectRepo();

  // --- happy path ----------------------------------------------------------
  console.log("— happy path —");
  const wt = await git.createTaskWorktree("jim", "demo-hello");
  console.log(`worktree: ${wt.worktreePath}\nbranch:   ${wt.branch}`);

  await writeFile(path.join(wt.worktreePath, "hello.txt"), "world\n", "utf8");
  console.log(`committed: ${await git.commitAll(wt.worktreePath, "feat: add hello.txt (jim)")}`);
  console.log(`diffstat:  ${await git.diffStat(wt.branch)}`);

  const merged = await git.merge(wt.branch);
  console.log(`merge:     ${merged.ok ? "ok" : "CONFLICT (unexpected!)"}`);
  await git.removeTaskWorktree("jim", wt.branch, { force: false });

  // --- conflict path -------------------------------------------------------
  console.log("\n— conflict path —");
  const wt2 = await git.createTaskWorktree("jim", "demo-conflict");
  await writeFile(path.join(wt2.worktreePath, "hello.txt"), "jim's version\n", "utf8");
  await git.commitAll(wt2.worktreePath, "feat: jim edits hello.txt");

  // Conflicting commit straight onto main while jim's branch diverges.
  await writeFile(path.join(config.projectDir, "hello.txt"), "main's version\n", "utf8");
  await git.commitAll(config.projectDir, "feat: main edits hello.txt");

  const conflicted = await git.merge(wt2.branch);
  if (conflicted.ok) {
    console.log("merge:     ok (expected a conflict — something is wrong)");
  } else {
    console.log(`merge:     conflict detected + aborted, files: ${conflicted.conflictFiles.join(", ")}`);
  }
  await git.removeTaskWorktree("jim", wt2.branch, { force: true });

  console.log("\ngit lifecycle demo complete.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
