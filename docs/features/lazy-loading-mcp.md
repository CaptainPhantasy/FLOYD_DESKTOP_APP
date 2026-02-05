# Lazy Loading MCP Feature

**Status:** Planning
**Priority:** High
**Estimate:** 3-5 days
**Created:** 2026-02-04

---

## Overview

Add lazy loading for MCP (Model Context Protocol) tools to reduce token usage by up to 95%, matching Claude Desktop's capability. Currently, all 40+ BUILTIN_TOOLS are sent in every API request, consuming significant context even when most tools aren't needed.

**Reference:** Claude Desktop's MCP tool search feature enables on-demand tool loading, dramatically reducing context usage.

---

## Problem Statement

### Current State
```typescript
// server/index.ts:1170-1176
function getAnthropicTools(): Anthropic.Tool[] {
  return BUILTIN_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as {...},
  })) as Anthropic.Tool[];
}
```

- **40 tools** sent in EVERY API request
- Each tool schema includes: name (20-50 chars), description (50-200 chars), inputSchema (200-1000 chars)
- **Estimated context per request:** ~15,000-25,000 tokens for tool definitions alone
- Tools like `dependency_xray`, `tui_puppeteer`, `skill_crystallizer` rarely used but always included

### Impact
| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Tool context tokens | ~20,000 | ~1,000 | **95% reduction** |
| API request cost | Higher | Lower | Significant savings |
| Max tokens available for response | Reduced | Increased | More room for actual content |

---

## Proposed Solution

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Request                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Tool Selection Layer                       │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐│
│  │ Always Included│  │ On-Demand      │  │ User Selected  ││
│  │ (5-10 tools)   │  │ (via search)   │  │ (preferences)  ││
│  └────────────────┘  └────────────────┘  └────────────────┘│
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Tool Registry + Cache                      │
│  • Tool categories                                           │
│  • Usage statistics                                         │
│  • Relevance scoring                                         │
│  • Recently used tracking                                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Tool Registry (`server/tool-registry.ts`)

```typescript
interface ToolMetadata {
  name: string;
  category: ToolCategory;
  keywords: string[];
  alwaysInclude: boolean;  // Core tools always sent
  usageCount: number;
  lastUsed: number;
  estimatedTokens: number;
}

enum ToolCategory {
  FILESYSTEM = 'filesystem',
  COMMAND = 'command',
  PROCESS = 'process',
  CODE = 'code',
  EXPLORER = 'explorer',
  NOVEL = 'novel',
  MEMORY = 'memory',
  BROWSER = 'browser',
}
```

#### 2. Tool Selector (`server/tool-selector.ts`)

```typescript
class ToolSelector {
  // Select tools based on conversation context
  async selectTools(
    message: string,
    conversationHistory: Message[],
    userPreferences: ToolPreferences
  ): Promise<MCPTool[]>;

  // Semantic search for relevant tools
  private searchTools(query: string): MCPTool[];

  // Always include core tools
  private getCoreTools(): MCPTool[];
}
```

#### 3. Enhanced API Routes

```typescript
// New endpoint: Tool search
app.get('/api/tools/search', (req, res) => {
  const { query } = req.query;
  const results = toolSelector.searchTools(query as string);
  res.json({ tools: results });
});

// Updated chat endpoint with lazy loading
app.post('/api/chat/stream', async (req, res) => {
  const { sessionId, message, toolSelection = 'auto' } = req.body;

  // Auto-select tools based on message content
  const selectedTools = await toolSelector.selectTools(
    message,
    session.messages,
    settings.toolPreferences
  );

  // Use selected tools instead of all tools
  const tools = getAnthropicTools(selectedTools);
  // ...
});
```

#### 4. Frontend Tool Search UI

```typescript
// src/components/ToolSearchPanel.tsx
interface ToolSearchPanelProps {
  onToolsSelected: (tools: string[]) => void;
  currentTools: string[];
}

// Shows:
// - Search box for tool discovery
// - Tool categories with expand/collapse
// - Usage statistics
// - "Always include" toggles per tool
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Day 1)

**File: `server/tool-registry.ts`** (NEW)

```typescript
export class ToolRegistry {
  private tools: Map<string, ToolMetadata>;

  constructor() {
    this.tools = new Map();
    this.initializeFromBuiltinTools();
  }

  private initializeFromBuiltinTools(): void {
    // Core tools - always include
    this.setAlwaysInclude([
      'read_file',
      'write_file',
      'list_directory',
      'execute_command',
      'search_files',
    ]);

    // Category assignments
    this.setCategory('project_map', ToolCategory.EXPLORER);
    this.setCategory('semantic_search', ToolCategory.EXPLORER);
    // ... etc

    // Keyword assignments for search
    this.setKeywords('dependency_xray', ['npm', 'package', 'node_modules', 'source']);
    this.setKeywords('tui_puppeteer', ['terminal', 'interactive', 'keystrokes']);
    // ... etc
  }

  getTools(criteria: ToolSelectionCriteria): MCPTool[] {
    // Return tools matching criteria
  }

  updateUsage(toolName: string): void {
    // Track when tool was used
  }
}
```

**Tasks:**
1. Create `ToolRegistry` class
2. Define `ToolMetadata` interface
3. Populate registry with all 40 BUILTIN_TOOLS
4. Implement `getTools()` with filtering

**Success Criteria:**
- ToolRegistry can be instantiated
- All 40 tools registered with metadata
- Filtered retrieval works

---

### Phase 2: Tool Selection Logic (Day 1-2)

**File: `server/tool-selector.ts`** (NEW)

```typescript
export class ToolSelector {
  constructor(
    private registry: ToolRegistry,
    private cache: ToolSelectionCache
  ) {}

  async selectTools(
    message: string,
    context: SelectionContext
  ): Promise<ToolSelection> {
    // 1. Start with core tools
    let tools = this.registry.getCoreTools();

    // 2. Check cache for recent patterns
    const cached = await this.cache.lookup(message);
    if (cached) {
      tools = [...tools, ...cached.additionalTools];
      return { tools, source: 'cache' };
    }

    // 3. Semantic search for relevant tools
    const relevant = this.searchTools(message);
    tools = [...tools, ...relevant];

    // 4. Apply user preferences
    tools = this.applyPreferences(tools, context.preferences);

    return { tools, source: 'computed' };
  }

  private searchTools(query: string): MCPTool[] {
    // Keyword matching
    // Category inference
    // Recent usage boost
  }
}
```

**Tasks:**
1. Create `ToolSelector` class
2. Implement semantic keyword search
3. Add cache layer for tool selections
4. Implement category-based inclusion rules

**Success Criteria:**
- Can select tools based on message content
- Returns core tools + relevant extras
- Cache hit/miss tracking works

---

### Phase 3: API Integration (Day 2)

**File: `server/index.ts`** (MODIFY)

```typescript
// Add tool selection to chat stream
app.post('/api/chat/stream', async (req, res) => {
  const { sessionId, message, toolSelection, explicitTools } = req.body;

  // Determine which tools to include
  let selectedTools: MCPTool[];

  if (explicitTools && explicitTools.length > 0) {
    // User explicitly selected tools
    selectedTools = BUILTIN_TOOLS.filter(t => explicitTools.includes(t.name));
  } else if (toolSelection === 'all') {
    // Legacy behavior - all tools
    selectedTools = [...BUILTIN_TOOLS];
  } else {
    // Auto-select based on message
    const selection = await toolSelector.selectTools(
      message,
      { sessionId, history: session.messages }
    );
    selectedTools = selection.tools;
  }

  // Convert selected tools to provider format
  const anthropicTools = selectedTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  console.log(`[Chat] Using ${anthropicTools.length} tools (was ${BUILTIN_TOOLS.length})`);
  // ... rest of streaming logic
});
```

**Tasks:**
1. Add tool selection to `/api/chat/stream`
2. Add `/api/tools/search` endpoint
3. Add `/api/tools/categories` endpoint
4. Add `/api/tools/preferences` GET/PUT endpoints

**Success Criteria:**
- Chat works with reduced tool set
- API endpoints return correct data
- Console logging shows tool count reduction

---

### Phase 4: Frontend UI (Day 2-3)

**File: `src/components/ToolSearchPanel.tsx`** (NEW)

```typescript
export function ToolSearchPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());

  return (
    <div className="tool-search-panel">
      {/* Search input */}
      <input
        type="text"
        placeholder="Search tools (e.g., 'browser', 'git', 'database')..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {/* Category sections */}
      {categories.map(cat => (
        <ToolCategorySection
          key={cat.name}
          category={cat}
          selectedTools={selectedTools}
          onToggle={(tool) => toggleTool(tool)}
        />
      ))}

      {/* Stats */}
      <div className="tool-stats">
        {selectedTools.size} tools selected (~{estimateTokens(selectedTools)} tokens)
      </div>
    </div>
  );
}
```

**File: `src/components/SettingsModal.tsx`** (MODIFY)

Add "Tool Selection" tab with:
- Auto vs Manual selection mode
- Per-tool "always include" toggles
- Usage statistics display

**Tasks:**
1. Create ToolSearchPanel component
2. Integrate into Settings modal
3. Add tool selection to chat UI
4. Show token savings indicator

**Success Criteria:**
- Can search and select tools
- Selection persists across sessions
- UI shows estimated token usage

---

### Phase 5: Caching & Optimization (Day 3)

**File: `server/tool-cache.ts`** (NEW)

```typescript
export class ToolSelectionCache {
  private cache: Map<string, CachedToolSelection>;

  async lookup(message: string): Promise<CachedToolSelection | null> {
    // Simple similarity matching
    for (const [key, value] of this.cache) {
      if (this.similarity(message, key) > 0.8) {
        value.hits++;
        return value;
      }
    }
    return null;
  }

  store(message: string, selection: ToolSelection): void {
    this.cache.set(message, {
      tools: selection.tools,
      timestamp: Date.now(),
      hits: 0,
    });
  }

  private similarity(a: string, b: string): number {
    // Levenshtein or similar
  }
}
```

**Tasks:**
1. Implement LRU cache for tool selections
2. Add similarity-based cache lookup
3. Track cache hit rate
4. Add cache statistics to monitoring

**Success Criteria:**
- Cache reduces redundant selections
- Hit rate > 30% on repeated patterns
- Cache size stays bounded

---

### Phase 6: Testing & Validation (Day 4)

**Test Scenarios:**

| Scenario | Expected Tools | Token Reduction |
|----------|----------------|-----------------|
| "Read package.json" | read_file only | ~95% |
| "List all files" | list_directory only | ~95% |
| "Run npm install" | execute_command only | ~95% |
| "Search for TODOs" | search_files, todo_sniper | ~90% |
| "Full refactoring" | Multiple explorer tools | ~60% |
| Browser automation | All browser tools | ~85% |

**Tasks:**
1. Unit tests for ToolSelector
2. Integration tests for API endpoints
3. Token usage measurement tests
4. Frontend component tests

**Success Criteria:**
- All tests pass
- Measured token savings match expectations
- No regressions in existing functionality

---

## File Changes Summary

### New Files
| File | Purpose | LOC (est) |
|------|---------|-----------|
| `server/tool-registry.ts` | Tool metadata & categorization | ~200 |
| `server/tool-selector.ts` | Selection logic & search | ~250 |
| `server/tool-cache.ts` | Caching layer | ~150 |
| `src/components/ToolSearchPanel.tsx` | UI for tool selection | ~180 |
| `src/types/tools.ts` | Tool-related TypeScript interfaces | ~50 |

### Modified Files
| File | Changes | Lines |
|------|---------|-------|
| `server/index.ts` | Add tool selection to chat endpoint, new API routes | +100 |
| `src/components/SettingsModal.tsx` | Add Tool Selection tab | +80 |
| `src/types/index.ts` | Add tool selection types | +20 |

**Total:** ~1,030 lines of new/modified code

---

## Configuration Options

### User Preferences (`.floyd-data/settings.json`)

```json
{
  "toolSelection": {
    "mode": "auto",  // "auto" | "manual" | "all"
    "alwaysInclude": ["read_file", "write_file"],
    "neverInclude": ["tui_puppeteer"],
    "categories": {
      "explorer": "on-demand",  // "always" | "on-demand" | "never"
      "browser": "on-demand",
      "novel": "on-demand"
    },
    "maxTools": 15,
    "tokenThreshold": 50000
  }
}
```

### Environment Variables

```bash
# Enable/disable lazy loading
FLOYD_LAZY_TOOLS=true

# Default maximum tools to include
FLOYD_MAX_TOOLS=15

# Cache size for tool selections
FLOYD_TOOL_CACHE_SIZE=100
```

---

## Monitoring & Metrics

### Key Metrics to Track

```typescript
interface ToolSelectionMetrics {
  totalRequests: number;
  averageToolsUsed: number;
  cacheHitRate: number;
  tokenSavings: number;
  toolsByCategory: Record<ToolCategory, number>;
  mostUsedTools: Array<{ tool: string; count: number }>;
}
```

### Dashboard Display

Add to Floyd UI:
- **Tools in current request:** X / 40
- **Tokens saved:** ~Y (Z%)
- **Cache hit rate:** A%

---

## Rollout Plan

### Phase 1: Silent Launch (Opt-in)
- Feature disabled by default
- Users opt-in via settings
- Monitor metrics for 1 week

### Phase 2: Beta Release (Opt-out)
- Enabled for beta testers
- "Use all tools" fallback available
- Gather user feedback

### Phase 3: Full Release
- Lazy loading enabled by default
- "Use all tools" available in settings
- Documentation updated

---

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Avg tools per request | 40 | 5-10 |
| Tool context tokens | ~20,000 | ~2,000 |
| Cache hit rate | 0% | >30% |
| User satisfaction | N/A | >90% prefer lazy mode |
| API cost reduction | 0% | >70% |

---

## Open Questions

1. **Tool Discovery:** How to handle when AI needs a tool not in selection?
   - *Option A:* Mid-request tool fetch (complex)
   - *Option B:* Error with suggestion to retry (simpler)
   - *Recommendation:* Option B initially

2. **Multi-turn Conversations:** Should tool selection persist across turns?
   - *Decision:* Yes, with timeout after 5 minutes of inactivity

3. **Browork Agents:** Do sub-agents get their own tool selection?
   - *Decision:* Yes, per-task tool selection

---

## References

- [Claude Desktop MCP Tool Search](https://www.theregister.com/2026/01/26/claude_mcp_apps_arrives/)
- [50+ Best MCP Servers for Claude Code](https://claudefa.st/blog/tools/mcp-extensions/best-addons)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- Current implementation: `server/mcp-client.ts:168-649`

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-04 | Initial planning document | Floyd |
