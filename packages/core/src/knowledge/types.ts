export interface KnowledgeStats {
  chunks: number;
  sources: number;
  embedded: number;
}

export interface KnowledgeToolPlan {
  tool: string;
  args: Record<string, unknown>;
}
