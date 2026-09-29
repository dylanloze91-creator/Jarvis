export type { KnowledgeStats, KnowledgeToolPlan } from './types.js';
export { extractKnowledgeIntent } from './intent.js';
export { KNOWLEDGE_SYSTEM_PROMPT_FRAGMENT, withKnowledgePrompt } from './prompt.js';
export { isLocalMemoryEndpoint, resolveLocalOllamaBase } from './localUrl.js';
