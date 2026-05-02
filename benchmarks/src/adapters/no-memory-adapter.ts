import type {
  MemoryIngestInput,
  MemoryRetrievedItem,
  MemoryRetrieveQuery,
  MemorySystemAdapter
} from "./memory-system-adapter.js";

export class NoMemoryAdapter implements MemorySystemAdapter {
  name = "no-memory";

  async reset(): Promise<void> {
    return;
  }

  async ingest(_input: MemoryIngestInput): Promise<void> {
    return;
  }

  async retrieve(_query: MemoryRetrieveQuery): Promise<MemoryRetrievedItem[]> {
    return [];
  }
}
