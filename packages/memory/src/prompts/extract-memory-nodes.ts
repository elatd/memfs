export function buildExtractMemoryNodesPrompt(input: { content: string; path: string }): string {
  return `You are extracting long-term memory nodes for an AI agent.

Input content:
${input.content}

Source path:
${input.path}

Return a JSON array only. No markdown.

Each object must include:
- summary: one sentence describing the fact, decision, constraint, preference, unresolved issue, error, task, or research finding.
- trigger: one sentence beginning with 'Recall when' describing when an agent should remember this.
- detail: 2 to 4 sentences with useful context.
- raw_excerpt: the shortest exact source excerpt that supports the memory.
- tags: 3 to 8 lowercase tags.
- memory_type: one of preference, decision, constraint, fact, task, error, research_finding, unresolved_question, run_summary, other.
- importance: integer from 1 to 5.
- confidence: number from 0 to 1.

Only create memories that are likely useful in future sessions.
Do not create trivial memories.
Do not invent facts not supported by the input.
If the input contains no durable memory, return [].
`;
}
