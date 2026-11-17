import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { githubTools } from '../config/mcp.config.js';
import { testCoveragePrompt } from '../prompts/index.js';

export const testCoverageAnalyzer: AgentDefinition = {
  description: 'Review test coverage and propose specific missing assertions.',
  prompt: testCoveragePrompt,
  tools: ['Skill', ...githubTools],
  model: 'inherit'
};
