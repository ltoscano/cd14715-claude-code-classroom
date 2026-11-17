import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { githubTools, eslintTools } from '../config/mcp.config.js';
import { codeQualityPrompt } from '../prompts/index.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description: 'Find correctness, defensive security, performance and maintainability issues.',
  prompt: codeQualityPrompt,
  tools: ['Skill', ...githubTools, ...eslintTools, 'mcp__review__stage_javascript'],
  model: 'inherit'
};
