export type MemoryMetadata = Record<string, unknown>;

export interface MemoryIngestInput {
  sourceId: string;
  text: string;
  metadata?: MemoryMetadata;
}

export interface MemoryRetrieveQuery {
  text: string;
  k?: number;
}

export interface MemoryRetrievedItem {
  text: string;
  sourceId?: string;
  score?: number;
  metadata?: MemoryMetadata;
}

export interface MemorySystemAdapter {
  name: string;

  reset(): Promise<void>;

  ingest(input: MemoryIngestInput): Promise<void>;

  retrieve(query: MemoryRetrieveQuery): Promise<MemoryRetrievedItem[]>;

  close?(): Promise<void>;

  generateAnswer?(input: {
    question: string;
    retrieved: Array<{ text: string; sourceId?: string }>;
  }): Promise<string>;
}
