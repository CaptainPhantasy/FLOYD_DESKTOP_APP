# Context Window Management

**Status:** Planning
**Priority:** High
**Estimate:** 3-4 days
**Created:** 2026-02-04

---

## Overview

Implement intelligent context window management to support larger context sizes similar to Claude Desktop (200K tokens for Sonnet, 1M tokens for Opus). Currently, Floyd Desktop Web has hard-coded limits that restrict effective context usage.

**Reference:** Claude Desktop supports 200K token context windows with intelligent context injection and management.

---

## Problem Statement

### Current State Analysis

```typescript
// server/projects-manager.ts:33-34
private maxFileSize = 100 * 1024;  // 100KB max per file
private maxTotalSize = 500 * 1024;  // 500KB total context
```

| Limitation | Current Value | Claude Desktop | Gap |
|------------|---------------|----------------|-----|
| **Max file size** | 100 KB | ~1 MB (estimated) | **10x smaller** |
| **Total project context** | 500 KB | 200K tokens (~160KB raw) | **Need smarter management** |
| **Session history** | Unlimited (all messages) | Smart summarization | **No optimization** |
| **Token awareness** | None | Precise tracking | **Blind to usage** |

### Impact

- **Cannot analyze large files** (logs, datasets, documentation)
- **Project context truncated** for larger codebases
- **No token budget awareness** - waste tokens on redundant content
- **Session bloat** - ancient messages consume context unnecessarily
- **No context summarization** - unlike Claude's conversation compression

---

## Proposed Solution

### Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Context Orchestrator                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Token Budget │  │ Content      │  │ Message      │           │
│  │ Manager      │  │ Prioritizer  │  │ Summarizer   │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                    Context Layers                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ System      │  │ Project     │  │ Conversation│              │
│  │ Prompt      │  │ Context     │  │ History     │              │
│  │ (~2K tokens)│  │ (managed)   │  │ (compressed)│              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Token Budget Manager (`server/token-budget.ts`)

```typescript
interface TokenBudget {
  total: number;           // e.g., 200000 for Sonnet
  reserved: number;        // Reserved for response
  available: number;       // total - reserved - used
  used: number;
}

class TokenBudgetManager {
  private modelLimits: Record<string, number> = {
    'claude-sonnet-4-5-20250514': 200000,
    'claude-opus-4-5-20250514': 1000000,
    'claude-3-5-haiku-20241022': 200000,
    'gpt-4o': 128000,
    'glm-4.7': 128000,
  };

  getBudget(model: string): TokenBudget;
  estimateTokens(text: string): number;
  canFit(content: string, budget: TokenBudget): boolean;
}
```

#### 2. Content Prioritizer (`server/content-prioritizer.ts`)

```typescript
interface ContentItem {
  id: string;
  type: 'system' | 'project' | 'message' | 'file';
  content: string;
  tokens: number;
  priority: number;        // 1-10, higher = more important
  age: number;             // milliseconds since creation
  accessCount: number;     // how often referenced
}

class ContentPrioritizer {
  prioritize(
    items: ContentItem[],
    budget: TokenBudget
  ): ContentItem[];

  // Scoring function combining multiple factors
  private score(item: ContentItem): number;
}
```

#### 3. Message Summarizer (`server/message-summarizer.ts`)

```typescript
interface ConversationSummary {
  originalMessages: number;
  summarizedMessages: number;
  tokensBefore: number;
  tokensAfter: number;
  summary: string;
  keyPoints: string[];
}

class MessageSummarizer {
  async summarize(
    messages: Message[],
    targetTokens: number
  ): Promise<ConversationSummary>;

  // Periodic summarization of old messages
  async compressSession(
    session: Session,
    budget: TokenBudget
  ): Promise<Session>;
}
```

#### 4. Smart File Chunking (`server/file-chunker.ts`)

```typescript
interface FileChunk {
  id: string;
  filePath: string;
  chunkIndex: number;
  totalChunks: number;
  content: string;
  tokens: number;
  metadata: {
    startLine?: number;
    endLine?: number;
    summary?: string;
  };
}

class FileChunker {
  // Split large files into semantic chunks
  chunkFile(
    filePath: string,
    maxTokens: number
  ): FileChunk[];

  // Get relevant chunks based on query
  getRelevantChunks(
    chunks: FileChunk[],
    query: string,
    budget: number
  ): FileChunk[];
}
```

---

## Implementation Plan

### Phase 1: Token Budget Manager (Day 1)

**File: `server/token-budget.ts`** (NEW)

```typescript
export class TokenBudgetManager {
  // Approximate token counting (faster than API)
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    // More accurate for code: count words + punctuation
    return Math.ceil(text.length / 4);
  }

  // Precise token counting via API
  async countTokensExact(text: string, model: string): Promise<number> {
    // Use Anthropic's tokenizer API or tiktoken
    // Cache results for performance
  }

  getBudget(model: string): TokenBudget {
    const maxTokens = this.modelLimits[model] || 200000;
    const reserved = Math.floor(maxTokens * 0.2); // 20% for response
    return {
      total: maxTokens,
      reserved,
      available: maxTokens - reserved,
      used: 0,
    };
  }

  createAllocation(budget: TokenBudget): ContextAllocation {
    // Divide budget among:
    // - System prompt: ~2K tokens
    // - Project context: variable
    // - Conversation: variable
    // - Reserve: 20%
  }
}
```

**Tasks:**
1. Create `TokenBudgetManager` class
2. Implement `estimateTokens()` with character-based heuristic
3. Add model-specific token limits
4. Create budget allocation logic

**Success Criteria:**
- Can estimate tokens for any text
- Returns accurate budget for each model
- Allocation splits budget appropriately

---

### Phase 2: Content Prioritization (Day 1-2)

**File: `server/content-prioritizer.ts`** (NEW)

```typescript
export class ContentPrioritizer {
  prioritize(
    items: ContentItem[],
    budget: TokenBudget
  ): ContentItem[] {
    // Score each item
    const scored = items.map(item => ({
      ...item,
      score: this.calculateScore(item),
    }));

    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);

    // Fit within budget
    const result: ContentItem[] = [];
    let usedTokens = 0;

    for (const item of scored) {
      if (usedTokens + item.tokens <= budget.available) {
        result.push(item);
        usedTokens += item.tokens;
      }
    }

    return result;
  }

  private calculateScore(item: ContentItem): number {
    let score = item.priority;

    // Boost recent items
    const ageHours = item.age / (1000 * 60 * 60);
    score += Math.max(0, 10 - ageHours);

    // Boost frequently accessed
    score += Math.min(item.accessCount, 5);

    // System content always highest
    if (item.type === 'system') score += 100;

    return score;
  }
}
```

**Tasks:**
1. Create `ContentPrioritizer` class
2. Implement scoring algorithm
3. Add budget-aware filtering
4. Create unit tests for prioritization

**Success Criteria:**
- Prioritization keeps important content
- Respects token budget
- Testable behavior

---

### Phase 3: Message Summarization (Day 2)

**File: `server/message-summarizer.ts`** (NEW)

```typescript
export class MessageSummarizer {
  constructor(
    private apiClient: Anthropic | OpenAI,
    private budgetManager: TokenBudgetManager
  ) {}

  async summarize(
    messages: Message[],
    targetTokens: number
  ): Promise<ConversationSummary> {
    const tokensBefore = this.budgetManager.estimateTokens(
      JSON.stringify(messages)
    );

    // Use AI to summarize older messages
    const summaryPrompt = this.buildSummaryPrompt(messages);
    const response = await this.apiClient.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: targetTokens,
      messages: [{ role: 'user', content: summaryPrompt }],
    });

    const summary = response.content[0].text;
    const tokensAfter = this.budgetManager.estimateTokens(summary);

    return {
      originalMessages: messages.length,
      summarizedMessages: messages.length,
      tokensBefore,
      tokensAfter,
      summary,
      keyPoints: this.extractKeyPoints(summary),
    };
  }

  async compressSession(
    session: Session,
    budget: TokenBudget
  ): Promise<Session> {
    // Keep recent messages (last 10)
    const recent = session.messages.slice(-10);
    const old = session.messages.slice(0, -10);

    if (old.length === 0) return session;

    // Summarize old messages
    const summary = await this.summarize(old, budget.available * 0.1);

    // Create summary message
    const summaryMessage: Message = {
      role: 'system',
      content: `[Previous conversation summary]\n${summary.summary}`,
      timestamp: Date.now(),
    };

    return {
      ...session,
      messages: [summaryMessage, ...recent],
    };
  }

  private buildSummaryPrompt(messages: Message[]): string {
    return `Summarize the following conversation, focusing on:
1. Key decisions made
2. Important context established
3. Tasks completed
4. Pending items

Conversation:
${this.formatMessages(messages)}

Provide a concise summary that preserves essential context.`;
  }
}
```

**Tasks:**
1. Create `MessageSummarizer` class
2. Implement summary generation via AI
3. Add session compression logic
4. Store summaries with original messages

**Success Criteria:**
- Can summarize message history
- Compressed sessions retain important context
- Token reduction achieved

---

### Phase 4: Smart File Chunking (Day 2-3)

**File: `server/file-chunker.ts`** (NEW)

```typescript
export class FileChunker {
  // Semantic chunking based on file structure
  chunkFile(filePath: string, maxTokens: number): FileChunk[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Detect file type for chunking strategy
    const fileType = this.detectFileType(filePath);

    switch (fileType) {
      case 'code':
        return this.chunkCodeFile(lines, maxTokens);
      case 'markdown':
        return this.chunkMarkdownFile(lines, maxTokens);
      case 'json':
        return this.chunkJsonFile(content, maxTokens);
      default:
        return this.chunkTextFile(lines, maxTokens);
    }
  }

  private chunkCodeFile(
    lines: string[],
    maxTokens: number
  ): FileChunk[] {
    const chunks: FileChunk[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let braceDepth = 0;
    let parenDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineTokens = this.estimateTokens(line);

      // Track nesting depth
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;
      parenDepth += (line.match(/\(/g) || []).length;
      parenDepth -= (line.match(/\)/g) || []).length;

      currentChunk.push(line);
      currentTokens += lineTokens;

      // Break chunk at safe point (depth 0) and approaching limit
      if (
        braceDepth === 0 &&
        parenDepth === 0 &&
        currentTokens > maxTokens * 0.8
      ) {
        chunks.push(this.createChunk(chunks.length, currentChunk, lines));
        currentChunk = [];
        currentTokens = 0;
      }
    }

    // Add remaining content
    if (currentChunk.length > 0) {
      chunks.push(this.createChunk(chunks.length, currentChunk, lines));
    }

    return chunks;
  }

  private chunkMarkdownFile(
    lines: string[],
    maxTokens: number
  ): FileChunk[] {
    const chunks: FileChunk[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Start new chunk at major headers
      if (line.match(/^#{1,2} /) && currentChunk.length > 0) {
        chunks.push(this.createChunk(chunks.length, currentChunk, lines));
        currentChunk = [];
        currentTokens = 0;
      }

      currentChunk.push(line);
      currentTokens += this.estimateTokens(line);

      if (currentTokens >= maxTokens * 0.9) {
        chunks.push(this.createChunk(chunks.length, currentChunk, lines));
        currentChunk = [];
        currentTokens = 0;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(this.createChunk(chunks.length, currentChunk, lines));
    }

    return chunks;
  }

  // Get most relevant chunks for a query
  getRelevantChunks(
    chunks: FileChunk[],
    query: string,
    budget: number
  ): FileChunk[] {
    // Score chunks by keyword relevance
    const queryWords = query.toLowerCase().split(/\s+/);

    const scored = chunks.map(chunk => {
      const contentLower = chunk.content.toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (word.length > 3 && contentLower.includes(word)) {
          score += 1;
        }
      }

      // Boost first chunk (usually has imports/setup)
      if (chunk.chunkIndex === 0) score += 0.5;

      return { ...chunk, score };
    });

    // Sort by score and take top chunks within budget
    scored.sort((a, b) => b.score - a.score);

    const result: FileChunk[] = [];
    let usedTokens = 0;

    for (const chunk of scored) {
      if (chunk.score > 0 && usedTokens + chunk.tokens <= budget) {
        result.push(chunk);
        usedTokens += chunk.tokens;
      }
    }

    return result;
  }

  private detectFileType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap: Record<string, string> = {
      '.ts': 'code',
      '.tsx': 'code',
      '.js': 'code',
      '.jsx': 'code',
      '.py': 'code',
      '.rs': 'code',
      '.go': 'code',
      '.java': 'code',
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.json': 'json',
    };
    return typeMap[ext] || 'text';
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

**Tasks:**
1. Create `FileChunker` class
2. Implement code file chunking (respecting syntax)
3. Implement markdown chunking (by headers)
4. Add relevance scoring for chunks
5. Create chunk metadata and summaries

**Success Criteria:**
- Large files can be processed in chunks
- Chunks maintain semantic boundaries
- Relevant chunks selected for queries

---

### Phase 5: Projects Manager Integration (Day 3)

**File: `server/projects-manager.ts`** (MODIFY)

```typescript
export class ProjectsManager {
  private fileChunker: FileChunker;
  private budgetManager: TokenBudgetManager;
  private prioritizer: ContentPrioritizer;

  constructor(dataDir: string) {
    // ... existing code ...
    this.fileChunker = new FileChunker();
    this.budgetManager = new TokenBudgetManager();
    this.prioritizer = new ContentPrioritizer();
  }

  // NEW: Get context that fits within token budget
  async getProjectContextBudget(
    model: string,
    query?: string
  ): Promise<string> {
    const project = this.getActive();
    if (!project) return '';

    const budget = this.budgetManager.getBudget(model);

    // Reserve space for other context
    const projectBudget = budget.available * 0.4; // 40% for project

    // Build content items
    const items: ContentItem[] = [];

    // Add project description (highest priority)
    if (project.description) {
      items.push({
        id: 'description',
        type: 'project',
        content: project.description,
        tokens: this.budgetManager.estimateTokens(project.description),
        priority: 10,
        age: 0,
        accessCount: 1,
      });
    }

    // Add project instructions
    if (project.instructions) {
      items.push({
        id: 'instructions',
        type: 'project',
        content: project.instructions,
        tokens: this.budgetManager.estimateTokens(project.instructions),
        priority: 9,
        age: 0,
        accessCount: 1,
      });
    }

    // Process files (chunk large ones)
    for (const file of project.files) {
      if (file.size <= 100 * 1024) {
        // Small files - include directly
        items.push({
          id: file.path,
          type: 'file',
          content: file.content || '',
          tokens: this.budgetManager.estimateTokens(file.content || ''),
          priority: 5,
          age: file.lastModified,
          accessCount: 1,
        });
      } else {
        // Large files - use relevant chunks
        const chunks = this.fileChunker.chunkFile(file.path, 5000);
        const relevant = query
          ? this.fileChunker.getRelevantChunks(chunks, query, projectBudget)
          : chunks.slice(0, 3); // First 3 chunks if no query

        for (const chunk of relevant) {
          items.push({
            id: `${file.path}:${chunk.chunkIndex}`,
            type: 'file',
            content: chunk.content,
            tokens: chunk.tokens,
            priority: 4,
            age: file.lastModified,
            accessCount: 1,
          });
        }
      }
    }

    // Prioritize and fit within budget
    const selected = this.prioritizer.prioritize(items, budget);

    // Build context string
    let context = `\n\n---\n\n# Project: ${project.name}\n`;

    if (project.description) {
      context += `\n${project.description}\n`;
    }

    if (project.instructions) {
      context += `\n## Instructions\n${project.instructions}\n`;
    }

    const fileItems = selected.filter(i => i.type === 'file');
    if (fileItems.length > 0) {
      context += `\n## Context Files\n`;

      for (const item of fileItems) {
        context += `\n### ${this.getFileName(item.id)}\n`;
        context += '```\n';
        context += item.content;
        context += '\n```\n';
      }
    }

    // Add chunk indicators
    if (this.hasChunks(selected)) {
      context += `\n[Note: Some files are shown as relevant chunks only]\n`;
    }

    return context;
  }

  private hasChunks(items: ContentItem[]): boolean {
    return items.some(i => i.id.includes(':'));
  }

  private getFileName(id: string): string {
    if (id.includes(':')) {
      const [path, chunkIdx] = id.split(':');
      return `${path} (chunk ${chunkIdx})`;
    }
    return id;
  }
}
```

**Tasks:**
1. Add `FileChunker` to ProjectsManager
2. Add `TokenBudgetManager` to ProjectsManager
3. Add `ContentPrioritizer` to ProjectsManager
4. Implement `getProjectContextBudget()` method
5. Update `index.ts` to use budget-aware context

**Success Criteria:**
- Large projects don't exceed context
- Relevant content prioritized
- Chunk indicators shown to user

---

### Phase 6: Session History Management (Day 3-4)

**File: `server/session-manager.ts`** (NEW)

```typescript
export class SessionManager {
  private summarizer: MessageSummarizer;

  async manageSessionContext(
    session: Session,
    budget: TokenBudget
  ): Promise<Session> {
    const messageTokens = this.estimateSessionTokens(session);

    if (messageTokens <= budget.available * 0.5) {
      return session; // Within budget, no changes
    }

    // Need to compress
    console.log(`[Session] Compressing session ${session.id}: ${messageTokens} -> target ${budget.available * 0.3}`);

    return await this.summarizer.compressSession(session, budget);
  }

  private estimateSessionTokens(session: Session): number {
    return session.messages.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content);
    }, 0);
  }

  // Auto-compress sessions periodically
  async compressAllSessions(budget: TokenBudget): Promise<void> {
    const sessions = Array.from(sessions.values());

    for (const session of sessions) {
      await this.manageSessionContext(session, budget);
    }
  }
}
```

**Tasks:**
1. Create `SessionManager` class
2. Implement session token estimation
3. Add auto-compression scheduling
4. Integrate with chat endpoint

**Success Criteria:**
- Old sessions don't bloat context
- Important conversation preserved
- Automatic maintenance

---

### Phase 7: API Integration (Day 4)

**File: `server/index.ts`** (MODIFY)

```typescript
// Updated chat streaming endpoint with context management
app.post('/api/chat/stream', async (req, res) => {
  const { sessionId, message } = req.body;

  // Get token budget for current model
  const budget = budgetManager.getBudget(settings.model);

  // Manage session context
  let session = sessions.get(sessionId);
  session = await sessionManager.manageSessionContext(session, budget);

  // Build system prompt (budgeted)
  const systemPromptBudget = budget.available * 0.1; // 10% for system
  const systemPrompt = await buildBudgetedSystemPrompt(
    settings.systemPrompt,
    systemPromptBudget
  );

  // Get project context (budgeted)
  const projectBudget = budget.available * 0.3; // 30% for project
  const projectContext = await projectsManager.getProjectContextBudget(
    settings.model,
    message // Query for relevance
  );

  // Calculate remaining for conversation
  const conversationBudget = budget.available
    - systemPromptBudget
    - projectBudget;

  // Select messages within budget
  const selectedMessages = selectMessagesWithinBudget(
    session.messages,
    conversationBudget
  );

  // Convert to API messages
  const apiMessages = selectedMessages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Log token usage
  const estimatedTokens = {
    system: systemPromptBudget,
    project: projectContext ? projectBudget : 0,
    conversation: estimateMessagesTokens(selectedMessages),
    total: 0,
  };
  estimatedTokens.total = Object.values(estimatedTokens).reduce((a, b) => a + b, 0);

  console.log(`[Chat] Token budget: ${JSON.stringify(estimatedTokens, null, 2)}`);

  // ... rest of streaming logic
});

// New endpoint: Get token usage
app.get('/api/tokens/usage', (req, res) => {
  const { sessionId } = req.query;

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const usage = {
    session: {
      messageCount: session.messages.length,
      estimatedTokens: estimateSessionTokens(session),
    },
    project: projectsManager.getActive()?.files.length || 0,
    model: settings.model,
    budget: budgetManager.getBudget(settings.model),
  };

  res.json(usage);
});
```

**Tasks:**
1. Integrate `TokenBudgetManager` into chat endpoint
2. Add session compression before API call
3. Add budget-aware project context
4. Create `/api/tokens/usage` endpoint
5. Add token usage logging

**Success Criteria:**
- Chat respects token budget
- Usage endpoint returns accurate data
- No more "context exceeded" errors

---

### Phase 8: Frontend UI (Day 4)

**File: `src/components/TokenUsageBar.tsx`** (NEW)

```typescript
export function TokenUsageBar() {
  const { data } = useApi().getTokenUsage(currentSessionId);

  if (!data) return null;

  const { usage, budget } = data;
  const percentage = (usage.total / budget.total) * 100;
  const remaining = budget.total - usage.total;

  return (
    <div className="token-usage-bar">
      <div className="token-meter">
        <div
          className="token-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="token-info">
        <span>{formatTokens(usage.total)} / {formatTokens(budget.total)}</span>
        <span className="text-green-400">
          {formatTokens(remaining)} remaining
        </span>
      </div>

      {/* Breakdown */}
      <div className="token-breakdown">
        <div>System: {formatTokens(usage.system)}</div>
        <div>Project: {formatTokens(usage.project)}</div>
        <div>Conversation: {formatTokens(usage.conversation)}</div>
      </div>
    </div>
  );
}
```

**File: `src/components/SettingsModal.tsx`** (MODIFY)

Add "Context" tab with:
- Token budget display
- Current usage breakdown
- Auto-compression toggle
- Chunking preferences

**Tasks:**
1. Create `TokenUsageBar` component
2. Add to chat header
3. Create Context settings tab
4. Show warnings when approaching limit

**Success Criteria:**
- Users can see token usage
- Warnings appear before limit
- Settings are intuitive

---

## Configuration Options

### User Preferences (`.floyd-data/settings.json`)

```json
{
  "context": {
    "maxTokens": 200000,
    "compressionThreshold": 0.7,
    "autoCompress": true,
    "chunking": {
      "enabled": true,
      "maxChunkSize": 5000,
      "strategy": "semantic"
    },
    "prioritization": {
      "recentMessageBoost": 10,
      "accessCountBoost": 5,
      "ageDecayHours": 24
    }
  }
}
```

### Environment Variables

```bash
# Context management settings
FLOYD_MAX_TOKENS=200000
FLOYD_COMPRESSION_THRESHOLD=0.7
FLOYD_AUTO_COMPRESS=true
FLOYD_CHUNK_SIZE=5000
```

---

## File Changes Summary

### New Files
| File | Purpose | LOC (est) |
|------|---------|-----------|
| `server/token-budget.ts` | Token budget management | ~150 |
| `server/content-prioritizer.ts` | Content prioritization | ~200 |
| `server/message-summarizer.ts` | Message summarization | ~250 |
| `server/file-chunker.ts` | File chunking | ~300 |
| `server/session-manager.ts` | Session context management | ~200 |
| `src/components/TokenUsageBar.tsx` | UI for token usage | ~100 |
| `src/components/ContextSettings.tsx` | Context settings UI | ~150 |

### Modified Files
| File | Changes | Lines |
|------|---------|-------|
| `server/projects-manager.ts` | Budget-aware context | +150 |
| `server/index.ts` | Integrate context management | +200 |
| `src/components/SettingsModal.tsx` | Add Context tab | +100 |
| `src/hooks/useApi.ts` | Add token usage hooks | +30 |

**Total:** ~1,830 lines of new/modified code

---

## Testing Strategy

### Unit Tests

```typescript
describe('TokenBudgetManager', () => {
  it('should estimate tokens accurately', () => {
    const text = 'Hello, world!';
    const tokens = manager.estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should return correct budget per model', () => {
    const budget = manager.getBudget('claude-sonnet-4-5-20250514');
    expect(budget.total).toBe(200000);
  });
});

describe('FileChunker', () => {
  it('should chunk large code files correctly', () => {
    const chunks = chunker.chunkFile('large.ts', 5000);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should have imports
    expect(chunks[0].content).toContain('import');
  });

  it('should respect code boundaries', () => {
    const chunks = chunker.chunkFile('code.ts', 5000);
    // Chunks should not break in middle of function
    chunks.forEach(chunk => {
      expect(chunk.content).not.toMatch(/{\s*$/);
    });
  });
});

describe('MessageSummarizer', () => {
  it('should reduce token count', async () => {
    const messages = generateMessages(100);
    const summary = await summarizer.summarize(messages, 1000);
    expect(summary.tokensAfter).toBeLessThan(summary.tokensBefore);
    expect(summary.tokensAfter).toBeLessThanOrEqual(1000);
  });
});
```

### Integration Tests

```typescript
describe('Context Management Integration', () => {
  it('should handle large project within budget', async () => {
    const project = createLargeProject(); // 1000 files
    const context = await projectsManager.getProjectContextBudget('claude-sonnet-4-5-20250514');
    const tokens = estimateTokens(context);
    expect(tokens).toBeLessThanOrEqual(80000); // 40% of 200K
  });

  it('should compress session when needed', async () => {
    const session = createLongSession(); // 1000 messages
    const compressed = await sessionManager.manageSessionContext(session, budget);
    expect(compressed.messages.length).toBeLessThan(20);
  });
});
```

---

## Performance Considerations

### Caching Strategy

```typescript
interface CacheEntry {
  content: string;
  tokens: number;
  timestamp: number;
  hits: number;
}

class TokenCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize = 1000;

  get(key: string): number | null {
    const entry = this.cache.get(key);
    if (entry) {
      entry.hits++;
      return entry.tokens;
    }
    return null;
  }

  set(key: string, content: string): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    this.cache.set(key, {
      content,
      tokens: this.estimateTokens(content),
      timestamp: Date.now(),
      hits: 0,
    });
  }
}
```

### Async Processing

For very large files (>1MB):
- Process chunks asynchronously
- Stream chunks to API
- Use worker threads for token counting

---

## Monitoring & Metrics

### Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Compression ratio | >70% | <50% |
| Cache hit rate | >40% | <20% |
| Chunk relevance | >80% | <60% |
| Summary quality | >90% user satisfaction | <70% |

### Dashboard Display

```
Context Management Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Token Budget:     ████████░░ 160K / 200K (80% used)
Session Messages: █████░░░░░ 45 / 100 (compressed)
Project Files:    ████░░░░░░░ 120 / 500 (chunked)

Recent Compression:
  • Session "code-review": 500 messages → 15 (97% reduction)
  • Project "floyd-web": 500 files → 35 chunks (93% reduction)

Cache Performance:
  • Hit Rate: 42%
  • Evictions: 12
```

---

## Rollout Plan

### Phase 1: Alpha (Internal)
- Feature flag: `CONTEXT_MANAGEMENT=false`
- Manual testing with various project sizes
- Performance benchmarking

### Phase 2: Beta (Opt-in)
- Enable in settings: "Enable Context Management"
- Monitor metrics
- Gather user feedback

### Phase 3: Gradual Rollout
- Enable for 10% of users
- Monitor for issues
- Increase gradually

### Phase 4: Full Release
- Default enabled
- Option to disable in settings
- Documentation updated

---

## Success Metrics

| Metric | Baseline | Target | Deadline |
|--------|----------|--------|----------|
| Max file size | 100 KB | 1 MB | Phase 4 |
| Project files | 500 KB total | Unlimited (smart) | Phase 4 |
| Session messages | All kept | Compressed auto | Phase 3 |
| Token awareness | None | Full tracking | Phase 2 |
| Context errors | Frequent | <1% | Phase 4 |

---

## References

- [Claude Context Window Documentation](https://docs.anthropic.com/claude/docs)
- [Token Counting Best Practices](https://github.com/openai/tiktoken)
- Current implementation: `server/projects-manager.ts:33-34`

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-04 | Initial planning document | Floyd |
