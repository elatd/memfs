export function buildExtractReasoningMemoriesPrompt(input: {
  run_path: string;
  task: string;
  status: string;
  artifacts: Record<string, string>;
}): string {
  return `You are extracting reusable reasoning memories from an AI agent run.

Source run:
${input.run_path}

Run status:
${input.status}

Task:
${input.task}

Run artifacts:
${Object.entries(input.artifacts)
  .filter(([, content]) => content.trim())
  .map(([name, content]) => `--- ${input.run_path}/${name} ---\n${content}`)
  .join("\n\n")}

Return a JSON array only. No markdown.

Each object must match this schema exactly:
- type: "reasoning_memory"
- title: short reusable lesson title.
- trigger: when a future agent should recall this lesson.
- context: concise situation and constraints.
- strategy: reusable approach that worked or should be tried.
- failure_pattern: how the task failed or could fail.
- success_pattern: what avoided or resolved the failure.
- applies_to: 1 to 8 strings.
- preconditions: 1 to 8 strings.
- anti_patterns: 1 to 8 strings.
- source_run: exactly "${input.run_path}".
- source_refs: paths inside the source run that support the lesson.
- confidence: number from 0 to 1.
- status: "candidate".
- reason: why this lesson is worth review.

Rules:
- Extract only source-backed lessons that are likely useful in future runs.
- Do not store private chain-of-thought. Store concise reasoning summaries, patterns, and strategies.
- Do not invent facts not supported by run artifacts.
- If there is no reusable lesson, return [].
`;
}
