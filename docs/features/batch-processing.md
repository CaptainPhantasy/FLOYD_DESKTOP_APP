# Batch Processing Feature

**Status:** Planning
**Priority:** High
**Estimate:** 3-4 days
**Created:** 2026-02-04

---

## Overview

Implement parallel batch processing for multi-file operations, matching Claude Cowork's capability to process 10+ files simultaneously. Currently, Floyd Desktop Web processes files sequentially during tool execution.

**Reference:** Claude Cowork's Tasks update enables agents to process multiple files in parallel with auto-selection between parallel/sequential execution patterns.

---

## Problem Statement

### Current State Analysis

```typescript
// Current tool execution: Sequential only
// server/tool-executor.ts:235-283
private async searchFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const searchPath = args.path as string;
  const pattern = args.pattern as string;

  let files: string[] = [];
  if (pattern) {
    files = await glob(pattern, { nodir: true });
  } else {
    files = await glob(path.join(searchPath, '**/*'), { nodir: true });
  }

  // All files processed sequentially
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      // ... process file ...
    } catch {
      // Skip files that can't be read
    }
  }
}
```

### Current Limitations

| Operation | Current Behavior | Claude Cowork | Gap |
|-----------|-----------------|---------------|-----|
| **Multi-file search** | Sequential, one-by-one | Parallel batches | **10x slower** |
| **Code analysis** | Single file at a time | 10+ files at once | **10x slower** |
| **Refactoring** | Sequential tool calls | Parallel agents | **No coordination** |
| **Batch edits** | Manual iteration | Automatic batching | **Error-prone** |
| **Progress tracking** | Single progress bar | Per-file cards | **No visibility** |

### Real-World Scenarios

1. **"Analyze the entire codebase"** - Currently reads 100+ files one by one
2. **"Refactor all controllers"** - Currently processes each file manually
3. **"Find all TODO comments"** - Sequential search through entire project
4. **"Run tests on all modules"** - One test suite at a time
5. **"Apply fix to matching files"** - Manual file-by-file editing

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Batch Orchestrator                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Task         │  │ Worker Pool  │  │ Progress     │              │
│  │ Queue        │  │ (concurrent) │  │ Tracker      │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Execution Strategies                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Parallel     │  │ Sequential   │  │ Hybrid       │              │
│  │ (independent)│  │ (dependent)  │  │ (auto)       │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Result Aggregator                        │
│  • Collect results from workers                                   │
│  • Merge output by file/operation                                 │
│  • Handle errors gracefully                                       │
│  • Return unified response                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Batch Orchestrator (`server/batch-orchestrator.ts`)

```typescript
interface BatchTask<T> {
  id: string;
  operation: string;
  target: string;  // file path, directory, etc.
  args: T;
  priority?: number;
  dependencies?: string[];  // IDs of tasks this depends on
}

interface BatchResult<T> {
  taskId: string;
  success: boolean;
  result?: T;
  error?: string;
  duration: number;
}

interface BatchOptions {
  maxConcurrency?: number;
  strategy?: 'parallel' | 'sequential' | 'auto';
  continueOnError?: boolean;
  timeout?: number;
}

class BatchOrchestrator {
  private workers: number;
  private taskQueue: BatchTask<any>[];

  constructor(options?: BatchOptions) {
    this.workers = options?.maxConcurrency || os.cpus().length;
  }

  // Execute batch of tasks
  async executeBatch<T>(
    tasks: BatchTask<T>[],
    options?: BatchOptions
  ): Promise<BatchResult<T>[]> {
    // Determine execution strategy
    const strategy = options?.strategy || this.determineStrategy(tasks);

    switch (strategy) {
      case 'parallel':
        return this.executeParallel(tasks, options);
      case 'sequential':
        return this.executeSequential(tasks, options);
      case 'auto':
        return this.executeAuto(tasks, options);
    }
  }

  // Parallel execution for independent tasks
  private async executeParallel<T>(
    tasks: BatchTask<T>[],
    options?: BatchOptions
  ): Promise<BatchResult<T>[]> {
    const results: BatchResult<T>[] = [];
    const queue = [...tasks];
    const executing = new Set<string>();

    while (queue.length > 0 || executing.size > 0) {
      // Fill up to worker capacity
      while (executing.size < this.workers && queue.length > 0) {
        const task = queue.shift()!;
        executing.add(task.id);

        this.executeTask(task).then(result => {
          results.push(result);
          executing.delete(task.id);
        });
      }

      // Wait for at least one to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return results.sort((a, b) => a.taskId.localeCompare(b.taskId));
  }

  // Sequential execution for dependent tasks
  private async executeSequential<T>(
    tasks: BatchTask<T>[],
    options?: BatchOptions
  ): Promise<BatchResult<T>[]> {
    const results: BatchResult<T>[] = [];

    for (const task of tasks) {
      const result = await this.executeTask(task);
      results.push(result);

      if (!result.success && !options?.continueOnError) {
        break;
      }
    }

    return results;
  }

  // Auto strategy: Detect dependencies
  private executeAuto<T>(
    tasks: BatchTask<T>[],
    options?: BatchOptions
  ): Promise<BatchResult<T>[]> {
    // Separate into independent and dependent
    const independent = tasks.filter(t => !t.dependencies || t.dependencies.length === 0);
    const dependent = tasks.filter(t => t.dependencies && t.dependencies.length > 0);

    // Execute independent in parallel
    const independentResults = await this.executeParallel(independent, options);

    // Execute dependent sequentially (with topological sort)
    const dependentResults = await this.executeSequential(dependent, options);

    return [...independentResults, ...dependentResults];
  }
}
```

#### 2. Batch Tool Executor (`server/batch-tool-executor.ts`)

```typescript
class BatchToolExecutor {
  private orchestrator: BatchOrchestrator;
  private toolExecutor: ToolExecutor;

  // Batch file read
  async batchReadFiles(filePaths: string[]): Promise<BatchResult<string>[]> {
    const tasks = filePaths.map(path => ({
      id: `read:${path}`,
      operation: 'read_file',
      target: path,
      args: { path },
    }));

    return await this.orchestrator.executeBatch(tasks, {
      strategy: 'parallel',
      maxConcurrency: 10,
    });
  }

  // Batch file search
  async batchSearchFiles(
    searchPath: string,
    pattern: string,
    contentQuery?: string
  ): Promise<BatchResult<SearchResults>[]> {
    // First, find files
    const files = await glob(pattern, { cwd: searchPath, nodir: true });

    // Then search in parallel
    const tasks = files.map(file => ({
      id: `search:${file}`,
      operation: 'search_file',
      target: file,
      args: { path: file, content: contentQuery },
    }));

    return await this.orchestrator.executeBatch(tasks, {
      strategy: 'parallel',
      maxConcurrency: 20,
    });
  }

  // Batch code analysis
  async batchAnalyzeCode(filePaths: string[]): Promise<BatchResult<CodeAnalysis>[]> {
    const tasks = filePaths.map(path => ({
      id: `analyze:${path}`,
      operation: 'list_symbols',
      target: path,
      args: { filePath: path },
    }));

    return await this.orchestrator.executeBatch(tasks, {
      strategy: 'parallel',
      maxConcurrency: 15,
    });
  }

  // Batch TODO scan
  async batchFindTodos(paths: string[]): Promise<BatchResult<TodoResult>[]> {
    const tasks = paths.map(path => ({
      id: `todo:${path}`,
      operation: 'todo_sniper',
      target: path,
      args: {},
    }));

    return await this.orchestrator.executeBatch(tasks, {
      strategy: 'parallel',
      maxConcurrency: 15,
    });
  }

  // Batch edit with smart replacement
  async batchEdit(
    edits: FileEdit[],
    options?: BatchOptions
  ): Promise<BatchResult<EditResult>[]> {
    // Detect dependencies: files with same search term might conflict
    const tasks = edits.map((edit, idx) => ({
      id: `edit:${idx}`,
      operation: 'edit_block',
      target: edit.filePath,
      args: {
        path: edit.filePath,
        search: edit.search,
        replace: edit.replace,
      },
      // Add dependencies for edits to same file
      dependencies: edits
        .filter((e, i) => e.filePath === edit.filePath && i !== edits.indexOf(edit))
        .map((e, i) => `edit:${i}`),
    }));

    return await this.orchestrator.executeBatch(tasks, {
      strategy: 'auto',  // Auto-detect parallel vs sequential
      continueOnError: true,
    });
  }
}
```

#### 3. Batch Tool Definitions (`server/batch-tools.ts`)

```typescript
// New batch-aware tools to expose to AI
export const BATCH_TOOLS = [
  {
    name: 'batch_read_files',
    description: 'Read multiple files in parallel. More efficient than reading files one by one.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read',
        },
        maxConcurrency: {
          type: 'number',
          description: 'Maximum concurrent reads (default: 10)',
        },
      },
      required: ['paths'],
    },
  },

  {
    name: 'batch_search_files',
    description: 'Search for content across multiple files in parallel. Returns matching files with line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Base directory to search' },
        pattern: { type: 'string', description: 'Glob pattern for files' },
        content: { type: 'string', description: 'Text to search for within files' },
        maxResults: { type: 'number', description: 'Maximum results per file' },
      },
      required: ['path', 'pattern'],
    },
  },

  {
    name: 'batch_analyze_code',
    description: 'Analyze multiple code files in parallel. Returns symbols, functions, classes from all files.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of code file paths to analyze',
        },
      },
      required: ['paths'],
    },
  },

  {
    name: 'batch_edit',
    description: 'Apply the same edit to multiple files. Each file must contain the exact search string.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to edit',
        },
        search: { type: 'string', description: 'Exact text to find' },
        replace: { type: 'string', description: 'Replacement text' },
        dryRun: { type: 'boolean', description: 'Preview changes without applying' },
      },
      required: ['paths', 'search', 'replace'],
    },
  },

  {
    name: 'batch_find_replace',
    description: 'Find and replace different values in multiple files. Each file has its own search/replace pair.',
    inputSchema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              search: { type: 'string' },
              replace: { type: 'string' },
            },
          },
        },
        continueOnError: { type: 'boolean' },
      },
      required: ['edits'],
    },
  },

  {
    name: 'batch_run_command',
    description: 'Execute a command in multiple directories in parallel. Useful for running tests, builds, or scripts across modules.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        directories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of directory paths',
        },
      },
      required: ['command', 'directories'],
    },
  },

  {
    name: 'batch_list_symbols',
    description: 'List symbols (classes, functions) from multiple code files. Useful for understanding codebase structure.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to analyze',
        },
      },
      required: ['paths'],
    },
  },

  {
    name: 'batch_find_todos',
    description: 'Scan multiple files for TODO, FIXME, and HACK comments in parallel.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to scan',
        },
      },
      required: ['paths'],
    },
  },

  {
    name: 'batch_apply_fix',
    description: 'Apply a code fix pattern to multiple files. Each file is analyzed to determine if the fix applies.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to process',
        },
        fixPattern: {
          type: 'string',
          enum: ['add-import', 'add-error-handling', 'convert-to-async', 'add-jSDoc'],
          description: 'Type of fix to apply',
        },
      },
      required: ['paths', 'fixPattern'],
    },
  },
];
```

#### 4. Progress Tracker (`server/progress-tracker.ts`)

```typescript
interface TaskProgress {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  progress: number;  // 0-100
  result?: any;
  error?: string;
}

class ProgressTracker extends EventEmitter {
  private tasks: Map<string, TaskProgress> = new Map();

  // Register tasks for tracking
  registerTasks(tasks: BatchTask<any>[]): void {
    for (const task of tasks) {
      this.tasks.set(task.id, {
        taskId: task.id,
        status: 'pending',
        progress: 0,
      });
    }
    this.emit('registered', { count: tasks.length });
  }

  // Update task progress
  updateProgress(taskId: string, progress: number, result?: any): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.progress = progress;
      if (result) {
        task.result = result;
        task.status = 'completed';
      }
      this.emit('progress', { taskId, progress, task });
    }
  }

  // Mark task as failed
  markFailed(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.endTime = Date.now();
      this.emit('failed', { taskId, error, task });
    }
  }

  // Get overall progress
  getOverallProgress(): {
    total: number;
    completed: number;
    failed: number;
    running: number;
    percentage: number;
  } {
    const values = Array.from(this.tasks.values());
    const total = values.length;
    const completed = values.filter(t => t.status === 'completed').length;
    const failed = values.filter(t => t.status === 'failed').length;
    const running = values.filter(t => t.status === 'running').length;
    const percentage = total > 0 ? ((completed + failed) / total * 100) : 0;

    return { total, completed, failed, running, percentage };
  }
}
```

---

## Implementation Plan

### Phase 1: Core Orchestrator (Day 1)

**File: `server/batch-orchestrator.ts`** (NEW)

```typescript
export class BatchOrchestrator {
  private maxConcurrency: number;
  private timeout: number;

  constructor(options?: BatchOptions) {
    this.maxConcurrency = options?.maxConcurrency || 10;
    this.timeout = options?.timeout || 30000;
  }

  async executeBatch<T>(
    tasks: BatchTask<T>[],
    options?: BatchOptions
  ): Promise<BatchResult<T>[]> {
    // Validate tasks
    this.validateTasks(tasks);

    // Build dependency graph
    const graph = this.buildDependencyGraph(tasks);

    // Get execution order
    const orderedTasks = this.topologicalSort(graph);

    // Execute in waves (parallel within dependency level)
    return await this.executeInWaves(orderedTasks, options);
  }

  private async executeInWaves<T>(
    waves: BatchTask<T>[][],
    options?: BatchOptions
  ): Promise<BatchResult<T>[]> {
    const allResults: BatchResult<T>[] = [];

    for (const wave of waves) {
      // Execute all tasks in this wave in parallel
      const waveResults = await Promise.allSettled(
        wave.map(task => this.executeSingleTask(task, options))
      );

      // Process results
      for (const result of waveResults) {
        if (result.status === 'fulfilled') {
          allResults.push(result.value);
        } else {
          allResults.push({
            taskId: 'unknown',
            success: false,
            error: result.reason?.message || 'Unknown error',
            duration: 0,
          });
        }

        // Stop if error and not continuing
        if (result.status === 'rejected' && !options?.continueOnError) {
          break;
        }
      }
    }

    return allResults;
  }

  private async executeSingleTask<T>(
    task: BatchTask<T>,
    options?: BatchOptions
  ): Promise<BatchResult<T>> {
    const startTime = Date.now();

    try {
      // Add timeout wrapper
      const result = await Promise.race([
        this.executeTaskOperation(task),
        this.createTimeout(options?.timeout || this.timeout),
      ]);

      return {
        taskId: task.id,
        success: true,
        result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        taskId: task.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private buildDependencyGraph(tasks: BatchTask<any>[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const task of tasks) {
      graph.set(task.id, task.dependencies || []);
    }

    return graph;
  }

  private topologicalSort(graph: Map<string, string[]>): BatchTask<any>[][] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (node: string) => {
      if (visited.has(node)) return;
      if (visiting.has(node)) {
        throw new Error(`Circular dependency detected involving ${node}`);
      }

      visiting.add(node);
      const deps = graph.get(node) || [];
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(node);
      visited.add(node);
      sorted.push(node);
    };

    for (const node of graph.keys()) {
      visit(node);
    }

    // Convert sorted IDs to waves (tasks without dependencies in same wave)
    const waves: BatchTask<any>[][] = [];
    const taskMap = new Map<string, BatchTask<any>>();

    for (const task of tasks) {
      taskMap.set(task.id, task);
    }

    const processed = new Set<string>();
    let currentWave: BatchTask<any>[] = [];

    for (const taskId of sorted) {
      const task = taskMap.get(taskId);
      if (!task) continue;

      const deps = task.dependencies || [];
      if (deps.every(d => processed.has(d))) {
        currentWave.push(task);
        processed.add(taskId);
      }

      if (currentWave.length >= this.maxConcurrency || taskId === sorted[sorted.length - 1]) {
        waves.push(currentWave);
        currentWave = [];
      }
    }

    if (currentWave.length > 0) {
      waves.push(currentWave);
    }

    return waves;
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    );
  }
}
```

**Tasks:**
1. Create `BatchOrchestrator` class
2. Implement dependency graph building
3. Add topological sorting
4. Implement wave-based parallel execution
5. Add timeout handling

**Success Criteria:**
- Can execute independent tasks in parallel
- Respects task dependencies
- Handles timeouts gracefully
- Reports progress correctly

---

### Phase 2: Batch Tool Executor (Day 1-2)

**File: `server/batch-tool-executor.ts`** (NEW)

```typescript
export class BatchToolExecutor {
  constructor(
    private orchestrator: BatchOrchestrator,
    private toolExecutor: ToolExecutor,
    private progressTracker: ProgressTracker
  ) {}

  // Register batch tools with the system
  registerBatchTools(): void {
    // These are exposed to the AI as callable tools
    // The AI can call them to perform batch operations
  }

  // Execute batch_read_files tool
  async batchReadFiles(filePaths: string[]): Promise<BatchResult<FileContent>[]> {
    const tasks = filePaths.map(path => ({
      id: `read:${path}`,
      operation: 'read_file',
      target: path,
      args: { path },
      priority: 1,
    }));

    this.progressTracker.registerTasks(tasks);

    const results = await this.orchestrator.executeBatch(tasks, {
      maxConcurrency: 10,
      strategy: 'parallel',
    });

    return results.map(r => ({
      ...r,
      result: r.success ? { filePath: r.taskId.split(':')[1], content: r.result } : undefined,
    }));
  }

  // Execute batch_search_files tool
  async batchSearchFiles(
    searchPath: string,
    pattern: string,
    contentQuery?: string
  ): Promise<BatchResult<SearchResults>> {
    // First, get matching files
    const files = await glob(pattern, { cwd: searchPath, nodir: true });

    // Then search content in parallel
    const tasks = files.map(file => ({
      id: `search:${file}`,
      operation: 'search_files',
      target: file,
      args: {
        path: searchPath,
        pattern: path.basename(file),
        content: contentQuery,
      },
      priority: 1,
    }));

    this.progressTracker.registerTasks(tasks);

    const results = await this.orchestrator.executeBatch(tasks, {
      maxConcurrency: 20,
      strategy: 'parallel',
    });

    const matches: SearchResult[] = [];
    for (const result of results) {
      if (result.success && result.result?.matches) {
        matches.push(...result.result.matches);
      }
    }

    return {
      taskId: 'batch-search',
      success: true,
      result: { matches },
      duration: 0,
    };
  }

  // Execute batch_analyze_code tool
  async batchAnalyzeCode(filePaths: string[]): Promise<BatchResult<CodeAnalysis>> {
    const tasks = filePaths.map(path => ({
      id: `analyze:${path}`,
      operation: 'list_symbols',
      target: path,
      args: { filePath: path },
      priority: 1,
    }));

    this.progressTracker.registerTasks(tasks);

    const results = await this.orchestrator.executeBatch(tasks, {
      maxConcurrency: 15,
      strategy: 'parallel',
    });

    const analysis: CodeAnalysis = {
      files: {},
      totalSymbols: 0,
    };

    for (const result of results) {
      if (result.success) {
        const filePath = result.taskId.split(':')[1];
        analysis.files[filePath] = result.result;
        analysis.totalSymbols += (result.result as Symbol[]).length;
      }
    }

    return {
      taskId: 'batch-analyze',
      success: true,
      result: analysis,
      duration: 0,
    };
  }

  // Execute batch_edit tool
  async batchEdit(
    filePaths: string[],
    search: string,
    replace: string,
    dryRun?: boolean
  ): Promise<BatchResult<EditResult>> {
    const tasks = filePaths.map((path, idx) => ({
      id: `edit:${idx}:${path}`,
      operation: 'edit_block',
      target: path,
      args: {
        path,
        search,
        replace,
        dryRun: dryRun || false,
      },
      priority: 1,
    }));

    this.progressTracker.registerTasks(tasks);

    const results = await this.orchestrator.executeBatch(tasks, {
      maxConcurrency: 5,
      strategy: 'parallel',
      continueOnError: true,
    });

    const summary: EditResult = {
      edited: [],
      failed: [],
      dryRun: dryRun || false,
    };

    for (const result of results) {
      const filePath = result.taskId.split(':').slice(1).join(':');
      if (result.success) {
        summary.edited.push(filePath);
      } else {
        summary.failed.push({
          file: filePath,
          error: result.error,
        });
      }
    }

    return {
      taskId: 'batch-edit',
      success: summary.failed.length === 0,
      result: summary,
      duration: 0,
    };
  }
}
```

**Tasks:**
1. Create `BatchToolExecutor` class
2. Implement batch_read_files
3. Implement batch_search_files
4. Implement batch_analyze_code
5. Implement batch_edit

**Success Criteria:**
- Batch operations work correctly
- Parallel execution achieves speedup
- Errors handled gracefully
- Progress tracked throughout

---

### Phase 3: Tool Integration (Day 2)

**File: `server/mcp-client.ts`** (MODIFY)

Add batch tools to BUILTIN_TOOLS:

```typescript
export const BUILTIN_TOOLS = [
  // ... existing tools ...

  // === BATCH PROCESSING TOOLS ===
  {
    name: 'batch_read_files',
    description: 'Read multiple files in parallel. More efficient than reading files one by one. Use this when you need to examine the contents of multiple files.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read',
        },
        maxConcurrency: {
          type: 'number',
          description: 'Maximum concurrent reads (default: 10)',
        },
      },
      required: ['paths'],
    },
  },

  {
    name: 'batch_search_files',
    description: 'Search for content across multiple files in parallel. Returns all matching files with line numbers and context. Much faster than searching files sequentially.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Base directory to search' },
        pattern: { type: 'string', description: 'Glob pattern for files' },
        content: { type: 'string', description: 'Text to search for within files' },
        maxResults: { type: 'number', description: 'Maximum results per file (default: 50)' },
      },
      required: ['path', 'pattern'],
    },
  },

  {
    name: 'batch_analyze_code',
    description: 'Analyze multiple code files in parallel. Extract classes, functions, interfaces from all files at once. Ideal for understanding codebase structure.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of code file paths to analyze',
        },
      },
      required: ['paths'],
    },
  },

  {
    name: 'batch_edit',
    description: 'Apply the same edit to multiple files. Each file must contain the exact search string. Edits are applied in parallel with dependency detection.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to edit',
        },
        search: { type: 'string', description: 'Exact text to find' },
        replace: { type: 'string', description: 'Replacement text' },
        dryRun: { type: 'boolean', description: 'Preview changes without applying' },
      },
      required: ['paths', 'search', 'replace'],
    },
  },

  {
    name: 'batch_find_todos',
    description: 'Scan multiple files for TODO, FIXME, and HACK comments in parallel. Returns organized results by file and type.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to scan',
        },
      },
      required: ['paths'],
    },
  },
  // ... rest of existing tools ...
] as const;
```

**File: `server/tool-executor.ts`** (MODIFY)

Add batch tool execution cases:

```typescript
async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (toolName) {
      // ... existing cases ...

      // === BATCH PROCESSING ===
      case 'batch_read_files':
        return await this.batchReadFiles(args);
      case 'batch_search_files':
        return await this.batchSearchFiles(args);
      case 'batch_analyze_code':
        return await this.batchAnalyzeCode(args);
      case 'batch_edit':
        return await this.batchEdit(args);
      case 'batch_find_todos':
        return await this.batchFindTodos(args);

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Batch operation implementations
private async batchReadFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const paths = args.paths as string[];
  const executor = this.batchToolExecutor; // Injected dependency

  const results = await executor.batchReadFiles(paths);

  return {
    success: true,
    result: {
      files: results.filter(r => r.success).map(r => r.result),
      failed: results.filter(r => !r.success).map(r => ({
        file: r.taskId,
        error: r.error,
      })),
    },
  };
}

private async batchSearchFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const searchPath = args.path as string;
  const pattern = args.pattern as string;
  const content = args.content as string;

  // First, find files
  const files = await glob(path.join(searchPath, pattern), { nodir: true });

  // Then read them in parallel to search content
  const readResults = await this.batchReadFiles({ paths: files });

  if (!readResults.success) {
    return readResults;
  }

  // Search in content
  const matches: SearchResult[] = [];
  for (const fileResult of readResults.result.files) {
    const lines = fileResult.content.split('\n');
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(content.toLowerCase())) {
        matches.push({
          file: fileResult.filePath,
          line: i + 1,
          content: line.trim(),
        });
      }
    });
  }

  return {
    success: true,
    result: { matches: matches.slice(0, 1000) }, // Limit results
  };
}
```

**Tasks:**
1. Add batch tools to BUILTIN_TOOLS
2. Implement batch tool execution in ToolExecutor
3. Wire up BatchToolExecutor dependency
4. Test batch operations

**Success Criteria:**
- AI can call batch tools
- Tools execute in parallel
- Results aggregated correctly

---

### Phase 4: WebSocket Progress Updates (Day 2-3)

**File: `server/ws-progress-server.ts`** (NEW)

```typescript
export class ProgressWebSocketServer {
  private wss: WebSocketServer;

  broadcastProgress(progress: ProgressUpdate): void {
    const message = JSON.stringify({
      type: 'batch_progress',
      data: progress,
    });

    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

interface ProgressUpdate {
  batchId: string;
  overall: {
    total: number;
    completed: number;
    failed: number;
    percentage: number;
  };
  tasks: Array<{
    taskId: string;
    status: string;
    progress: number;
    result?: any;
  }>;
}
```

**File: `server/index.ts`** (MODIFY)

Integrate progress broadcasting:

```typescript
// Broadcast batch progress
progressTracker.on('progress', (update) => {
  wsProgressServer.broadcastProgress({
    batchId: currentBatchId,
    overall: progressTracker.getOverallProgress(),
    tasks: Array.from(progressTracker.tasks.values()),
  });
});
```

**Tasks:**
1. Create progress WebSocket server
2. Emit progress events during execution
3. Broadcast to connected clients
4. Handle client reconnection

**Success Criteria:**
- Progress updates sent in real-time
- UI shows live progress
- Reconnection works

---

### Phase 5: Frontend UI (Day 3)

**File: `src/components/BatchProgressPanel.tsx`** (NEW)

```typescript
export function BatchProgressPanel() {
  const [batches, setBatches] = useState<BatchProgress[]>([]);
  const ws = useWebSocket('ws://localhost:3006');

  useEffect(() => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'batch_progress') {
        updateBatchProgress(data.data);
      }
    };
  }, [ws]);

  return (
    <div className="batch-progress-panel">
      {batches.map(batch => (
        <BatchCard key={batch.id} batch={batch} />
      ))}
    </div>
  );
}

function BatchCard({ batch }: { batch: BatchProgress }) {
  const { overall, tasks } = batch;

  return (
    <div className="batch-card">
      <div className="batch-header">
        <h3>{batch.name}</h3>
        <span className={getStatusClass(overall.percentage)}>
          {overall.percentage.toFixed(0)}% complete
        </span>
      </div>

      <ProgressBar value={overall.percentage} />

      <div className="batch-tasks">
        {tasks.map(task => (
          <TaskRow key={task.taskId} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskProgress }) {
  return (
    <div className={`task-row status-${task.status}`}>
      <span className="task-name">{task.taskId}</span>
      <ProgressBar value={task.progress} />
      <TaskStatus status={task.status} />
    </div>
  );
}
```

**File: `src/components/ChatMessage.tsx`** (MODIFY)

Add batch result display:

```typescript
// In message content rendering
if (isBatchResult(message.content)) {
  return <BatchResultDisplay content={message.content} />;
}

function isBatchResult(content: string): boolean {
  return content.includes('**Batch Results**') ||
         content.includes('│ File │ Status │');
}

function BatchResultDisplay({ content }: { content: string }) {
  const lines = content.split('\n');
  const tableStart = lines.findIndex(l => l.includes('│'));

  if (tableStart >= 0) {
    // Parse table format
    return (
      <Table className="batch-results">
        <tbody>
          {lines.slice(tableStart + 2).map((line, idx) => {
            const cells = line.split('│').map(c => c.trim()).filter(Boolean);
            return (
              <tr key={idx}>
                {cells.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  }
}
```

**Tasks:**
1. Create BatchProgressPanel component
2. Create BatchCard component
3. Add progress indicators
4. Add batch result display

**Success Criteria:**
- Progress updates visible in real-time
- User can see which tasks completed/failed
- Results displayed clearly

---

### Phase 6: Smart Batching (Day 3-4)

**File: `server/smart-batcher.ts`** (NEW)

```typescript
class SmartBatcher {
  // Automatically batch operations when appropriate
  shouldBatch(tasks: ToolCall[]): boolean {
    // Batch if:
    // 1. More than 5 similar operations
    // 2. All independent (no shared resources)
    // 3. All same operation type
    if (tasks.length < 5) return false;

    const operations = tasks.map(t => t.name);
    const uniqueOps = new Set(operations);

    if (uniqueOps.size !== 1) return false;

    // Check for conflicts
    const paths = tasks.map(t => t.args?.path);
    const uniquePaths = new Set(paths);

    return uniquePaths.size === tasks.length; // All different files
  }

  // Convert sequential tool calls to batch
  convertToBatch(calls: ToolCall[]): ToolCall {
    const operation = calls[0].name;

    switch (operation) {
      case 'read_file':
        return {
          name: 'batch_read_files',
          args: {
            paths: calls.map(c => c.args.path),
          },
        };

      case 'search_files':
        return {
          name: 'batch_search_files',
          args: {
            path: calls[0].args.path,
            pattern: calls[0].args.pattern,
            content: calls[0].args.content,
          },
        };

      case 'list_symbols':
        return {
          name: 'batch_analyze_code',
          args: {
            paths: calls.map(c => c.args.filePath),
          },
        };

      default:
        return null;
    }
  }

  // Detect batch opportunities in conversation
  detectBatchOpportunities(message: string): BatchSuggestion | null {
    // Look for patterns like:
    // - "analyze all files in src/"
    // - "search for X in every file"
    // - "apply this fix to all controllers"

    const analyzeAll = message.match(/(?:analyze|examine|check|scan)\s+(?:all )?(?:files? )?(?:in )?["']?(.+?)["']?/i);
    if (analyzeAll) {
      return {
        type: 'analyze',
        target: analyzeAll[1],
        operation: 'batch_analyze_code',
      };
    }

    const searchAll = message.match(/(?:search|find|look for)\s+(.+)?\s+(?:in |across |through )?(?:all )?(?:files? )?(?:in )?["']?(.+?)["']?/i);
    if (searchAll) {
      return {
        type: 'search',
        target: searchAll[1],
        query: searchAll[2],
      };
    }

    return null;
  }
}

interface BatchSuggestion {
  type: 'analyze' | 'search' | 'edit';
  target: string;
  operation: string;
  query?: string;
}
```

**Tasks:**
1. Create `SmartBatcher` class
2. Implement pattern detection
3. Add batch conversion logic
4. Integrate with chat endpoint

**Success Criteria:**
- Automatically suggests batch operations
- Converts sequential calls to batch
- User can accept/decline suggestions

---

### Phase 7: Browork Integration (Day 4)

**File: `server/browork-manager.ts`** (MODIFY)

Add batch capability to sub-agents:

```typescript
export class BroworkManager {
  // Allow agents to use batch tools
  private async runAgent(task: AgentTask): Promise<void> {
    const tools = BUILTIN_TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    // Add batch tools to agent's available tools
    const allTools = [
      ...tools,
      ...this.getBatchTools(),
    ];

    // Agent now has access to batch operations
  }

  private getBatchTools(): Tool[] {
    return [
      {
        name: 'batch_analyze_code',
        description: 'Analyze multiple code files in parallel',
        input_schema: {
          type: 'object',
          properties: {
            paths: { type: 'array', items: { type: 'string' } },
          },
          required: ['paths'],
        },
      },
      // ... other batch tools
    ];
  }
}
```

**Tasks:**
1. Add batch tools to agent toolset
2. Update agent system prompt to use batch tools
3. Track batch operation results
4. Report batch progress in Browork UI

**Success Criteria:**
- Agents can use batch operations
- Parallel execution in sub-agents
- Progress visible in Browork panel

---

## Configuration Options

### Settings (`.floyd-data/settings.json`)

```json
{
  "batching": {
    "enabled": true,
    "maxConcurrency": 10,
    "autoDetect": true,
    "suggestBatches": true,
    "timeout": 30000,
    "strategies": {
      "read": "parallel",
      "search": "parallel",
      "edit": "sequential",
      "analyze": "parallel"
    }
  }
}
```

### Environment Variables

```bash
# Batch processing settings
FLOYD_BATCH_ENABLED=true
FLOYD_MAX_CONCURRENCY=10
FLOYD_BATCH_TIMEOUT=30000
FLOYD_AUTO_BATCH_DETECT=true
```

---

## File Changes Summary

### New Files
| File | Purpose | LOC (est) |
|------|---------|-----------|
| `server/batch-orchestrator.ts` | Core orchestration logic | ~300 |
| `server/batch-tool-executor.ts` | Batch tool implementations | ~250 |
| `server/progress-tracker.ts` | Progress tracking | ~150 |
| `server/ws-progress-server.ts` | WebSocket progress | ~120 |
| `server/smart-batcher.ts` | Auto-detection | ~200 |
| `src/components/BatchProgressPanel.tsx` | UI for batch progress | ~180 |
| `src/components/BatchCard.tsx` | Individual batch display | ~120 |

### Modified Files
| File | Changes | Lines |
|------|---------|-------|
| `server/mcp-client.ts` | Add batch tools | +200 |
| `server/tool-executor.ts` | Add batch execution | +150 |
| `server/browork-manager.ts` | Agent batch integration | +50 |
| `src/components/ChatMessage.tsx` | Batch result display | +80 |

**Total:** ~1,680 lines of new/modified code

---

## Testing Strategy

### Unit Tests

```typescript
describe('BatchOrchestrator', () => {
  it('should execute independent tasks in parallel', async () => {
    const tasks = [
      { id: '1', operation: 'read', target: 'file1.txt', args: {} },
      { id: '2', operation: 'read', target: 'file2.txt', args: {} },
      { id: '3', operation: 'read', target: 'file3.txt', args: {} },
    ];

    const results = await orchestrator.executeParallel(tasks);

    expect(results).toHaveLength(3);
    expect(results.filter(r => r.success)).toHaveLength(3);

    // Verify parallel execution (should be faster than sequential)
    const duration = Math.max(...results.map(r => r.duration));
    expect(duration).toBeLessThan(1000); // Should complete quickly
  });

  it('should respect task dependencies', async () => {
    const tasks = [
      { id: '1', operation: 'edit', target: 'file1.txt', args: {}, dependencies: [] },
      { id: '2', operation: 'edit', target: 'file1.txt', args: {}, dependencies: ['1'] },
      { id: '3', operation: 'edit', target: 'file1.txt', args: {}, dependencies: ['2'] },
    ];

    const results = await orchestrator.executeBatch(tasks);

    // Verify execution order
    expect(results[0].endTime).toBeLessThanOrEqual(results[1].startTime);
    expect(results[1].endTime).toBeLessThanOrEqual(results[2].startTime);
  });
});
```

### Integration Tests

```typescript
describe('Batch Operations Integration', () => {
  it('should batch read 100 files efficiently', async () => {
    const files = createTestFiles(100);

    const start = Date.now();
    const results = await batchToolExecutor.batchReadFiles(files);
    const duration = Date.now() - start;

    expect(results.filter(r => r.success).toHaveLength(100);
    expect(duration).toBeLessThan(5000); // Should be fast
  });

  it('should search entire codebase for TODOs', async () => {
    const project = createTestProject();

    const todos = await batchToolExecutor.batchFindTodos(
      project.files.map(f => f.path)
    );

    expect(todos.length).toBeGreaterThan(0);
    expect(todos.every(t => t.type === 'todo' || t.type === 'fixme'));
  });
});
```

---

## Performance Considerations

### Resource Management

```typescript
class ResourceManager {
  private maxMemory = 500 * 1024 * 1024; // 500MB
  private maxOpenFiles = 1000;

  canExecuteBatch(taskCount: number, estimatedMemoryPerTask: number): boolean {
    const estimatedMemory = taskCount * estimatedMemoryPerTask;
    return estimatedMemory < this.maxMemory;
  }

  async getSystemStatus(): Promise<SystemStatus> {
    return {
      availableMemory: await this.getAvailableMemory(),
      openFiles: await this.getOpenFileCount(),
      cpuUsage: await this.getCPUUsage(),
    };
  }
}
```

### Adaptive Concurrency

```typescript
class AdaptiveBatcher {
  private baseConcurrency = 10;
  private maxConcurrency = 50;

  getOptimalConcurrency(): number {
    // Adjust based on system state
    const status = await resourceManager.getSystemStatus();

    if (status.availableMemory < 100 * 1024 * 1024) {
      return 5; // Low memory, reduce concurrency
    }

    if (status.cpuUsage < 50) {
      return this.maxConcurrency; // CPU available, max out
    }

    return this.baseConcurrency; // Default
  }
}
```

---

## Monitoring & Metrics

### Key Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Speedup factor | 8-10x | Parallel vs sequential time |
| Memory efficiency | <500MB | Peak memory usage |
| Error rate | <5% | Failed batch operations |
| Auto-detection rate | >70% | Sequential converted to batch |

### Dashboard Display

```
Batch Processing Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current Batches: 2 running
├─ [1] Code Analysis (45/50 files, 90%)
└─ [2] TODO Scan (120/200 files, 60%)

Performance:
  • Average Speedup: 8.2x
  • Memory Usage: 234 MB / 500 MB
  • CPU Usage: 45%

Recent Batches:
   ✓ batch_edit: 15 files (2.3s) - saved 18s
  ✓ batch_analyze: 50 files (8.1s) - saved 62s
  ✓ batch_search: 200 files (5.7s) - saved 41s
```

---

## Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Multi-file analysis | Sequential | Parallel | **8-10x faster** |
| Codebase search | One-by-one | Parallel | **10x faster** |
| Bulk edits | Manual | Automatic | **Error-free** |
| Progress visibility | None | Real-time | **Full visibility** |
| Auto-detection | N/A | Smart | **70%+ detection** |

---

## Rollout Plan

### Phase 1: Manual Batching (Alpha)
- Users explicitly call batch_* tools
- 10 concurrent operations max
- No auto-detection

### Phase 2: Smart Suggestions (Beta)
- AI suggests batch operations
- Users accept/decline
- Auto-detection enabled

### Phase 3: Full Automation (GA)
- Sequential calls auto-converted
- Adaptive concurrency
- Full Browork integration

---

## References

- [Claude Cowork Batch Processing](https://learn-prompting.fr/fr/blog/claude-code-sub-agents)
- [Tasks Update Announcement](https://venturebeat.com/orchestration/claude-codes-tasks-update-lets-agents-work-longer-and-coordinate-across)
- Current sequential execution: `server/tool-executor.ts:235-283`

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-04 | Initial planning document | Floyd |
