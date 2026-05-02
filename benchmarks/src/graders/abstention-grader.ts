interface AbstentionGrade {
  score: number;
  abstained: boolean;
  shouldAbstain: boolean;
}

const ABSTENTION_PATTERNS = [
  "do not have enough memory",
  "don't have enough memory",
  "not enough memory",
  "cannot answer",
  "can't answer",
  "no relevant memory"
];

export function gradeAbstention(input: {
  answer: string;
  retrievedCount: number;
  shouldAbstain: boolean;
}): AbstentionGrade {
  const normalizedAnswer = input.answer.toLowerCase();
  const abstained =
    input.retrievedCount === 0 ||
    ABSTENTION_PATTERNS.some((pattern) => normalizedAnswer.includes(pattern));

  return {
    score: abstained === input.shouldAbstain ? 1 : 0,
    abstained,
    shouldAbstain: input.shouldAbstain
  };
}
