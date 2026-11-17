import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createSdkMcpServer, query, tool, type HookCallback, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { agents } from './agents/index.js';
import { eslintTools, githubTools, mcpServersConfig } from './config/mcp.config.js';
import { orchestratorPrompt } from './prompts/index.js';
import { ReviewReportJSONSchema, ReviewReportSchema, type ReviewReport } from './types/report-types.js';
import { ErrorCodes, ReviewError, withRetry, withTimeout } from './utils/error-handler.js';
import { RateLimiter, withRateLimit, type RateLimiterConfig } from './utils/rate-limiter.js';

export interface OrchestratorOptions {
  rateLimits?: Partial<RateLimiterConfig>;
  timeoutMs?: number;
  onProgress?: (progress: ReviewProgress) => void;
}

export interface ReviewProgress {
  completed: number;
  total: number;
  analysis?: { file: string; agent: string };
}

const changedFileListSchema = z.array(z.object({ filename: z.string().min(1) }));
const mcpTextSchema = z.tuple([z.object({ type: z.literal('text'), text: z.string() })]);
const reviewSkills = ['javascript-best-practices', 'typescript-patterns'];

function readChangedFiles(response: unknown): Set<string> | undefined {
  const envelope = z.object({ content: z.unknown() }).safeParse(response);
  const payload = envelope.success ? envelope.data.content : response;
  const blocks = mcpTextSchema.safeParse(payload);
  let files = blocks.success ? blocks.data[0].text : payload;
  if (typeof files === 'string') {
    try {
      files = JSON.parse(files) as unknown;
    } catch {
      return undefined;
    }
  }
  const parsed = changedFileListSchema.safeParse(files);
  return parsed.success ? new Set(parsed.data.map(file => file.filename)) : undefined;
}

function taskFile(prompt: unknown): string | undefined {
  return typeof prompt === 'string' ? /^File: ([^\r\n]+)/.exec(prompt)?.[1] : undefined;
}

export class CodeReviewOrchestrator {
  private readonly rateLimiter: RateLimiter;

  constructor(private readonly options: OrchestratorOptions = {}) {
    this.rateLimiter = new RateLimiter(options.rateLimits);
  }

  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..' ||
        !Number.isSafeInteger(prNumber) || prNumber < 1) {
      throw new ReviewError('Enter a valid GitHub repository and positive PR number.', ErrorCodes.INVALID_CONFIG);
    }
    const model = process.env.ANTHROPIC_MODEL?.trim();
    if (!model) {
      throw new ReviewError('Set ANTHROPIC_MODEL before reviewing a PR.', ErrorCodes.INVALID_CONFIG);
    }

    const cwd = process.env.PROJECT_ROOT?.trim() || process.cwd();
    if (!isAbsolute(cwd)) {
      throw new ReviewError('Set PROJECT_ROOT to the absolute path of v2.', ErrorCodes.INVALID_CONFIG);
    }
    await Promise.all(reviewSkills.map(skill =>
      access(join(cwd, '.claude', 'skills', skill, 'SKILL.md')).catch(() => {
        throw new ReviewError(`PROJECT_ROOT must contain .claude/skills/${skill}/SKILL.md.`, ErrorCodes.INVALID_CONFIG);
      })
    ));
    const directory = await mkdtemp(join(cwd, '.review-'));
    const stagedFiles = new Set<string>();
    const stage = tool('stage_javascript', 'Stage JavaScript from the target PR for static linting.', {
      source: z.string().max(150000)
    }, async ({ source }) => {
      if (stagedFiles.size >= 40) {
        return { isError: true, content: [{ type: 'text', text: 'The review has reached its lint file limit.' }] };
      }
      const file = join(directory, `source-${stagedFiles.size}.js`);
      stagedFiles.add(file);
      await writeFile(file, source, { flag: 'wx', mode: 0o600 });
      return { content: [{ type: 'text', text: file }] };
    });
    const stageTool = 'mcp__review__stage_javascript';
    const agentTools = ['Task', 'Agent'];
    const prMetadataTool = githubTools[0]!;
    const prFilesTool = githubTools[1]!;
    const prTools = [prMetadataTool, prFilesTool];
    const target = { owner, repo, prNumber };
    const onProgress = this.options.onProgress;
    const agentCount = Object.keys(agents).length;

    try {
      // One review counts as one request and reserves 1,000 estimated tokens.
      // SDK calls inside the review, including subagent calls and retries,
      // share that slot. Provider requests and actual tokens are not metered here.
      return await withRateLimit(this.rateLimiter, async () => {
        const result = await withRetry(async () => {
          const abortController = new AbortController();
          const completed = new Set<string>();
          let changedFiles: Set<string> | undefined;
          const delegated = new Map<string, Set<string>>();
          let completedAnalyses = 0;
          const restrict: HookCallback = async event => {
            if (event.hook_event_name !== 'PreToolUse') return {};
            const name = event.tool_name;
            const input = event.tool_input as Record<string, unknown>;
            let allowed = name === 'StructuredOutput' || name === stageTool;
            if (name === 'Skill') allowed = typeof input.skill === 'string' && reviewSkills.includes(input.skill);
            if (agentTools.includes(name)) {
              const file = taskFile(input.prompt);
              allowed = typeof input.subagent_type === 'string' && Object.hasOwn(agents, input.subagent_type) &&
                input.run_in_background !== true && completed.has(prMetadataTool) &&
                file !== undefined && changedFiles?.has(file) === true;
            }
            if (githubTools.includes(name)) {
              allowed = input.owner === owner && input.repo === repo && (prTools.includes(name)
                ? input.pull_number === prNumber
                : typeof input.path === 'string' && input.path.split('/').every(part =>
                  part !== '.' && part !== '..' && /^[\p{L}\p{N} ._+@()-]+$/u.test(part)) &&
                  typeof input.branch === 'string' && /^[a-f0-9]{40}$/i.test(input.branch));
            }
            if (eslintTools.includes(name)) {
              allowed = Array.isArray(input.filePaths) && input.filePaths.length > 0 &&
                input.filePaths.every(path => typeof path === 'string' && stagedFiles.has(path));
            }
            if (allowed) return {};
            return { hookSpecificOutput: {
              hookEventName: 'PreToolUse', permissionDecision: 'deny',
              permissionDecisionReason: 'Tool call is outside the read-only PR review scope.'
            } };
          };

          const record: HookCallback = async event => {
            if (event.hook_event_name !== 'PostToolUse') return {};
            const response = event.tool_response as { isError?: boolean; is_error?: boolean } | undefined;
            if (response?.isError || response?.is_error) return {};
            if (event.tool_name === prFilesTool) {
              const firstFileList = changedFiles === undefined;
              changedFiles = readChangedFiles(event.tool_response);
              if (changedFiles) {
                completedAnalyses = [...changedFiles].reduce((count, file) => count + (delegated.get(file)?.size ?? 0), 0);
              }
              if (firstFileList && changedFiles) {
                onProgress?.({ completed: completedAnalyses, total: changedFiles.size * agentCount });
              }
            }
            completed.add(event.tool_name);
            return {};
          };

          async function* prompt(content: string): AsyncGenerator<SDKUserMessage> {
            yield {
              type: 'user', session_id: '', parent_tool_use_id: null,
              message: { role: 'user', content }
            };
          }

          const options: Options = {
            cwd, model, abortController, agents, maxTurns: 35,
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              USERPROFILE: process.env.USERPROFILE,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY?.trim(),
              ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL?.trim() || undefined
            },
            systemPrompt: orchestratorPrompt, settingSources: ['project'],
            strictMcpConfig: true, permissionMode: 'dontAsk',
            allowedTools: ['Skill', ...agentTools, ...githubTools, ...eslintTools, stageTool],
            hooks: {
              PreToolUse: [{ hooks: [restrict] }],
              PostToolUse: [{ hooks: [record] }]
            },
            outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema }
          };

          async function runReview(content: string, resume?: string) {
            const mcpServers = { ...mcpServersConfig, review: createSdkMcpServer({ name: 'review', tools: [stage] }) };
            const pendingTasks = new Map<string, { file: string; agent: string }>();
            for await (const event of query({ prompt: prompt(content), options: { ...options, mcpServers, resume } })) {
              if (event.type === 'result') return event;
              if (event.type === 'assistant' && event.parent_tool_use_id === null) {
                for (const block of event.message.content) {
                  if (block.type !== 'tool_use' || !agentTools.includes(block.name)) continue;
                  const input = block.input as { subagent_type?: unknown; prompt?: unknown };
                  const file = taskFile(input.prompt);
                  const agent = input.subagent_type;
                  if (file && typeof agent === 'string' && Object.hasOwn(agents, agent)) {
                    pendingTasks.set(block.id, { file, agent });
                  }
                }
              }
              if (event.type === 'user' && event.parent_tool_use_id === null && Array.isArray(event.message.content)) {
                for (const block of event.message.content) {
                  if (block.type !== 'tool_result') continue;
                  const task = pendingTasks.get(block.tool_use_id);
                  pendingTasks.delete(block.tool_use_id);
                  if (!task || block.is_error || !changedFiles?.has(task.file)) continue;
                  const fileAgents = delegated.get(task.file) ?? new Set<string>();
                  if (fileAgents.has(task.agent)) continue;
                  fileAgents.add(task.agent);
                  delegated.set(task.file, fileAgents);
                  completedAnalyses++;
                  onProgress?.({ completed: completedAnalyses, total: changedFiles.size * agentCount, analysis: task });
                }
              }
            }
            throw new ReviewError('Claude returned no review result.', ErrorCodes.AGENT_FAILED);
          }

          const started = Date.now();
          try {
            return await withTimeout(async () => {
              let event = await runReview(`Review ${JSON.stringify(target)}.`);
              if (event.subtype !== 'success' || event.is_error) {
                throw new ReviewError(`Claude review failed: ${event.subtype}.`, ErrorCodes.AGENT_FAILED);
              }
              if (!completed.has(prMetadataTool) || !changedFiles) {
                throw new ReviewError('GitHub PR metadata or changed files were not retrieved.', ErrorCodes.AGENT_FAILED);
              }
              const filesToReview = changedFiles;
              const missingDelegations = () => [...filesToReview].flatMap(file => Object.keys(agents)
                .filter(agent => !delegated.get(file)?.has(agent))
                .map(agent => ({ file, agent, firstPromptLine: `File: ${file}` })));

              let missing = missingDelegations();
              if (missing.length && event.session_id) {
                event = await runReview(
                  'Complete these missing delegations using the Task tool, including for documentation files. Batch independent calls together. ' +
                  'Use firstPromptLine verbatim as the first line of each Task prompt. ' +
                  'Reuse the PR context and successful analyses from this session and return the complete ReviewReport. ' +
                  JSON.stringify(missing),
                  event.session_id
                );
                if (event.subtype !== 'success' || event.is_error) {
                  throw new ReviewError(`Claude review recovery failed: ${event.subtype}.`, ErrorCodes.AGENT_FAILED);
                }
                missing = missingDelegations();
              }
              if (missing.length) {
                const details = missing.map(({ file, agent }) => `${file}: ${agent}`).join(', ');
                throw new ReviewError(`Missing delegated analyses: ${details}.`, ErrorCodes.AGENT_FAILED);
              }
              const parsed = ReviewReportSchema.safeParse(event.structured_output);
              const pr = parsed.success ? parsed.data.pullRequest : undefined;
              if (!parsed.success || pr?.owner?.toLowerCase() !== owner.toLowerCase() ||
                  pr.repo.toLowerCase() !== repo.toLowerCase() || pr.number !== prNumber) {
                throw new ReviewError('The structured review does not match the original ReviewReport schema or PR identity.', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
              }
              const result = parsed.data;
              const files = result.fileReviews;
              const reportedFiles = new Set(files.map(entry => entry.file));
              if (reportedFiles.size !== files.length || reportedFiles.size !== filesToReview.size ||
                  files.some(({ file, codeQuality, testCoverage, refactorings }) =>
                    !filesToReview.has(file) || codeQuality.file !== file ||
                    testCoverage.file !== file || refactorings.file !== file)) {
                throw new ReviewError('The report must contain exactly one matching analysis entry per changed file.', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
              }
              result.summary = {
                totalFiles: files.length,
                overallScore: files.length ? Math.round(files.reduce((sum, file) => sum + file.codeQuality.overallScore, 0) / files.length) : 0,
                criticalIssues: files.reduce((sum, file) => sum + file.codeQuality.issues.filter(issue => issue.severity === 'critical').length, 0),
                highPriorityTests: files.reduce((sum, file) => sum + file.testCoverage.untestedPaths.filter(test => test.priority === 'high' || test.priority === 'critical').length, 0),
                refactoringOpportunities: files.reduce((sum, file) => sum + file.refactorings.suggestions.length, 0)
              };
              result.metadata = {
                analyzedAt: new Date().toISOString(), duration: Date.now() - started,
                agentVersions: Object.fromEntries(Object.keys(agents).map(name => [name, model]))
              };
              return result;
            }, this.options.timeoutMs ?? 600000, 'The PR review timed out.');
          } catch (error) {
            // A failed model result needs a clear error. Retry transport errors only.
            if (error instanceof ReviewError) return error;
            throw error;
          } finally {
            abortController.abort();
          }
        }, 2);
        if (result instanceof ReviewError) throw result;
        return result;
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
