import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export interface WorktreeInfo {
  branch: string;
  worktreePath: string;
}

export type MergeResult = { ok: true } | { ok: false; conflictFiles: string[] };

/** Branch-safe slug from a task prompt: "Add a hello() fn!" → "add-a-hello-fn". */
export function slugify(text: string, maxLength = 32): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "task";
}

/**
 * v1 collaboration model: one real repo at office-hq/project (main branch),
 * one worktree per agent under office-hq/worktrees/<agent>, branches named
 * office/<agent>/<task-slug>. Raw git via execa — no abstraction layer.
 */
export class GitService {
  constructor(
    private readonly projectDir: string,
    private readonly worktreesDir: string,
  ) {}

  private git(args: string[], cwd: string = this.projectDir) {
    return execa("git", args, { cwd });
  }

  /** The repo root governing cwd, or null if cwd isn't in any repo. */
  private async repoToplevel(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await this.git(["rev-parse", "--show-toplevel"], cwd);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  private isOwnRepoRoot(toplevel: string | null): boolean {
    return toplevel !== null && path.relative(path.resolve(this.projectDir), toplevel) === "";
  }

  /** Idempotent: init the toy repo on main with an initial commit if missing. */
  async ensureProjectRepo(): Promise<void> {
    await mkdir(this.projectDir, { recursive: true });
    // The project dir may sit nested inside an unrelated outer repo (e.g. the
    // game's own repo). "Inside a work tree" is NOT enough — the project must
    // be its OWN repo root, or every git op here would hit the outer repo.
    if (!this.isOwnRepoRoot(await this.repoToplevel(this.projectDir))) {
      await this.git(["init", "-b", "main"]);
    }
    if (!this.isOwnRepoRoot(await this.repoToplevel(this.projectDir))) {
      throw new Error(
        `refusing to operate: ${this.projectDir} is not its own git repo root`,
      );
    }
    const hasCommit = await this.git(["rev-parse", "--verify", "HEAD"]).then(
      () => true,
      () => false,
    );
    if (!hasCommit) {
      const readme = path.join(this.projectDir, "README.md");
      try {
        await access(readme);
      } catch {
        await writeFile(
          readme,
          "# office-hq project\n\nThe repo the office agents work on.\n",
          "utf8",
        );
      }
      await this.git(["add", "-A"]);
      await this.git(["commit", "-m", "chore: initial commit"]);
    }
  }

  /** Branch from main + worktree for the agent. Cleans up any stale worktree first. */
  async createTaskWorktree(agent: string, taskSlug: string): Promise<WorktreeInfo> {
    const branch = `office/${agent}/${taskSlug}`;
    const worktreePath = path.join(this.worktreesDir, agent);

    await this.git(["worktree", "remove", "--force", worktreePath]).catch(() => {});
    await rm(worktreePath, { recursive: true, force: true });
    await this.git(["worktree", "prune"]);

    await this.git(["worktree", "add", "-b", branch, worktreePath, "main"]);
    return { branch, worktreePath };
  }

  /** Stage + commit everything in the worktree. Returns false if nothing changed. */
  async commitAll(worktreePath: string, message: string): Promise<boolean> {
    await this.git(["add", "-A"], worktreePath);
    const { stdout } = await this.git(["status", "--porcelain"], worktreePath);
    if (stdout.trim() === "") return false;
    await this.git(["commit", "-m", message], worktreePath);
    return true;
  }

  /** Human-readable shortstat of the branch vs main, for review.ready. */
  async diffStat(branch: string): Promise<string> {
    const { stdout } = await this.git(["diff", "--shortstat", `main...${branch}`]);
    return stdout.trim() || "no changes";
  }

  /**
   * Merge the branch into main (run in the project repo, which stays on main).
   * On conflict: collect the conflicted paths, abort, and report — the AGENT
   * resolves conflicts via send-back, never the player.
   */
  async merge(branch: string): Promise<MergeResult> {
    try {
      await this.git(["merge", "--no-ff", branch, "-m", `merge: ${branch}`]);
      return { ok: true };
    } catch {
      let conflictFiles: string[] = [];
      try {
        const { stdout } = await this.git(["diff", "--name-only", "--diff-filter=U"]);
        conflictFiles = stdout.split("\n").filter(Boolean);
      } catch {
        // repo state already reset — leave the list empty
      }
      await this.git(["merge", "--abort"]).catch(() => {});
      return { ok: false, conflictFiles };
    }
  }

  /** Remove the agent's worktree and its branch (force = kill an unmerged branch). */
  async removeTaskWorktree(
    agent: string,
    branch: string,
    options: { force: boolean },
  ): Promise<void> {
    const worktreePath = path.join(this.worktreesDir, agent);
    await this.git(["worktree", "remove", "--force", worktreePath]).catch(() => {});
    await this.git(["branch", options.force ? "-D" : "-d", branch]).catch(() => {});
    await this.git(["worktree", "prune"]).catch(() => {});
  }
}
