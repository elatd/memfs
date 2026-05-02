import type { MemoryRetrievedItem } from "../adapters/memory-system-adapter.js";

export interface SourceRefGrade {
  score: number;
  recall: number;
  exactMatch: boolean;
  expectedSourceIds: string[];
  retrievedSourceIds: string[];
  missingSourceIds: string[];
  unexpectedSourceIds: string[];
}

export function gradeRecallAtK(retrieved: MemoryRetrievedItem[], expectedSourceIds: string[]): number {
  if (expectedSourceIds.length === 0) {
    return retrieved.length === 0 ? 1 : 0;
  }

  const retrievedIds = new Set(retrieved.map((item) => item.sourceId).filter(isPresent));
  const hits = expectedSourceIds.filter((sourceId) => retrievedIds.has(sourceId)).length;

  return hits / expectedSourceIds.length;
}

export function gradeSourceRefs(
  retrieved: MemoryRetrievedItem[],
  expectedSourceIds: string[]
): SourceRefGrade {
  const expected = new Set(expectedSourceIds);
  const retrievedIds = unique(retrieved.map((item) => item.sourceId).filter(isPresent));
  const retrievedSet = new Set(retrievedIds);

  if (expectedSourceIds.length === 0) {
    const exactMatch = retrievedIds.length === 0;
    return {
      score: exactMatch ? 1 : 0,
      recall: exactMatch ? 1 : 0,
      exactMatch,
      expectedSourceIds,
      retrievedSourceIds: retrievedIds,
      missingSourceIds: [],
      unexpectedSourceIds: retrievedIds
    };
  }

  const hits = expectedSourceIds.filter((sourceId) => retrievedSet.has(sourceId)).length;
  const recall = hits / expectedSourceIds.length;
  const missingSourceIds = expectedSourceIds.filter((sourceId) => !retrievedSet.has(sourceId));
  const unexpectedSourceIds = retrievedIds.filter((sourceId) => !expected.has(sourceId));

  return {
    score: recall,
    recall,
    exactMatch: missingSourceIds.length === 0 && unexpectedSourceIds.length === 0,
    expectedSourceIds,
    retrievedSourceIds: retrievedIds,
    missingSourceIds,
    unexpectedSourceIds
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isPresent(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
