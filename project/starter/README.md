# Enterprise Multi-Agent Code Review Orchestrator

Review GitHub pull requests with the Claude Agent SDK and save the results as JSON, Markdown, and HTML.

## Project Overview

This system uses multiple specialized AI agents working together to provide comprehensive code reviews:

- **Main Orchestrator** - Coordinates the review process and aggregates results
- **Code Quality Analyzer** - Identifies code smells, anti-patterns, and best practice violations
- **Test Coverage Analyzer** - Evaluates test completeness and suggests missing test cases
- **Refactoring Suggester** - Recommends architectural improvements and refactoring opportunities

## Project Components

- **Type Definitions** (`src/types/`) - Zod schemas for validation
- **Logger** (`src/utils/logger.ts`) - Winston structured logging
- **Report Generator** (`src/utils/report-generator.ts`) - Markdown/HTML/JSON report generation
- **Project Config** - `package.json`, `tsconfig.json`, `.env.example`
- **Tests** (`tests/`) - Unit tests and an opt-in live integration test
- **Review Skills** (`.claude/skills/`) - JavaScript best practices and TypeScript patterns

## Implementation

1. **Agent Definitions** (`src/agents/`)
   - Code Quality Analyzer
   - Test Coverage Analyzer
   - Refactoring Suggester

2. **Prompts** (`src/prompts/`)
   - Orchestrator prompt
   - Agent-specific prompts

3. **MCP Configuration** (`src/config/mcp.config.ts`)
   - GitHub MCP server
   - ESLint MCP server

4. **Orchestrator** (`src/orchestrator.ts`)
   - Main coordination logic
   - Agent spawning and result aggregation

5. **Main Entry Point** (`src/main.ts`)
   - CLI argument parsing
   - Environment validation
   - Report generation

6. **Error Handler** (Recommended) (`src/utils/error-handler.ts`)
   - Custom `ReviewError` class
   - Retry logic with exponential backoff
   - Timeout wrapper

7. **Rate Limiter** (Optional) (`src/utils/rate-limiter.ts`)
   - Sliding window for review requests and estimated tokens
   - Request and token tracking
   - Concurrent request management

The rate limiter counts one request and reserves 1,000 estimated tokens per PR review. The 60-second window and concurrency limit apply within one orchestrator instance. SDK calls within a review and actual provider token usage are outside this accounting.

## Getting Started

### Prerequisites

- Node.js 20.19+ on the 20.x line, 22.12+ on the 22.x line, or 24+ for the development and test commands
- Anthropic API access (provided in Vocareum workspace) or [your own API key](https://console.anthropic.com/)
- [GitHub Personal Access Token](https://github.com/settings/tokens) (recommended - scopes: `repo`, `read:org`)

### Installation

**In Vocareum Workspace (Recommended):**

Your workspace comes pre-configured with Anthropic API credentials.

```bash
cd /voc/work/cd14715-claude-code-classroom/project/starter
npm ci
cp .env.example .env
```

**Local Setup:**

```bash
# Clone the repository
git clone https://github.com/udacity/cd14715-claude-code-classroom.git
cd cd14715-claude-code-classroom/project/starter

# Install dependencies
npm ci

# Configure environment
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

**In Vocareum Workspace:**
```bash
# Leave the API key blank if Vocareum supplies it in the shell.
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=https://claude.vocareum.com

# Model Configuration (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Project root (REQUIRED)
PROJECT_ROOT=/voc/work/cd14715-claude-code-classroom/project/starter

# GitHub Token (RECOMMENDED for higher rate limits)
# GITHUB_TOKEN=ghp_your-token-here

# Logging level (optional)
LOG_LEVEL=info
```

**Local Setup with Your Own API Key:**
```bash
# Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_BASE_URL=

# Model Configuration (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Project root (REQUIRED - update to your path)
PROJECT_ROOT=/absolute/path/to/project/starter

# GitHub Token (RECOMMENDED)
# GITHUB_TOKEN=ghp_your-token-here

# Logging level (optional)
LOG_LEVEL=info
```

### Running

```bash
# Development mode
npm run dev -- <owner> <repo> <pr-number>

# Production build
npm run build
npm start -- <owner> <repo> <pr-number>

# Example
npm run dev -- facebook react 12345
```

The CLI shows progress on stderr as subagents finish. Each changed file has
three analyses. A terminal shows a progress bar. Redirected output shows plain
progress lines. When the review passes validation, the CLI prints the paths
of the three saved reports.

### Testing

```bash
# Run unit tests
npm test

# Run specific test
npm test -- orchestrator.test.ts

# Run the live integration test for octocat/Hello-World#1
RUN_LIVE_REVIEW=1 npm test -- tests/orchestrator.test.ts

# Watch mode
npm run test:watch
```

## Key Technologies

- **Claude Agent SDK** - Multi-agent orchestration framework
- **Model Context Protocol (MCP)** - External data integration
- **Zod** - Schema validation and type safety
- **TypeScript** - Type-safe development
- **Vitest** - Testing framework
- **Winston** - Structured logging

## Success Criteria

Before submission, verify that:

- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Unit tests pass: `npm test`
- [ ] The live integration test reviews `octocat/Hello-World#1` with configured credentials
- [ ] The three Udacity PRs each have a populated JSON, Markdown, and HTML report
- [ ] Each JSON report matches the original `ReviewReport` schema and the requested PR
- [ ] Markdown is readable and HTML renders correctly in a browser
- [ ] Errors are handled gracefully (Recommended)

## Resources

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Zod Documentation](https://zod.dev/)

## Submission Reports

Run these commands from this directory with the provider credentials and model configured.
Set `PROJECT_ROOT` to this directory when using the environment file. Set
`ANTHROPIC_BASE_URL=https://claude.vocareum.com` when using Vocareum. Leave
`ANTHROPIC_BASE_URL` blank to use the SDK's default Anthropic API endpoint.

```bash
npm run dev -- udacity cd14715-simple-todo-app 1
npm run dev -- udacity cd14715-simple-todo-app 2
npm run dev -- udacity cd14715-simple-todo-app 3
```

Submit the project with all nine Udacity reports in `reports/`:

| PR | File basename | Extensions |
| --- | --- | --- |
| 1 | `udacity_cd14715-simple-todo-app_1` | `.json`, `.md`, `.html` |
| 2 | `udacity_cd14715-simple-todo-app_2` | `.json`, `.md`, `.html` |
| 3 | `udacity_cd14715-simple-todo-app_3` | `.json`, `.md`, `.html` |

`reports/` is ignored by Git. Include the nine listed files explicitly if the
submission archive is built from tracked files. Keep local credentials in `.env`
and use `.env.example` in the submission.
