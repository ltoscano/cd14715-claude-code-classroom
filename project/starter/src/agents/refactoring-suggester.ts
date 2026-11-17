import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { githubTools } from '../config/mcp.config.js';
import { refactoringPrompt } from '../prompts/index.js';

export const refactoringSuggester: AgentDefinition = {
  description: 'Suggest behavior-preserving improvements with examples.',
  prompt: refactoringPrompt,
  tools: ['Skill', ...githubTools],
  model: 'inherit'
};
