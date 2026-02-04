# FLOYD.MD

**Purpose:** Sovereign governing document for the FLOYD repository. All agents MUST adhere to these directives.
**Effective:** 2026-01-27 06:11:36 EST
**Authority:** RepoGod - The Sovereign Architect

---

## PRIME DIRECTIVE: SYSTEM TIME MANDATE

### ALL Agents MUST Use System Time

Every agent, process, and automated system within the FLOYD repository **MUST** use system time for:
- Date/timestamps on ALL correspondence
- Date/timestamps on ALL logging
- Date/timestamps on ALL file creation/modification records
- Date/timestamps on ALL agent handoffs
- Date/timestamps on ALL status reports

### Required Format

All timestamps MUST include:
1. **Full ISO 8601 date**: `YYYY-MM-DD`
2. **Time with seconds**: `HH:MM:SS`
3. **Timezone indicator**: `TZ` (e.g., `EST`, `UTC`, `PST`)

**Format:** `YYYY-MM-DD HH:MM:SS TZ`

**Examples:**
- `2026-01-27 06:11:36 EST` (correct)
- `2026-01-27 06:11:36 -0500` (acceptable)
- `2026-01-27` (incomplete - forbidden)
- `Jan 27, 2026` (non-standard - forbidden)

### System Time Acquisition

**Bash:**
```bash
date +"%Y-%m-%d %H:%M:%S %Z"
```

**Node.js:**
```javascript
new Date().toLocaleString('en-US', {
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
}).replace(/\//g, '-')
```

**Python:**
```python
from datetime import datetime
now = datetime.now()
print(now.strftime("%Y-%m-%d %H:%M:%S %Z"))
```

---

## ROOT DIRECTORY SANITITY

### Permitted Root-Level Files

**ONLY** the following files are permitted in the repository root (`/Volumes/Storage/FLOYD_CLI/`):

| File | Purpose | Required |
|------|---------|----------|
| `FLOYD.MD` | This governing document | YES |
| `README.md` | Project overview for visitors | YES |
| `LICENSE` | Legal licensing information | YES |
| `Claude.md` | Agent operating instructions | YES |
| `.gitignore` | Git exclusion rules | YES |
| `package.json` | Root package manifest | YES |
| `package-lock.json` | Root lockfile | YES |

### Forbidden Root-Level Content

**FORBIDDEN** - The following MUST NOT exist in the repository root:

- Documentation files (move to `docs/`)
- Test files (move to appropriate `tests/` or `test/` directories)
- Temporary analysis files (move to `docs/analysis/` or delete)
- Agent work products (move to appropriate project directories)
- Personal notes (move to `docs/notes/` or delete)

**Violators will be moved without warning.**

---

## DOCUMENTATION ORGANIZATION

### Required Structure

```
/Volumes/Storage/FLOYD_CLI/
├── FLOYD.MD                    # This file (root governing document)
├── README.md                   # Project overview
├── LICENSE                     # Legal
├── Claude.md                   # Agent OS
├── docs/                       # ALL documentation
│   ├── specifications/         # Feature specifications
│   ├── architecture/           # System architecture docs
│   ├── api/                    # API documentation
│   ├── guides/                 # User and developer guides
│   ├── analysis/               # Analysis and reports
│   └── notes/                  # Reference notes
├── INK/                        # Floyd CLI project
├── floyd-wrapper-main/         # Floyd wrapper
├── FloydDesktopWeb/            # Desktop application
├── FloydChromeBuild/           # Chrome extension
├── mobile/                     # Mobile application
├── packages/                   # Shared packages
├── RepoGod/                    # RepoGod workspace
└── .floyd/                     # FLOYD operational directory
```

---

## AGENT COMPLIANCE

### Every Agent MUST:

1. **Before ANY output:** Check system time and apply proper timestamp
2. **Before ANY file creation:** Verify location compliance
3. **Before ANY logging:** Apply full timestamp format
4. **Before handoff:** Include timestamped status summary

### Compliance Checklist

- [ ] All logs have `YYYY-MM-DD HH:MM:SS TZ` timestamps
- [ ] All correspondence is timestamped
- [ ] No documentation in root (except permitted files)
- [ ] All files organized per structure above

---

## VIOLATION PROTOCOL

### First Violation

- File moved to correct location
- Agent warned
- Incident logged to `.floyd/logs/compliance.log`

### Second Violation

- Agent dismissed
- Work rolled back
- New agent spawned with fresh context

---

## VERSION HISTORY

| Date | Change | Agent |
|------|--------|-------|
| 2026-01-27 06:11:36 EST | Initial creation - System Time Mandate + Root Directory Sanity | RepoGod |

---

**End of FLOYD.MD**
