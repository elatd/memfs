export interface KeywordMatchResult {
  score: number;
  matched: string[];
  missing: string[];
}

export function gradeKeywordMatch(answer: string, expectedKeywords: string[]): KeywordMatchResult {
  if (expectedKeywords.length === 0) {
    return {
      score: 1,
      matched: [],
      missing: []
    };
  }

  const normalizedAnswer = normalize(answer);
  const matched = expectedKeywords.filter((keyword) => normalizedAnswer.includes(normalize(keyword)));
  const missing = expectedKeywords.filter((keyword) => !matched.includes(keyword));

  return {
    score: matched.length / expectedKeywords.length,
    matched,
    missing
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
