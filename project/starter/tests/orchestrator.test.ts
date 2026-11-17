import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { CodeReviewOrchestrator } from '../src/orchestrator.js';
import { ReportGenerator } from '../src/utils/report-generator.js';
import { ReviewReportSchema } from '../src/types/report-types.js';
import { report } from './fixture.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: vi.fn()
}));

describe('CodeReviewOrchestrator', () => {
  it('accepts a custom rate limit', () => {
    expect(new CodeReviewOrchestrator({ rateLimits: { maxConcurrent: 1 } })).toBeInstanceOf(CodeReviewOrchestrator);
  });

  function mockReview(
    structuredOutput: unknown,
    files = report.fileReviews.map(entry => entry.file),
    skipDelegation?: { file: string; agent: string; recover?: boolean }
  ) {
    vi.stubEnv('ANTHROPIC_MODEL', 'test-model');
    vi.stubEnv('PROJECT_ROOT', process.cwd());
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
    vi.mocked(query).mockImplementation(({ options, prompt }) => {
      async function* events(config: Options) {
        const hook = config.hooks?.PostToolUse?.[0]?.hooks[0];
        expect(hook).toBeDefined();
        const checkPermission = config.hooks?.PreToolUse?.[0]?.hooks[0];
        expect(checkPermission).toBeDefined();
        const checkTask = (file: string) => checkPermission!({
          hook_event_name: 'PreToolUse', tool_name: 'Task',
          tool_input: { subagent_type: 'code-quality-analyzer', prompt: `File: ${file}` },
          tool_use_id: 'test-task', cwd: process.cwd(), session_id: '', transcript_path: ''
        }, undefined, { signal: new AbortController().signal });
        const sendResult = (tool_name: string, tool_input: unknown, tool_response: unknown) => hook!({
          hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response,
          tool_use_id: 'test-call', cwd: process.cwd(), session_id: '', transcript_path: ''
        }, undefined, { signal: new AbortController().signal });
        function* taskBatch(file: string, names: string[]) {
          const calls = names.map(agent => ({
            type: 'tool_use', name: 'Task', id: `${file}:${agent}`,
            input: { subagent_type: agent, prompt: `File: ${file}\nAnalyze this file.` }
          }));
          yield { type: 'assistant', parent_tool_use_id: null, message: { content: calls } };
          for (const call of calls.reverse()) {
            yield {
              type: 'user', parent_tool_use_id: null,
              message: { content: [{ type: 'tool_result', tool_use_id: call.id }] }
            };
          }
        }
        if (config.resume) {
          expect(config.resume).toBe('review-session');
          expect(skipDelegation).toBeDefined();
          if (typeof prompt === 'string') throw new Error('Expected streaming input');
          for await (const message of prompt) {
            expect(message.message.content).toContain(JSON.stringify({
              file: skipDelegation!.file,
              agent: skipDelegation!.agent,
              firstPromptLine: `File: ${skipDelegation!.file}`
            }));
          }
          if (skipDelegation?.recover) {
            yield* taskBatch(skipDelegation.file, [skipDelegation.agent]);
          }
          yield { type: 'result', subtype: 'success', is_error: false, structured_output: structuredOutput };
          return;
        }
        await sendResult('mcp__github__get_pull_request', {}, {});
        await expect(checkTask(files[0]!)).resolves.toMatchObject({
          hookSpecificOutput: { permissionDecision: 'deny' }
        });
        await sendResult('mcp__github__get_pull_request_files', {}, {
          content: [{ type: 'text', text: JSON.stringify(files.map(filename => ({ filename }))) }]
        });
        await expect(checkTask(files[0]!)).resolves.toEqual({});
        for (const file of files) {
          const names = Object.keys(config.agents ?? {})
            .filter(agent => skipDelegation?.file !== file || skipDelegation.agent !== agent);
          yield* taskBatch(file, names);
        }
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'review-session', structured_output: structuredOutput };
      }
      return events(options!) as unknown as ReturnType<typeof query>;
    });
  }

  it('configures the MCP tools and returns a report in the original schema', async () => {
    mockReview(report);
    const onProgress = vi.fn();
    try {
      const result = await new CodeReviewOrchestrator({ onProgress }).reviewPullRequest('octocat', 'Hello-World', 1);
      expect(result.fileReviews).toEqual(report.fileReviews);
      expect(result.summary).toEqual(report.summary);
      expect(onProgress.mock.calls.map(([progress]) => [progress.completed, progress.total]))
        .toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
      expect(onProgress.mock.calls.slice(1).map(([progress]) => progress.analysis.agent).sort())
        .toEqual(['code-quality-analyzer', 'refactoring-suggester', 'test-coverage-analyzer']);
      const options = vi.mocked(query).mock.lastCall?.[0].options;
      expect(options?.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
      expect(options).toMatchObject({
        model: 'test-model',
        maxTurns: 35,
        permissionMode: 'dontAsk',
        outputFormat: { type: 'json_schema', schema: expect.any(Object) },
        mcpServers: { github: expect.any(Object), eslint: expect.any(Object) },
        allowedTools: expect.arrayContaining(['Task']),
        agents: {
          'code-quality-analyzer': expect.any(Object),
          'test-coverage-analyzer': expect.any(Object),
          'refactoring-suggester': expect.any(Object)
        }
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects invalid structured output', async () => {
    mockReview({ ...report, fileReviews: undefined });
    try {
      await expect(new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1))
        .rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_FAILED' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('requires every subagent to complete for each changed file', async () => {
    const file = 'src/other.js';
    mockReview(report, [report.fileReviews[0]!.file, file], { file, agent: 'refactoring-suggester' });
    try {
      await expect(new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1))
        .rejects.toMatchObject({ code: 'AGENT_FAILED', message: expect.stringContaining(`${file}: refactoring-suggester`) });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('resumes the same review to finish a missing documentation delegation', async () => {
    const file = 'README';
    const entry = report.fileReviews[0]!;
    const documentationReport = {
      ...report,
      fileReviews: [{
        file,
        codeQuality: { ...entry.codeQuality, file },
        testCoverage: { ...entry.testCoverage, file },
        refactorings: { ...entry.refactorings, file }
      }]
    };
    mockReview(documentationReport, [file], { file, agent: 'test-coverage-analyzer', recover: true });
    const callsBefore = vi.mocked(query).mock.calls.length;
    try {
      const result = await new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1);
      expect(result.fileReviews).toEqual(documentationReport.fileReviews);
      expect(vi.mocked(query).mock.calls.slice(callsBefore).map(([call]) => call.options?.resume))
        .toEqual([undefined, 'review-session']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects a structurally valid report that omits a changed file', async () => {
    mockReview(report, [report.fileReviews[0]!.file, 'src/other.js']);
    try {
      await expect(new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1))
        .rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_FAILED' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

it.runIf(process.env.RUN_LIVE_REVIEW === '1')('reviews a real public PR', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>('@anthropic-ai/claude-agent-sdk');
  vi.mocked(query).mockImplementation(actual.query);
  const live = await new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1);
  expect(live.pullRequest.number).toBe(1);
  expect(live.fileReviews.length).toBeGreaterThan(0);
  const generator = new ReportGenerator();
  expect(ReviewReportSchema.safeParse(JSON.parse(generator.generateJSONReport(live))).success).toBe(true);
  expect(generator.generateMarkdownReport(live)).toContain('Code Review Report');
  expect(generator.generateHTMLReport(live)).toContain('<html');
}, 620000);
