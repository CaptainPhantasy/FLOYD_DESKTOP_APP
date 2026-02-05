# Document Size Acceptance

**Status:** Planning
**Priority:** High
**Estimate:** 2-3 days
**Created:** 2026-02-04

---

## Overview

Implement support for larger document files in project context, removing the current 100KB per-file limit. This enables analysis of large documentation, logs, datasets, and codebases that exceed current restrictions.

**Reference:** Claude Desktop handles documents up to 1MB+ with intelligent chunking and streaming.

---

## Problem Statement

### Current State Analysis

```typescript
// server/projects-manager.ts:33-34
private maxFileSize = 100 * 1024;  // 100KB max per file
private maxTotalSize = 500 * 1024;  // 500KB total context
```

| Document Type | Current Limit | Typical Size | Can Include? |
|---------------|---------------|--------------|--------------|
| **README.md** | 100 KB | 10-50 KB | ✅ Yes |
| **CHANGELOG.md** | 100 KB | 50-200 KB | ❌ No |
| **API Docs** | 100 KB | 200-500 KB | ❌ No |
| **Large logs** | 100 KB | 1-10 MB | ❌ No |
| **Datasets** | 100 KB | 500 KB+ | ❌ No |
| **Code coverage** | 100 KB | 200 KB+ | ❌ No |
| **Package files** | 100 KB | Sometimes | ⚠️ Maybe |

### Real-World Scenarios Currently Blocked

1. **Large README files** - Many projects have comprehensive documentation >100KB
2. **Package-lock.json** - Dependency trees often exceed 100KB
3. **Generated code** - Swagger/OpenAPI specs, protocol buffers
4. **Test fixtures** - Large test data files
5. **Log files** - Application logs, crash dumps
6. **Documentation exports** - Confluence, Notion exports

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Large Document Handler                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Size         │  │ Type         │  │ Content      │              │
│  │ Detector     │  │ Classifier   │  │ Sampler     │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Processing Strategy                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Chunk        │  │ Stream       │  │ Summarize    │              │
│  │ (semantic)   │  │ (sequential) │  │ (AI-powered) │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Context Injection                          │
│  • Full file (if small enough)                                  │
│  • Relevant chunks (if large, query-based)                      │
│  • Summary + sections (if documentation)                         │
│  • Metadata only (if very large)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Large Document Handler (`server/large-document-handler.ts`)

```typescript
interface DocumentHandle {
  id: string;
  filePath: string;
  size: number;
  type: DocumentType;
  strategy: HandlingStrategy;
  metadata: DocumentMetadata;
}

enum DocumentType {
  CODE = 'code',
  MARKDOWN = 'markdown',
  JSON = 'json',
  LOG = 'log',
  BINARY = 'binary',
  TEXT = 'text',
}

enum HandlingStrategy {
  FULL = 'full',              // Include entire file
  CHUNK = 'chunk',            // Semantic chunks
  STREAM = 'stream',          // Stream on demand
  SUMMARY = 'summary',        // AI summary
  METADATA = 'metadata',     // File info only
}

interface DocumentMetadata {
  lineCount: number;
  language?: string;
  sections?: Section[];
  headers?: string[];
  dependencies?: string[];
  summary?: string;
}

class LargeDocumentHandler {
  // Determine how to handle a document
  async analyze(filePath: string): Promise<DocumentHandle>;

  // Get content based on strategy
  async getContent(
    handle: DocumentHandle,
    options: ContentOptions
  ): Promise<string>;

  // Get relevant section
  async getSection(
    handle: DocumentHandle,
    sectionName: string
  ): Promise<string>;

  // Search within document
  async search(
    handle: DocumentHandle,
    query: string
  ): Promise<SearchResult[]>;
}
```

#### 2. Semantic Chunker (`server/semantic-chunker.ts`)

```typescript
interface Chunk {
  id: string;
  documentId: string;
  type: ChunkType;
  content: string;
  metadata: ChunkMetadata;
}

enum ChunkType {
  FUNCTION = 'function',
  CLASS = 'class',
  SECTION = 'section',
  LOG_ENTRY = 'log_entry',
  JSON_OBJECT = 'json_object',
  PARAGRAPH = 'paragraph',
}

interface ChunkMetadata {
  startLine: number;
  endLine: number;
  name?: string;
  signature?: string;
  headers?: string[];
  tokens: number;
}

class SemanticChunker {
  // Chunk document by its structure
  chunk(handle: DocumentHandle): Chunk[];

  // Get relevant chunks for query
  getRelevantChunks(
    chunks: Chunk[],
    query: string,
    maxChunks: number
  ): Chunk[];

  // Create chunk index for fast lookup
  indexChunks(chunks: Chunk[]): ChunkIndex;
}
```

#### 3. Document Summarizer (`server/document-summarizer.ts`)

```typescript
interface DocumentSummary {
  documentId: string;
  overview: string;
  sections: SectionSummary[];
  keyPoints: string[];
  metadata: DocumentMetadata;
  fullSummary?: string;  // For very large docs
}

class DocumentSummarizer {
  // Generate summary for large document
  async summarize(
    handle: DocumentHandle,
    detail: 'brief' | 'standard' | 'detailed'
  ): Promise<DocumentSummary>;

  // Summarize specific section
  async summarizeSection(
    handle: DocumentHandle,
    sectionName: string
  ): Promise<string>;

  // Update incremental summary (for changing docs)
  async updateSummary(
    summary: DocumentSummary,
    changes: DocumentChanges
  ): Promise<DocumentSummary>;
}
```

---

## Implementation Plan

### Phase 1: Remove Hard Limits (Day 1)

**File: `server/projects-manager.ts`** (MODIFY)

```typescript
export class ProjectsManager {
  // OLD: Hard limits
  // private maxFileSize = 100 * 1024;
  // private maxTotalSize = 500 * 1024;

  // NEW: Configurable with smart defaults
  private maxFileSize: number;
  private maxTotalSize: number;
  private largeDocumentHandler: LargeDocumentHandler;

  constructor(dataDir: string, options?: ProjectManagerOptions) {
    // ... existing code ...

    this.maxFileSize = options?.maxFileSize || 10 * 1024 * 1024; // 10MB default
    this.maxTotalSize = options?.maxTotalSize || 50 * 1024 * 1024; // 50MB default
    this.largeDocumentHandler = new LargeDocumentHandler();
  }

  async addFile(projectId: string, filePath: string): Promise<ProjectFile | null> {
    const project = this.projects.get(projectId);
    if (!project) return null;

    // Check if already added
    if (project.files.some(f => f.path === filePath)) {
      return null;
    }

    try {
      const stats = await fs.stat(filePath);

      // NEW: Handle large files differently
      if (stats.size > this.maxFileSize) {
        console.log(`[Projects] File exceeds size limit: ${filePath} (${stats.size} bytes)`);

        // Create document handle
        const handle = await this.largeDocumentHandler.analyze(filePath);

        // Store as large file reference
        const file: ProjectFile = {
          path: filePath,
          name: path.basename(filePath),
          content: `[LARGE FILE] Type: ${handle.type}, Size: ${formatBytes(stats.size)}`,
          size: stats.size,
          type: 'large',
          lastModified: stats.mtimeMs,
          metadata: {
            documentId: handle.id,
            strategy: handle.strategy,
            handle: handle,
          },
        };

        project.files.push(file);
        project.updated = Date.now();
        await this.save();
        return file;
      }

      // Original logic for normal files
      const content = await fs.readFile(filePath, 'utf-8');
      // ... rest of existing code ...
    }
  }
}
```

**Tasks:**
1. Remove hard-coded 100KB limit
2. Add configurable size limits (default 10MB)
3. Create `LargeDocumentHandler` stub
4. Store metadata for large files

**Success Criteria:**
- Files >100KB can be added to projects
- No crashes on large files
- Metadata stored correctly

---

### Phase 2: Semantic Chunking for Code (Day 1-2)

**File: `server/semantic-chunker.ts`** (NEW)

```typescript
export class SemanticChunker {
  // Chunk code files by function/class boundaries
  chunkCodeFile(filePath: string): Chunk[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    let currentChunk: string[] = [];
    let chunkStart = 0;
    let braceDepth = 0;
    let inFunction = false;
    let currentFunction: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect function/class definition
      const fnMatch = trimmed.match(/^(?:async\s+)?function\s+(\w+)/);
      const classMatch = trimmed.match(/^class\s+(\w+)/);
      const methodMatch = trimmed.match(/(\w+)\s*\([^)]*\)\s*{/);
      const arrowMatch = trimmed.match(/(\w+)\s*=\s*(?:async\s+)?\(?\s*\w+/);

      if (fnMatch || classMatch || methodMatch || arrowMatch) {
        // Save previous chunk if any
        if (currentChunk.length > 0) {
          chunks.push(this.createChunk(
            filePath,
            chunkStart,
            i - 1,
            currentChunk.join('\n'),
            currentFunction
          ));
        }

        // Start new chunk
        currentFunction = fnMatch?.[1] || classMatch?.[1] || methodMatch?.[1] || arrowMatch?.[1] || null;
        currentChunk = [line];
        chunkStart = i;
        braceDepth = (line.match(/{/g) || []).length;
        inFunction = true;
      } else if (inFunction) {
        currentChunk.push(line);
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;

        // End of function/class
        if (braceDepth === 0 && trimmed === '}') {
          chunks.push(this.createChunk(
            filePath,
            chunkStart,
            i,
            currentChunk.join('\n'),
            currentFunction
          ));
          currentChunk = [];
          currentFunction = null;
          inFunction = false;
        }
      } else {
        currentChunk.push(line);
      }
    }

    // Add remaining content
    if (currentChunk.length > 0) {
      chunks.push(this.createChunk(
        filePath,
        chunkStart,
        lines.length - 1,
        currentChunk.join('\n'),
        currentFunction || 'module'
      ));
    }

    return chunks;
  }

  private createChunk(
    filePath: string,
    startLine: number,
    endLine: number,
    content: string,
    name?: string
  ): Chunk {
    return {
      id: `${filePath}:${startLine}-${endLine}`,
      documentId: filePath,
      type: name ? ChunkType.FUNCTION : ChunkType.SECTION,
      content,
      metadata: {
        startLine,
        endLine,
        name,
        tokens: this.estimateTokens(content),
      },
    };
  }

  // Get chunks relevant to a query
  getRelevantChunks(
    chunks: Chunk[],
    query: string,
    maxChunks: number = 5
  ): Chunk[] {
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(w => w.length > 3);

    const scored = chunks.map(chunk => {
      let score = 0;
      const contentLower = chunk.content.toLowerCase();

      // Keyword matching
      for (const keyword of keywords) {
        if (contentLower.includes(keyword)) {
          score += 1;
        }
      }

      // Boost if keyword in function name
      if (chunk.metadata.name) {
        const nameLower = chunk.metadata.name.toLowerCase();
        if (keywords.some(k => nameLower.includes(k))) {
          score += 3;
        }
      }

      // Boost imports/exports
      if (chunk.content.includes('import ') || chunk.content.includes('export ')) {
        score += 0.5;
      }

      return { ...chunk, score };
    });

    // Return top scoring chunks
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter(c => c.score > 0)
      .slice(0, maxChunks);
  }
}
```

**Tasks:**
1. Create `SemanticChunker` class
2. Implement code-aware chunking
3. Add relevance scoring
4. Create tests for various file types

**Success Criteria:**
- Code files chunked by function/class
- Relevant chunks selected for queries
- Chunks preserve structure

---

### Phase 3: Markdown/Document Chunking (Day 2)

**File: `server/document-chunker.ts`** (NEW)

```typescript
export class DocumentChunker {
  // Chunk markdown files by section
  chunkMarkdown(filePath: string): Chunk[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    let currentChunk: string[] = [];
    let currentHeader: string | null = null;
    let currentLevel = 0;
    let chunkStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headerMatch) {
        const level = headerMatch[1].length;
        const title = headerMatch[2].trim();

        // Save previous section
        if (currentChunk.length > 0) {
          chunks.push({
            id: `${filePath}:${chunkStart}-${i - 1}`,
            documentId: filePath,
            type: ChunkType.SECTION,
            content: currentChunk.join('\n'),
            metadata: {
              startLine: chunkStart,
              endLine: i - 1,
              name: currentHeader || 'Intro',
              headers: [currentHeader || 'Intro'],
              tokens: this.estimateTokens(currentChunk.join('\n')),
            },
          });
        }

        // Start new section
        currentChunk = [line];
        chunkStart = i;
        currentHeader = title;
        currentLevel = level;
      } else {
        currentChunk.push(line);
      }
    }

    // Add remaining content
    if (currentChunk.length > 0) {
      chunks.push({
        id: `${filePath}:${chunkStart}-${lines.length - 1}`,
        documentId: filePath,
        type: ChunkType.SECTION,
        content: currentChunk.join('\n'),
        metadata: {
          startLine: chunkStart,
          endLine: lines.length - 1,
          name: currentHeader || 'End',
          tokens: this.estimateTokens(currentChunk.join('\n')),
        },
      });
    }

    return chunks;
  }

  // Extract table of contents
  extractTOC(filePath: string): TOCEntry[] {
    const chunks = this.chunkMarkdown(filePath);
    return chunks
      .filter(c => c.metadata.name)
      .map(c => ({
        name: c.metadata.name!,
        line: c.metadata.startLine,
        id: c.id,
      }));
  }

  // Get specific section
  getSection(filePath: string, sectionName: string): string | null {
    const chunks = this.chunkMarkdown(filePath);
    const chunk = chunks.find(c =>
      c.metadata.name?.toLowerCase() === sectionName.toLowerCase()
    );
    return chunk?.content || null;
  }
}
```

**Tasks:**
1. Create markdown-aware chunking
2. Implement TOC extraction
3. Add section retrieval
4. Handle code blocks in markdown

**Success Criteria:**
- Markdown chunked by headers
- TOC extracted correctly
- Sections retrievable by name

---

### Phase 4: JSON/Data File Handling (Day 2)

**File: `server/json-handler.ts`** (NEW)

```typescript
export class JSONHandler {
  // Chunk large JSON files by object/array structure
  chunkJSON(filePath: string, maxTokens: number = 5000): Chunk[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    const chunks: Chunk[] = [];

    if (Array.isArray(json)) {
      // Chunk array into batches
      const chunkSize = this.calculateChunkSize(json, maxTokens);
      for (let i = 0; i < json.length; i += chunkSize) {
        const batch = json.slice(i, i + chunkSize);
        chunks.push({
          id: `${filePath}:array:${i}-${i + chunkSize}`,
          documentId: filePath,
          type: ChunkType.JSON_OBJECT,
          content: JSON.stringify(batch, null, 2),
          metadata: {
            startLine: i,
            endLine: i + chunkSize,
            name: `items[${i}-${i + chunkSize}]`,
            tokens: this.estimateTokens(JSON.stringify(batch)),
          },
        });
      }
    } else if (typeof json === 'object') {
      // Chunk object by top-level keys
      const keys = Object.keys(json);
      const chunkKeys = this.groupKeysByTokens(json, maxTokens);

      for (const group of chunkKeys) {
        const subset = Object.fromEntries(
          group.map(key => [key, json[key]])
        );
        chunks.push({
          id: `${filePath}:object:${group.join('-')}`,
          documentId: filePath,
          type: ChunkType.JSON_OBJECT,
          content: JSON.stringify(subset, null, 2),
          metadata: {
            name: `keys: ${group.join(', ')}`,
            tokens: this.estimateTokens(JSON.stringify(subset)),
          },
        });
      }
    }

    return chunks;
  }

  // Query JSON for specific keys/values
  queryJSON(filePath: string, query: string): any[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    const results: any[] = [];

    const search = (obj: any, path: string = 'root') => {
      if (typeof obj !== 'object' || obj === null) return;

      // Check string values
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = `${path}.${key}`;

        if (typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase())) {
          results.push({ path: currentPath, value });
        } else if (typeof value === 'object' && value !== null) {
          search(value, currentPath);
        } else if (Array.isArray(value)) {
          value.forEach((item, idx) => {
            search(item, `${currentPath}[${idx}]`);
          });
        }
      }
    };

    search(json);
    return results;
  }

  // Get specific keys from JSON
  getKeys(filePath: string, keys: string[]): Record<string, any> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);

    return Object.fromEntries(
      keys.filter(key => key in json)
          .map(key => [key, json[key]])
    );
  }

  private groupKeysByTokens(obj: object, maxTokens: number): string[][] {
    const groups: string[][] = [];
    let currentGroup: string[] = [];
    let currentTokens = 0;

    for (const [key, value] of Object.entries(obj)) {
      const tokens = this.estimateTokens(JSON.stringify({ [key]: value }));

      if (currentTokens + tokens > maxTokens && currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [key];
        currentTokens = tokens;
      } else {
        currentGroup.push(key);
        currentTokens += tokens;
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }
}
```

**Tasks:**
1. Create `JSONHandler` class
2. Implement array chunking
3. Implement object chunking
4. Add JSON query capabilities

**Success Criteria:**
- Large package.json files handled
- JSON chunks queryable
- Specific keys retrievable

---

### Phase 5: Log File Handling (Day 2-3)

**File: `server/log-handler.ts`** (NEW)

```typescript
export class LogHandler {
  // Parse log entries from various formats
  parseLog(filePath: string): LogEntry[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const entries: LogEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const entry = this.parseLogLine(lines[i], i);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  // Chunk logs by time or entry count
  chunkLogsByTime(
    filePath: string,
    startTime: Date,
    endTime: Date,
    maxEntries: number = 1000
  ): Chunk[] {
    const entries = this.parseLog(filePath);
    const filtered = entries.filter(e =>
      e.timestamp >= startTime && e.timestamp <= endTime
    );

    // Paginate
    const chunks: Chunk[] = [];
    for (let i = 0; i < filtered.length; i += maxEntries) {
      const batch = filtered.slice(i, i + maxEntries);
      chunks.push({
        id: `${filePath}:${batch[0].line}-${batch[batch.length - 1].line}`,
        documentId: filePath,
        type: ChunkType.LOG_ENTRY,
        content: batch.map(e => e.raw).join('\n'),
        metadata: {
          startLine: batch[0].line,
          endLine: batch[batch.length - 1].line,
          name: `logs ${formatTime(batch[0].timestamp)}`,
          tokens: this.estimateTokens(batch.map(e => e.raw).join('\n')),
        },
      });
    }

    return chunks;
  }

  // Search logs for patterns
  searchLogs(
    filePath: string,
    pattern: string | RegExp,
    level?: string,
    maxResults: number = 100
  ): LogEntry[] {
    const entries = this.parseLog(filePath);
    let filtered = entries;

    // Filter by level if specified
    if (level) {
      filtered = filtered.filter(e => e.level === level);
    }

    // Apply pattern filter
    if (pattern instanceof RegExp) {
      filtered = filtered.filter(e => pattern.test(e.message));
    } else {
      filtered = filtered.filter(e =>
        e.message.toLowerCase().includes(pattern.toLowerCase())
      );
    }

    return filtered.slice(0, maxResults);
  }

  // Get log statistics
  getLogStats(filePath: string): LogStats {
    const entries = this.parseLog(filePath);

    const levelCounts = entries.reduce((acc, e) => {
      acc[e.level] = (acc[e.level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const timeRange = entries.length > 0 ? {
      start: entries[0].timestamp,
      end: entries[entries.length - 1].timestamp,
    } : null;

    return {
      totalEntries: entries.length,
      levelCounts,
      timeRange,
      averageEntriesPerMinute: timeRange
        ? (entries.length / ((timeRange.end - timeRange.start) / 60000))
        : 0,
    };
  }

  private parseLogLine(line: string, lineNumber: number): LogEntry | null {
    // Try common log formats
    // Apache/Nginx
    const apacheMatch = line.match(/^(\S+) \S+ \S+ \[([\w:]+)\] "(\w+) ([^"]+)"/);
    if (apacheMatch) {
      return {
        raw: line,
        line: lineNumber,
        timestamp: new Date(apacheMatch[2]),
        level: 'info',
        message: line,
      };
    }

    // Application logs (timestamp level message)
    const appMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\s+(\w+))?\s+(.+)$/);
    if (appMatch) {
      return {
        raw: line,
        line: lineNumber,
        timestamp: new Date(appMatch[1]),
        level: appMatch[2] || 'info',
        message: appMatch[3],
      };
    }

    // Generic: look for level at start
    const levelMatch = line.match(/^(\w+):\s*(.+)$/);
    if (levelMatch && ['error', 'warn', 'info', 'debug', 'trace', 'fatal'].includes(levelMatch[1].toLowerCase())) {
      return {
        raw: line,
        line: lineNumber,
        timestamp: new Date(), // Unknown
        level: levelMatch[1].toLowerCase(),
        message: levelMatch[2],
      };
    }

    return null;
  }
}

interface LogEntry {
  raw: string;
  line: number;
  timestamp: Date;
  level: string;
  message: string;
}

interface LogStats {
  totalEntries: number;
  levelCounts: Record<string, number>;
  timeRange: { start: Date; end: Date } | null;
  averageEntriesPerMinute: number;
}
```

**Tasks:**
1. Create `LogHandler` class
2. Implement multiple log format parsers
3. Add log search functionality
4. Create log statistics

**Success Criteria:**
- Common log formats parsed
- Logs searchable by level/pattern
- Time-based chunking works

---

### Phase 6: Projects Integration (Day 3)

**File: `server/projects-manager.ts`** (MODIFY)

```typescript
export class ProjectsManager {
  private semanticChunker: SemanticChunker;
  private documentChunker: DocumentChunker;
  private jsonHandler: JSONHandler;
  private logHandler: LogHandler;

  constructor(dataDir: string) {
    // ... existing code ...
    this.semanticChunker = new SemanticChunker();
    this.documentChunker = new DocumentChunker();
    this.jsonHandler = new JSONHandler();
    this.logHandler = new LogHandler();
  }

  // Get project context with large file handling
  async getProjectContext(): Promise<string> {
    const project = this.getActive();
    if (!project) return '';

    let context = `\n\n---\n\n# Project: ${project.name}\n`;

    if (project.description) {
      context += `\n${project.description}\n`;
    }

    if (project.rootPath) {
      context += `\nProject root: ${project.rootPath}\n`;
    }

    if (project.instructions) {
      context += `\n## Instructions\n${project.instructions}\n`;
    }

    // Process files with size-aware handling
    const files = project.files;
    const normalFiles = files.filter(f => f.type !== 'large');
    const largeFiles = files.filter(f => f.type === 'large');

    // Add normal files
    if (normalFiles.length > 0) {
      context += `\n## Files\n`;

      for (const file of normalFiles) {
        context += `\n### ${file.name}\n`;
        context += '```\n';
        context += file.content || '[No content]';
        context += '\n```\n';
      }
    }

    // Add large file references/chunks
    if (largeFiles.length > 0) {
      context += `\n## Large Files\n`;
      context += `*Large files are available for contextual search. Use specific queries to access relevant sections.*\n\n`;

      for (const file of largeFiles) {
        const handle = file.metadata?.handle;
        if (handle) {
          context += `### ${file.name}\n`;
          context += `- **Type:** ${handle.type}\n`;
          context += `- **Size:** ${formatBytes(file.size)}\n`;
          context += `- **Strategy:** ${handle.strategy}\n`;

          // Add summary or TOC if available
          if (handle.type === 'markdown') {
            const toc = this.documentChunker.extractTOC(file.path);
            if (toc.length > 0) {
              context += `\n**Contents:**\n`;
              toc.slice(0, 20).forEach(entry => {
                context += `  - ${entry.name} (line ${entry.line})\n`;
              });
              if (toc.length > 20) {
                context += `  - ... and ${toc.length - 20} more sections\n`;
              }
            }
          }
          context += '\n';
        }
      }
    }

    return context;
  }

  // NEW: Get relevant content from large files
  async getRelevantContent(query: string): Promise<string> {
    const project = this.getActive();
    if (!project) return '';

    let relevantContent = '';
    const largeFiles = project.files.filter(f => f.type === 'large');

    for (const file of largeFiles) {
      const handle = file.metadata?.handle;
      if (!handle) continue;

      switch (handle.type) {
        case 'markdown':
          const section = this.documentChunker.getSection(file.path, query);
          if (section) {
            relevantContent += `\n### ${file.name} (section "${query}")\n`;
            relevantContent += '```\n' + section + '\n```\n';
          }
          break;

        case 'code':
          const chunks = this.semanticChunker.chunkCodeFile(file.path);
          const relevantChunks = this.semanticChunker.getRelevantChunks(chunks, query, 3);
          for (const chunk of relevantChunks) {
            relevantContent += `\n### ${file.name} (${chunk.metadata.name})\n`;
            relevantContent += '```\n' + chunk.content + '\n```\n';
          }
          break;

        case 'json':
          const jsonResults = this.jsonHandler.queryJSON(file.path, query);
          if (jsonResults.length > 0) {
            relevantContent += `\n### ${file.name} (matching "${query}")\n`;
            relevantContent += '```json\n';
            relevantContent += JSON.stringify(jsonResults.slice(0, 10), null, 2);
            relevantContent += '\n```\n';
          }
          break;

        case 'log':
          const logEntries = this.logHandler.searchLogs(file.path, query);
          if (logEntries.length > 0) {
            relevantContent += `\n### ${file.name} (${logEntries.length} matches)\n`;
            relevantContent += '```\n';
            relevantContent += logEntries.slice(0, 20).map(e => e.raw).join('\n');
            if (logEntries.length > 20) {
              relevantContent += `\n... ${logEntries.length - 20} more matches\n`;
            }
            relevantContent += '\n```\n';
          }
          break;
      }
    }

    return relevantContent;
  }
}
```

**Tasks:**
1. Integrate chunkers into ProjectsManager
2. Add `getRelevantContent()` method
3. Update context generation
4. Add chunking metadata display

**Success Criteria:**
- Large files accessible via search
- Relevant content extracted
- User sees what's available

---

### Phase 7: API Endpoints (Day 3)

**File: `server/index.ts`** (MODIFY)

```typescript
// NEW: Endpoints for large file handling

// Get document metadata
app.get('/api/documents/:sessionId/metadata', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath } = req.query;

  const project = projectsManager.getActive();
  if (!project) {
    return res.status(404).json({ error: 'No active project' });
  }

  const file = project.files.find(f => f.path === filePath);
  if (!file) {
    return res.status(404).json({ error: 'File not found in project' });
  }

  const metadata = await largeDocumentHandler.analyze(filePath);
  res.json({
    file: {
      path: file.path,
      name: file.name,
      size: file.size,
    },
    metadata,
  });
});

// Get document chunks
app.get('/api/documents/:sessionId/chunks', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath } = req.query;

  const chunks = await semanticChunker.chunkCodeFile(filePath as string);
  res.json({
    filePath,
    totalChunks: chunks.length,
    chunks: chunks.map(c => ({
      id: c.id,
      name: c.metadata.name,
      startLine: c.metadata.startLine,
      endLine: c.metadata.endLine,
      tokens: c.metadata.tokens,
    })),
  });
});

// Search within document
app.get('/api/documents/:sessionId/search', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath, query } = req.query;

  const results = await largeDocumentHandler.search(
    filePath as string,
    query as string
  );

  res.json({
    filePath,
    query,
    results: results.slice(0, 50),
  });
});

// Get document section
app.get('/api/documents/:sessionId/section', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath, section } = req.query;

  const content = await documentChunker.getSection(
    filePath as string,
    section as string
  );

  if (!content) {
    return res.status(404).json({ error: 'Section not found' });
  }

  res.json({ filePath, section, content });
});
```

**Tasks:**
1. Add document metadata endpoint
2. Add chunks listing endpoint
3. Add document search endpoint
4. Add section retrieval endpoint

**Success Criteria:**
- All endpoints return correct data
- Error handling works
- Response times acceptable

---

### Phase 8: Frontend UI (Day 3)

**File: `src/components/LargeFileDialog.tsx`** (NEW)

```typescript
export function LargeFileDialog({ file, onClose }: LargeFileDialogProps) {
  const { data: metadata } = useApi().getDocumentMetadata(file.path);
  const [activeTab, setActiveTab] = useState<'chunks' | 'search' | 'toc'>('chunks');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{file.name}</DialogTitle>
          <DialogDescription>
            {formatBytes(file.size)} • {metadata?.type || 'unknown'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="chunks">Chunks</TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="toc">Contents</TabsTrigger>
          </TabsList>

          <TabsContent value="chunks" className="mt-4">
            <ChunkList file={file} />
          </TabsContent>

          <TabsContent value="search" className="mt-4">
            <DocumentSearch file={file} query={searchQuery} />
          </TabsContent>

          <TabsContent value="toc" className="mt-4">
            <TableOfContents file={file} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ChunkList({ file }: { file: ProjectFile }) {
  const { data } = useApi().getDocumentChunks(file.path);

  return (
    <div className="space-y-2">
      {data?.chunks.map(chunk => (
        <ChunkPreview key={chunk.id} chunk={chunk} />
      ))}
    </div>
  );
}

function DocumentSearch({ file, query }: { file: ProjectFile; query: string }) {
  const { data } = useApi().searchDocument(file.path, query);

  return (
    <div className="space-y-2">
      {data?.results.map((result, idx) => (
        <div key={idx} className="p-3 bg-slate-800 rounded-lg">
          <div className="text-sm text-slate-400">{result.path}</div>
          <div className="text-sm mt-1">{result.value}</div>
        </div>
      ))}
    </div>
  );
}
```

**File: `src/components/ProjectsPanel.tsx`** (MODIFY)

Add visual indicators for large files:
- Size badge
- Type badge
- "Large file - click to explore" indicator

**Tasks:**
1. Create `LargeFileDialog` component
2. Add chunk preview component
3. Add document search UI
4. Update projects panel to show large file indicators

**Success Criteria:**
- Users can explore large files
- Search works across documents
- Chunks preview correctly

---

## Configuration Options

### Settings (`.floyd-data/settings.json`)

```json
{
  "documents": {
    "maxFileSize": 10485760,
    "maxTotalSize": 52428800,
    "chunking": {
      "enabled": true,
      "strategy": "semantic",
      "maxChunkTokens": 5000,
      "codeChunkBy": "function",
      "markdownChunkBy": "section"
    },
    "search": {
      "indexLargeFiles": true,
      "maxResults": 50
    }
  }
}
```

### Environment Variables

```bash
# Document handling
FLOYD_MAX_FILE_SIZE=10485760     # 10MB
FLOYD_MAX_TOTAL_SIZE=52428800    # 50MB
FLOYD_CHUNK_TOKENS=5000          # Max tokens per chunk
FLOYD_ENABLE_CHUNKING=true
```

---

## File Changes Summary

### New Files
| File | Purpose | LOC (est) |
|------|---------|-----------|
| `server/large-document-handler.ts` | Large file coordination | ~200 |
| `server/semantic-chunker.ts` | Code-aware chunking | ~250 |
| `server/document-chunker.ts` | Markdown/doc chunking | ~180 |
| `server/json-handler.ts` | JSON file handling | ~200 |
| `server/log-handler.ts` | Log file parsing | ~200 |
| `src/components/LargeFileDialog.tsx` | UI for large files | ~250 |

### Modified Files
| File | Changes | Lines |
|------|---------|-------|
| `server/projects-manager.ts` | Remove limits, add handlers | +200 |
| `server/index.ts` | New API endpoints | +150 |
| `src/components/ProjectsPanel.tsx` | Large file indicators | +50 |

**Total:** ~1,680 lines of new/modified code

---

## Testing Strategy

### Unit Tests

```typescript
describe('SemanticChunker', () => {
  it('should chunk code by function boundaries', () => {
    const code = `
function foo() {
  return 1;
}

function bar() {
  return 2;
}
`;
    const chunks = chunker.chunkCodeFile('test.ts', code);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.name).toBe('foo');
    expect(chunks[1].metadata.name).toBe('bar');
  });

  it('should find relevant chunks for query', () => {
    const chunks = chunker.chunkCodeFile('test.ts', code);
    const relevant = chunker.getRelevantChunks(chunks, 'logging', 5);
    expect(relevant).toBeDefined();
  });
});

describe('JSONHandler', () => {
  it('should chunk large JSON arrays', () => {
    const largeArray = Array(10000).fill({ item: 'data' });
    const chunks = jsonHandler.chunkJSON('test.json', largeArray);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should query JSON for specific keys', () => {
    const data = { name: 'test', value: 42, nested: { x: 1 } };
    jsonHandler.writeJSON('test.json', data);
    const results = jsonHandler.queryJSON('test.json', 'test');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('LogHandler', () => {
  it('should parse common log formats', () => {
    const logLine = '2024-02-04 10:30:00 ERROR Something went wrong';
    const entry = logHandler.parseLogLine(logLine, 0);
    expect(entry).toBeDefined();
    expect(entry.level).toBe('error');
  });

  it('should search logs by level and pattern', () => {
    const entries = logHandler.searchLogs('app.log', 'database', 'error', 100);
    expect(Array.isArray(entries)).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('Large Document Integration', () => {
  it('should handle 5MB markdown file', async () => {
    const largeFile = createLargeMarkdown(5 * 1024 * 1024);
    const project = await projectsManager.create({
      name: 'Large Docs Test',
      description: 'Testing large file handling',
    });

    const file = await projectsManager.addFile(project.id, largeFile);
    expect(file).toBeDefined();
    expect(file.type).toBe('large');
  });

  it('should search across chunked files', async () => {
    const project = await setupProjectWithLargeCodebase();
    const results = await projectsManager.getRelevantContent('authentication');
    expect(results).toContain('authenticate');
  });
});
```

---

## Performance Considerations

### Memory Management

```typescript
class LargeDocumentCache {
  private cache: LRUCache<string, Chunk[]> = new LRUCache({
    max: 100,  // Cache 100 documents' chunks
    maxSize: 500 * 1024 * 1024,  // 500MB total cache
  });

  get(filePath: string): Chunk[] | null {
    return this.cache.get(filePath);
  }

  set(filePath: string, chunks: Chunk[]): void {
    const size = chunks.reduce((sum, c) => sum + c.content.length, 0);
    this.cache.set(filePath, chunks, size);
  }

  // Clear unused documents
  evictUnused(exceptIds: string[]): void {
    // Implement smart eviction
  }
}
```

### Streaming for Very Large Files

```typescript
// For files > 50MB, use streaming
async streamDocument(
  filePath: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  const stream = fs.createReadStream(filePath, {
    encoding: 'utf-8',
    highWaterMark: 1024 * 64,  // 64KB chunks
  });

  for await (const chunk of stream) {
    onChunk(chunk);
  }
}
```

---

## Monitoring & Metrics

### Key Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| File acceptance rate | >95% | Files successfully added |
| Chunk relevance | >70% | User queries find results |
| Search latency | <500ms | Large file search response |
| Memory usage | <500MB | Chunk cache size |

### Dashboard Display

```
Large Document Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Files in Project: 234
  • Normal: 220 (≤100KB)
  • Large: 14 (chunked)
  • Total Size: 45.2 MB

Chunking Performance:
  • Average Chunks/File: 3.2
  • Cache Hit Rate: 67%
  • Search Queries: 1,234

Largest Files:
  1. package-lock.json (1.2 MB) - 15 chunks
  2. CHANGELOG.md (450 KB) - 8 chunks
  3. app.log (380 KB) - 12,450 entries
```

---

## Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Max file size | 100 KB | 10 MB | **100x increase** |
| package-lock.json | ❌ Blocked | ✅ Supported | Common case solved |
| CHANGELOG.md | ❌ Blocked | ✅ Supported | Documentation accessible |
| Large logs | ❌ Blocked | ✅ Searchable | Operations improved |
| Context per file | All or nothing | Smart chunks | Efficiency gained |

---

## Rollout Plan

### Phase 1: Limited Alpha
- Files up to 1MB
- Code and markdown only
- Manual chunking triggers

### Phase 2: Beta
- Files up to 10MB
- JSON and log support
- Auto-chunking enabled

### Phase 3: Full Release
- Unlimited file size (streaming)
- All document types
- Full UI for exploration

---

## References

- Current limits: `server/projects-manager.ts:33-34`
- Chunking patterns: Semantic code analysis
- Claude Desktop: Supports 1MB+ documents with smart chunking

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-04 | Initial planning document | Floyd |
