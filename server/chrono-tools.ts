/**
 * Chrono tools — agent-facing time manipulation via ops/chrono/chrono_sandbox.py.
 *
 * Safety model (what the agent may do unaided vs. never):
 *   SAFE  : snapshot, log, ledger, forks, diff — read-only or additive.
 *   SAFE  : fork — creates worktrees, touches nothing existing.
 *   GUARDED: rewind — always takes a pre-rewind safety snapshot (the CLI does
 *            this itself) and defaults to --keep (refuses to clobber dirty
 *            uncommitted work unless hard=true is passed explicitly).
 *   GUARDED: merge_winner, prune — destructive to fork timelines only, never
 *            to the main line. Require an exact fork name (or all=true for prune).
 *
 * Every mutating tool call already produces a micro-snapshot (chrono-hook.ts),
 * so the agent always has a T-1 recovery point before its own changes.
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';

const CHRONO_PY = process.env.CHRONO_PY || '/opt/homebrew/bin/python3';
const CHRONO_CLI = process.env.CHRONO_CLI || '/Volumes/Storage/FLOYD_WORKSTATION/ops/chrono/chrono_sandbox.py';

/** Repos the agent may time-manipulate. Mirrors the frame's CHRONO_SURFACES. */
const CHRONO_REPOS: Record<string, string> = {
  desktop: '/Volumes/Storage/FLOYD_WORKSTATION/intake/surfaces/desktop',
  ide: '/Volumes/Storage/FLOYD_WORKSTATION/intake/surfaces/ide',
  launcher: '/Volumes/Storage/FLOYD_WORKSTATION/intake/surfaces/launcher',
  pty: '/Volumes/Storage/FLOYD_WORKSTATION/intake/surfaces/pty',
  workstation: '/Volumes/Storage/FLOYD_WORKSTATION',
};

const NAME_RE = /^[\w-]{1,40}$/;

function run(repo: string, argv: string[]): Promise<{ success: boolean; result?: any; error?: string }> {
  return new Promise((done) => {
    execFile(CHRONO_PY, [CHRONO_CLI, repo, ...argv], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return done({ success: false, error: (stderr || String(err)).slice(0, 500) });
      try {
        const r = JSON.parse(stdout);
        done(r.ok === false ? { success: false, error: r.error } : { success: true, result: r });
      } catch {
        done({ success: false, error: `chrono returned non-JSON: ${String(stdout).slice(0, 200)}` });
      }
    });
  });
}

function repoFor(surface: unknown): string | null {
  return CHRONO_REPOS[String(surface || 'desktop')] || null;
}

export function chronoToolsAvailable(): boolean {
  return existsSync(CHRONO_CLI);
}

export const CHRONO_TOOLS = [
  {
    name: 'chrono_snapshot',
    description: 'Take a linear micro-snapshot (git commit of all current changes) of a surface repo. This is your manual save point. A snapshot is also taken automatically after every mutating tool call, but call this before starting anything risky or multi-step. Returns the snapshot sha. Safe: never loses work.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS), description: 'Which repo to snapshot (default desktop)' },
        message: { type: 'string', description: 'Optional snapshot label, e.g. "before refactor of X"' },
      },
    },
  },
  {
    name: 'chrono_log',
    description: 'List recent snapshots/commits of a surface repo with sha, time, and subject. Use to find the rewind target. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) },
        n: { type: 'number', description: 'How many entries (default 15, max 60)' },
      },
    },
  },
  {
    name: 'chrono_rewind',
    description: 'Rewind a surface repo to an earlier snapshot. SAFETY: a pre-rewind snapshot is taken automatically first, and the result includes a recovery_hint to undo the rewind itself. Default mode preserves uncommitted work (fails rather than clobbering it); pass hard=true ONLY when the user explicitly wants to discard current changes. Use chrono_log first to pick the target sha.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) },
        to: { type: 'string', description: 'Target ref/sha (default HEAD~1)' },
        hard: { type: 'boolean', description: 'Discard uncommitted changes too. Destructive — only with explicit user consent.' },
      },
    },
  },
  {
    name: 'chrono_fork',
    description: 'Chrono-fork: create N parallel worktrees (alternate timelines) off the current commit. Each fork is an isolated directory where changes do not touch the main line. Use for trying multiple approaches in parallel (ensemble), then chrono_diff to compare and chrono_merge_winner to keep the best. Safe: purely additive.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) },
        names: { type: 'array', items: { type: 'string' }, description: 'Fork names, e.g. ["approach-a","approach-b"]. Letters/digits/dash/underscore only.' },
      },
      required: ['names'],
    },
  },
  {
    name: 'chrono_forks',
    description: 'List live forks of a surface repo with their head, dirty state, and diffstat vs base. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) } },
    },
  },
  {
    name: 'chrono_diff',
    description: 'Show one fork\'s full diff against its base commit. Use to evaluate which fork won before chrono_merge_winner. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) },
        name: { type: 'string', description: 'Fork name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'chrono_merge_winner',
    description: 'Commit the named fork\'s changes into the main line and prune ALL other forks (losing timelines are deleted). Destructive to the losing forks only — the main line and winner are preserved. Confirm the winner with chrono_diff first.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) },
        name: { type: 'string', description: 'Winning fork name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'chrono_prune',
    description: 'Delete a fork (or all forks with all=true) WITHOUT merging. The fork\'s changes are lost. Main line untouched. Use when an experiment is abandoned.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) },
        name: { type: 'string', description: 'Fork to delete' },
        all: { type: 'boolean', description: 'Delete every fork' },
      },
    },
  },
  {
    name: 'chrono_ledger',
    description: 'Read the JSON execution ledger of chrono operations (snapshots, rewinds, forks, merges) for a surface. Read-only audit trail.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: Object.keys(CHRONO_REPOS) },
        n: { type: 'number', description: 'How many entries (default 20, max 100)' },
      },
    },
  },
];

const CHRONO_TOOL_NAMES = new Set(CHRONO_TOOLS.map((t) => t.name));

export function isChronoTool(name: string): boolean {
  return CHRONO_TOOL_NAMES.has(name);
}

export async function executeChronoTool(name: string, args: Record<string, unknown>): Promise<{ success: boolean; result?: any; error?: string }> {
  const repo = repoFor(args.surface);
  if (!repo) return { success: false, error: `Unknown surface: ${args.surface}. Valid: ${Object.keys(CHRONO_REPOS).join(', ')}` };
  if (!chronoToolsAvailable()) return { success: false, error: `chrono CLI missing at ${CHRONO_CLI}` };

  switch (name) {
    case 'chrono_snapshot':
      return run(repo, ['snapshot', ...(args.message ? ['-m', String(args.message)] : [])]);
    case 'chrono_log': {
      // Read-only git log, same shape as the frame's /log endpoint.
      const n = Math.min(Number(args.n) || 15, 60);
      return new Promise((done) => {
        execFile('git', ['log', `--max-count=${n}`, '--pretty=format:%h|%ad|%s', '--date=format:%H:%M:%S'], { cwd: repo, timeout: 15000 }, (err, stdout) => {
          if (err) return done({ success: false, error: String(err).slice(0, 300) });
          const commits = stdout.split('\n').filter(Boolean).map((l) => {
            const [sha, time, ...rest] = l.split('|');
            return { sha, time, subject: rest.join('|') };
          });
          done({ success: true, result: { ok: true, commits } });
        });
      });
    }
    case 'chrono_rewind':
      return run(repo, ['rewind', ...(args.to ? ['--to', String(args.to)] : []), ...(args.hard === true ? ['--hard'] : [])]);
    case 'chrono_fork': {
      const names = Array.isArray(args.names) ? args.names.map(String) : [];
      if (!names.length || names.some((n) => !NAME_RE.test(n))) {
        return { success: false, error: 'names must be 1+ strings of letters/digits/dash/underscore (max 40 chars)' };
      }
      return run(repo, ['fork', ...names]);
    }
    case 'chrono_forks':
      return run(repo, ['forks']);
    case 'chrono_diff':
      if (!NAME_RE.test(String(args.name || ''))) return { success: false, error: 'invalid fork name' };
      return run(repo, ['diff', String(args.name)]);
    case 'chrono_merge_winner':
      if (!NAME_RE.test(String(args.name || ''))) return { success: false, error: 'invalid fork name' };
      return run(repo, ['merge-winner', String(args.name)]);
    case 'chrono_prune':
      if (args.all === true) return run(repo, ['prune', '--all']);
      if (!NAME_RE.test(String(args.name || ''))) return { success: false, error: 'pass a fork name or all=true' };
      return run(repo, ['prune', String(args.name)]);
    case 'chrono_ledger':
      return run(repo, ['ledger', '-n', String(Math.min(Number(args.n) || 20, 100))]);
    default:
      return { success: false, error: `unknown chrono tool: ${name}` };
  }
}
