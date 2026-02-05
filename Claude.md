# Claude.md

Agent Operating Instructions for Floyd Desktop Repository

**Effective:** 2026-02-05
**Purpose:** Guide AI agents working on this codebase

---

## System Time Mandate

All timestamps MUST use the format: `YYYY-MM-DD HH:MM:SS TZ`

Example: `2026-02-05 00:30:00 EST`

---

## Repository Context

**Project:** Floyd Desktop - AI Assistant Web Application
**Location:** `/Volumes/Storage/FloydDesktopWeb-Standalone/`
**Tech Stack:** React + TypeScript + Vite (client), Express + TypeScript (server)

---

## Architecture Overview

### Client (`src/`)
- **React 18** with TypeScript
- **Vite** for build tooling and dev server
- **Tailwind CSS** with custom CRUSH theme
- **Radix UI** components
- React Markdown + Syntax Highlighting

### Server (`server/`)
- **Express** REST API
- **Anthropic SDK** for Claude integration
- **OpenAI SDK** for GPT models
- **MCP Client** for tool execution
- **WebSocket** server for Chrome extension

### Key Systems
- **Sessions:** Chat history stored in `.floyd-data/sessions/`
- **Settings:** User preferences in `.floyd-data/settings/`
- **Skills:** Extensible skill system in `server/skills-manager.ts`
- **Projects:** Project-based organization in `server/projects-manager.ts`
- **Tools:** MCP tool execution via `server/tool-executor.ts`

---

## Agent Guidelines

### Before Making Changes

1. **Read FLOYD.MD** - The governing document for this repository
2. **Check existing patterns** - Follow established code style
3. **Verify imports** - Use `@/` alias for src imports

### Code Conventions

- **TypeScript:** Strict mode enabled, no `any` types
- **Imports:** Use `@/` for src imports: `import { Foo } from '@/components/Foo'`
- **Components:** PascalCase for files and exports
- **Utilities:** camelCase for files and exports
- **Styles:** Use Tailwind classes, avoid inline styles

### File Organization

```
src/
├── components/     # React components
├── lib/           # Utilities and helpers
├── hooks/         # Custom React hooks
├── types/         # TypeScript type definitions
└── assets/        # Static assets
```

### Testing

- Run tests: `npm test`
- Run tests with UI: `npm run test:ui`
- E2E tests: `npx playwright test`

---

## Common Tasks

### Adding a New Component

```bash
# Create in appropriate directory
src/components/NewFeature.tsx
```

```typescript
// Use existing patterns
import { cn } from '@/lib/utils';

export function NewFeature({ className }: Props) {
  return (
    <div className={cn("base-styles", className)}>
      {/* ... */}
    </div>
  );
}
```

### Adding a New API Endpoint

```typescript
// Add to server/index.ts or create new route file
app.get('/api/endpoint', async (req, res) => {
  // ... handler
});
```

### Adding MCP Tools

Tools are configured in `server/mcp-client.ts`. See existing `BUILTIN_TOOLS` for patterns.

---

## Troubleshooting

### Build Issues
- Clear cache: `rm -rf .vite dist dist-server node_modules`
- Reinstall: `npm install`

### Port Conflicts
- Client default: `5173`
- Server default: `3001`
- Change in `vite.config.ts` or `server/index.ts`

### Environment Variables
- Copy `.env.local.example` to `.env.local`
- Never commit `.env.local`

---

## Compliance Checklist

Before completing any task:

- [ ] All timestamps use `YYYY-MM-DD HH:MM:SS TZ` format
- [ ] Files created in correct locations per FLOYD.MD
- [ ] No documentation in root (except permitted files)
- [ ] TypeScript strict mode compliance
- [ ] Tests pass locally

---

**End of Claude.md**
