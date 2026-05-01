import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  Ban,
  BookOpen,
  Brain,
  Check,
  ClipboardCheck,
  Database,
  Eye,
  FileText,
  Folder,
  GitBranch,
  History,
  Inbox,
  Link2,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3131";

const memoryTypeOptions = [
  "preference",
  "decision",
  "constraint",
  "fact",
  "task",
  "error",
  "research_finding",
  "unresolved_question",
  "run_summary",
  "reasoning_memory",
  "other"
] as const;

const scopeOptions = ["global", "workspace", "project", "repo", "session", "agent", "contact", "run"] as const;
const candidateStatusOptions = ["observed", "candidate", "duplicate", "approved", "rejected", "superseded", "stale", "conflicted"] as const;

interface Workspace {
  id: string;
  name: string;
}

interface FileRecord {
  id: string;
  path: string;
  size_bytes: number;
  updated_at: string;
}

interface MemoryNode {
  id: string;
  summary: string;
  trigger: string;
  detail: string | null;
  tags: string[];
  memory_type: string;
  importance: number;
  confidence: number;
  trust_level?: string;
  status?: string;
  ttl_expires_at?: string | null;
  scope?: string;
  project_id?: string | null;
  project_slug?: string | null;
  repo_id?: string | null;
  repo_path?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  contact_id?: string | null;
  run_id?: string | null;
  source_path: string;
  raw_ref: string;
  raw_excerpt: string | null;
  source_location_json?: string | null;
}

interface RecallResult {
  node_id: string;
  type?: string;
  summary: string;
  trigger: string;
  detail?: string | null;
  tags: string[];
  memory_type: string;
  importance: number;
  confidence?: number;
  trust_level?: string;
  status?: string;
  score: number;
  source_path: string;
  raw_ref: string;
  source_location?: Record<string, unknown> | null;
  source_kind?: string | null;
  extractor_name?: string | null;
  raw_excerpt?: string | null;
  raw_content?: string | null;
  why?: WhyRecalled;
  links?: MemoryLinkPacket[];
  warnings?: string[];
}

interface WhyRecalled {
  trigger_similarity: number;
  summary_similarity: number;
  keyword_score: number;
  detail_similarity: number;
  raw_excerpt_similarity: number;
  importance_score: number;
  recency_score: number;
  path_project_score: number;
  graph_score: number;
  matched_terms: string[];
  explanation: string;
}

interface MemoryLinkPacket {
  id: string;
  from_node_id: string;
  to_node_id: string;
  other_node_id: string;
  relation_type: string;
  confidence: number;
  reason: string;
  created_at: string;
  other_summary?: string;
  other_source_path?: string;
}

interface ContradictionRecord {
  link: MemoryLinkPacket;
  from_node: MemoryNode;
  to_node: MemoryNode;
}

interface RecallMeta {
  brief?: string;
  trace_id?: string;
  plan?: {
    mode: string;
    topics: string[];
    memory_types: string[];
    retrieval_strategy: Record<string, number>;
  };
  warnings?: string[];
}

interface AuditEvent {
  id: string;
  actor: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface MemoryPromotion {
  id: string;
  source_path: string;
  target_path: string;
  status: string;
  actor: string;
  reviewer: string | null;
  reason: string | null;
  candidate_node_id: string | null;
  created_at: string;
}

interface MemoryCandidate {
  id: string;
  node_id: string;
  memory_text: string;
  type: string;
  scope: string;
  confidence: number;
  risk_flags: string[];
  status: string;
  duplicate_of?: string | null;
  conflicts_with?: string[];
  conflict_reason?: string | null;
  created_by: string;
  reviewed_by: string | null;
  promotion_id: string | null;
  promotion_target_path: string | null;
  reason: string | null;
  created_at: string;
  reviewed_at?: string | null;
  source_refs: Array<{ source_path: string; raw_ref: string; source_location?: Record<string, unknown> | null }>;
  node: MemoryNode;
}

interface CandidateDraft {
  memory_text: string;
  type: string;
  scope: string;
  tags: string;
  reason: string;
  promotion_target_path: string;
  project_slug: string;
  repo_path: string;
}

interface SnapshotRecord {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

interface SnapshotDiff {
  snapshot_id: string;
  added: Array<{ item_type: string; item_id: string }>;
  removed: Array<{ item_type: string; item_id: string }>;
  changed: Array<{ item_type: string; item_id: string }>;
}

interface MemoryHealth {
  overall_score: number;
  source_coverage: number;
  contradiction_count: number;
  unresolved_promotion_count: number;
  stale_node_count: number;
  rejected_node_count: number;
  low_confidence_count: number;
  orphan_node_count: number;
  raw_missing_count: number;
  unreviewed_trusted_path_writes: number;
  created_at: string;
}

interface AgentRun {
  id: string;
  title: string;
  task: string;
  actor: string;
  status: string;
  run_path: string;
  created_at: string;
  completed_at: string | null;
}

interface RunMemoryUsage {
  id: string;
  memory_node_id: string;
  source_path: string;
  usage_type: string;
  created_at: string;
}

interface RunDetail {
  run: AgentRun;
  events: Array<{ id: string; event_type: string; payload_json: string; created_at: string }>;
  memory_used: RunMemoryUsage[];
}

interface BriefResponse {
  brief_markdown: string;
  run_id?: string;
  memory_results: RecallResult[];
}

interface HandoffRecord {
  id: string;
  summary: string;
  project_hint: string | null;
  run_id: string | null;
  created_at: string;
}

interface StaleMemoryCandidate {
  node: MemoryNode;
  reasons: string[];
}

interface ExtractedSource {
  id: string;
  extractor_name: string;
  extractor_version: string;
  content_text: string;
  metadata_json: string;
  created_at: string;
}

interface SyncStatus {
  mode: string;
  enabled: boolean;
  pending_events: number;
  unresolved_conflicts: number;
  object_storage: { configured: boolean; bucket: string | null };
}

interface SyncConflict {
  id: string;
  object_type: string;
  object_id: string;
  local_version: string;
  remote_version: string;
  conflict_type: string;
  status: string;
  payload_json: string;
  created_at: string;
  resolved_at: string | null;
}

interface TeamMember {
  id: string;
  handle: string;
  role: "owner" | "admin" | "editor" | "agent" | "viewer";
  display_name: string | null;
}

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState("/scratch/note.md");
  const [editorContent, setEditorContent] = useState("");
  const [ingest, setIngest] = useState(true);
  const [allowProtected, setAllowProtected] = useState(false);
  const [memoryNodes, setMemoryNodes] = useState<MemoryNode[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionRecord[]>([]);
  const [promotions, setPromotions] = useState<MemoryPromotion[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [candidateStatusFilter, setCandidateStatusFilter] = useState("candidate");
  const [candidateScopeFilter, setCandidateScopeFilter] = useState("all");
  const [candidateRiskFilter, setCandidateRiskFilter] = useState("all");
  const [candidateProjectFilter, setCandidateProjectFilter] = useState("");
  const [editingCandidateId, setEditingCandidateId] = useState("");
  const [candidateDraft, setCandidateDraft] = useState<CandidateDraft>(emptyCandidateDraft());
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [snapshotDiff, setSnapshotDiff] = useState<SnapshotDiff | null>(null);
  const [health, setHealth] = useState<MemoryHealth | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [briefText, setBriefText] = useState("");
  const [extractedSources, setExtractedSources] = useState<ExtractedSource[]>([]);
  const [sourceFilter, setSourceFilter] = useState("");
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [staleMemory, setStaleMemory] = useState<StaleMemoryCandidate[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [memberHandle, setMemberHandle] = useState("agent:demo");
  const [memberRole, setMemberRole] = useState<TeamMember["role"]>("agent");
  const [query, setQuery] = useState("What should I remember before changing onboarding?");
  const [searchQuery, setSearchQuery] = useState("onboarding decision");
  const [searchResults, setSearchResults] = useState<RecallResult[]>([]);
  const [recallResults, setRecallResults] = useState<RecallResult[]>([]);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [activePanel, setActivePanel] = useState<"recall" | "search" | "nodes" | "contradictions" | "runs" | "candidates" | "trust" | "sync" | "audit">("recall");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [nodeLinks, setNodeLinks] = useState<MemoryLinkPacket[]>([]);
  const [linkTarget, setLinkTarget] = useState("");
  const [linkRelation, setLinkRelation] = useState("related_to");
  const [rawViewer, setRawViewer] = useState<{ nodeId: string; content: string } | null>(null);
  const [recallMeta, setRecallMeta] = useState<RecallMeta | null>(null);
  const [auditFilter, setAuditFilter] = useState("");
  const [status, setStatus] = useState("Ready");

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId),
    [workspaceId, workspaces]
  );
  const selectedNode = useMemo(
    () => memoryNodes.find((node) => node.id === selectedNodeId) ?? memoryNodes[0],
    [memoryNodes, selectedNodeId]
  );
  const filteredNodes = useMemo(
    () => memoryNodes.filter((node) => (sourceFilter ? node.source_path.includes(sourceFilter) : true)),
    [memoryNodes, sourceFilter]
  );
  const filteredAudit = auditFilter
    ? auditEvents.filter((event) => `${event.event_type} ${event.actor}`.toLowerCase().includes(auditFilter.toLowerCase()))
    : auditEvents;
  const candidateRiskFlags = useMemo(
    () => [...new Set(candidates.flatMap((candidate) => candidate.risk_flags.length ? candidate.risk_flags : ["none"]))].sort(),
    [candidates]
  );
  const filteredCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        if (candidateStatusFilter !== "all" && candidate.status !== candidateStatusFilter) return false;
        if (candidateScopeFilter !== "all" && candidate.scope !== candidateScopeFilter) return false;
        if (candidateRiskFilter !== "all" && !candidate.risk_flags.includes(candidateRiskFilter)) return false;
        if (candidateProjectFilter.trim()) {
          const needle = candidateProjectFilter.trim().toLowerCase();
          const haystack = [
            candidate.node.project_slug,
            candidate.node.project_id,
            candidate.node.repo_path,
            candidate.source_refs.map((source) => source.source_path).join(" ")
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      }),
    [candidates, candidateProjectFilter, candidateRiskFilter, candidateScopeFilter, candidateStatusFilter]
  );
  const trustCounts = useMemo(() => trustSummary(memoryNodes), [memoryNodes]);
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? runs[0], [runs, selectedRunId]);

  useEffect(() => {
    void refreshWorkspaces();
  }, []);

  useEffect(() => {
    if (workspaceId) {
      void refreshWorkspaceData(workspaceId);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId && selectedNode?.id) {
      void refreshNodeLinks(selectedNode.id);
    }
  }, [workspaceId, selectedNode?.id]);

  useEffect(() => {
    if (workspaceId && selectedRun?.id) {
      void refreshRunDetail(selectedRun.id);
    }
  }, [workspaceId, selectedRun?.id]);

  async function refreshWorkspaces() {
    const next = await api<Workspace[]>("/workspaces");
    setWorkspaces(next);
    if (!workspaceId && next[0]) {
      setWorkspaceId(next[0].id);
    }
  }

  async function refreshWorkspaceData(id = workspaceId) {
    if (!id) return;
    const [
      nextFiles,
      nextNodes,
      nextAudit,
      nextContradictions,
      nextPromotions,
      nextCandidates,
      nextSnapshots,
      nextHealth,
      nextRuns,
      nextHandoffs,
      nextStale,
      nextSyncStatus,
      nextSyncConflicts,
      nextTeamMembers
    ] = await Promise.all([
      api<FileRecord[]>(`/workspaces/${id}/files`),
      api<MemoryNode[]>(`/workspaces/${id}/memory/nodes`),
      api<AuditEvent[]>(`/workspaces/${id}/audit-events`),
      api<ContradictionRecord[]>(`/workspaces/${id}/memory/contradictions`),
      api<MemoryPromotion[]>(`/workspaces/${id}/memory/promotions`),
      api<MemoryCandidate[]>(`/workspaces/${id}/memory/candidates`),
      api<SnapshotRecord[]>(`/workspaces/${id}/snapshots`),
      api<MemoryHealth>(`/workspaces/${id}/memory/health`),
      api<AgentRun[]>(`/workspaces/${id}/runs`),
      api<HandoffRecord[]>(`/workspaces/${id}/handoffs`),
      api<StaleMemoryCandidate[]>(`/workspaces/${id}/memory/stale`),
      api<SyncStatus>(`/workspaces/${id}/sync/status`),
      api<SyncConflict[]>(`/workspaces/${id}/sync/conflicts`),
      api<TeamMember[]>(`/workspaces/${id}/team/members`)
    ]);
    setFiles(nextFiles);
    setMemoryNodes(nextNodes);
    setAuditEvents(nextAudit);
    setContradictions(nextContradictions);
    setPromotions(nextPromotions);
    setCandidates(nextCandidates);
    setSnapshots(nextSnapshots);
    setHealth(nextHealth);
    setRuns(nextRuns);
    setHandoffs(nextHandoffs);
    setStaleMemory(nextStale);
    setSyncStatus(nextSyncStatus);
    setSyncConflicts(nextSyncConflicts);
    setTeamMembers(nextTeamMembers);
  }

  async function refreshNodeLinks(nodeId: string) {
    const links = await api<MemoryLinkPacket[]>(`/workspaces/${workspaceId}/memory/nodes/${nodeId}/links`);
    setNodeLinks(links);
  }

  async function refreshRunDetail(runId: string) {
    const detail = await api<RunDetail>(`/workspaces/${workspaceId}/runs/${runId}`);
    setRunDetail(detail);
  }

  async function createWorkspace() {
    const name = window.prompt("Workspace name", "demo");
    if (!name) return;
    const workspace = await api<Workspace>("/workspaces", {
      method: "POST",
      body: { name }
    });
    await refreshWorkspaces();
    setWorkspaceId(workspace.id);
  }

  async function openFile(path: string) {
    if (!workspaceId) return;
    const response = await api<{ content: string }>(
      `/workspaces/${workspaceId}/files/read?path=${encodeURIComponent(path)}`
    );
    setSelectedPath(path);
    setEditorContent(response.content);
    await loadExtractedForPath(path);
  }

  async function saveFile() {
    if (!workspaceId) return;
    setStatus("Saving");
    await api(`/workspaces/${workspaceId}/files/write`, {
      method: "POST",
      body: {
        path: selectedPath,
        content: editorContent,
        actor: "human:web",
        ingest,
        allow_protected_write: allowProtected
      }
    });
    await refreshWorkspaceData();
    setStatus("Saved");
  }

  async function uploadLocalFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (!workspaceId) return;
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("Uploading");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    const targetPath = selectedPath.startsWith("/uploads/") ? selectedPath : `/uploads/${file.name}`;
    await api(`/workspaces/${workspaceId}/files/upload`, {
      method: "POST",
      body: {
        path: targetPath,
        content_base64: btoa(binary),
        mime_type: file.type || undefined,
        actor: "human:web",
        ingest,
        allow_protected_write: allowProtected
      }
    });
    setSelectedPath(targetPath);
    await refreshWorkspaceData();
    await loadExtractedForPath(targetPath);
    setStatus("Uploaded");
    event.currentTarget.value = "";
  }

  async function extractSelectedFile() {
    if (!workspaceId || !selectedPath) return;
    setStatus("Extracting");
    await api(`/workspaces/${workspaceId}/files/extract`, {
      method: "POST",
      body: { path: selectedPath, actor: "human:web" }
    });
    await loadExtractedForPath(selectedPath);
    setStatus("Extracted");
  }

  async function loadExtractedForPath(path: string) {
    if (!workspaceId) return;
    let file = files.find((entry) => entry.path === path);
    if (!file) {
      const nextFiles = await api<FileRecord[]>(`/workspaces/${workspaceId}/files`);
      setFiles(nextFiles);
      file = nextFiles.find((entry) => entry.path === path);
    }
    if (!file) {
      setExtractedSources([]);
      return;
    }
    const sources = await api<ExtractedSource[]>(`/workspaces/${workspaceId}/files/${file.id}/extracted`);
    setExtractedSources(sources);
  }

  async function recall() {
    if (!workspaceId) return;
    setStatus("Recalling");
    const response = await api<{ results: RecallResult[] } & RecallMeta>(
      `/workspaces/${workspaceId}/memory/explain-recall`,
      {
        method: "POST",
        body: {
          query,
          limit: 8,
          include_detail: true,
          include_raw: includeRaw,
          include_why: true,
          include_links: true,
          include_contradictions: true,
          include_trust: true
        }
      }
    );
    setRecallResults(response.results);
    setRecallMeta(response);
    setStatus("Ready");
  }

  async function searchMemory() {
    if (!workspaceId) return;
    setStatus("Searching");
    const response = await api<{ results: RecallResult[] }>(
      `/workspaces/${workspaceId}/memory/search`,
      {
        method: "POST",
        body: {
          query: searchQuery,
          limit: 8,
          include_detail: true,
          include_raw: false
        }
      }
    );
    setSearchResults(response.results);
    setStatus("Ready");
  }

  async function loadRaw(nodeId: string) {
    if (!workspaceId) return;
    setStatus("Loading raw");
    const response = await api<{ node_id: string; content: string }>(
      `/workspaces/${workspaceId}/memory/nodes/${nodeId}/raw`
    );
    setRawViewer({ nodeId: response.node_id, content: response.content });
    setStatus("Ready");
  }

  async function createLink() {
    if (!workspaceId || !selectedNode?.id || !linkTarget) return;
    await api(`/workspaces/${workspaceId}/memory/nodes/${selectedNode.id}/links`, {
      method: "POST",
      body: {
        to_node_id: linkTarget,
        relation_type: linkRelation,
        confidence: 0.7,
        reason: "Created from dashboard",
        actor: "human:web"
      }
    });
    await refreshNodeLinks(selectedNode.id);
    await refreshWorkspaceData();
    setLinkTarget("");
  }

  async function proposePromotion() {
    if (!workspaceId || !selectedPath) return;
    const targetPath = window.prompt("Promote to path", "/memory/reviewed.md");
    if (!targetPath) return;
    await api(`/workspaces/${workspaceId}/memory/promote`, {
      method: "POST",
      body: {
        source_path: selectedPath,
        target_path: targetPath,
        actor: "human:web",
        require_review: true
      }
    });
    await refreshWorkspaceData();
  }

  async function approvePromotion(id: string) {
    if (!workspaceId) return;
    await api(`/workspaces/${workspaceId}/memory/promotions/${id}/approve`, {
      method: "POST",
      body: { reviewer: "human:web", apply: true }
    });
    await refreshWorkspaceData();
  }

  async function rejectPromotion(id: string) {
    if (!workspaceId) return;
    await api(`/workspaces/${workspaceId}/memory/promotions/${id}/reject`, {
      method: "POST",
      body: { reviewer: "human:web" }
    });
    await refreshWorkspaceData();
  }

  function beginCandidateEdit(candidate: MemoryCandidate) {
    setEditingCandidateId(candidate.id);
    setCandidateDraft({
      memory_text: candidate.memory_text,
      type: candidate.type,
      scope: candidate.scope,
      tags: candidate.node.tags.join(", "),
      reason: candidate.reason ?? "",
      promotion_target_path: candidate.promotion_target_path ?? "",
      project_slug: candidate.node.project_slug ?? "",
      repo_path: candidate.node.repo_path ?? ""
    });
  }

  function cancelCandidateEdit() {
    setEditingCandidateId("");
    setCandidateDraft(emptyCandidateDraft());
  }

  async function saveCandidateEdit(id: string) {
    if (!workspaceId) return;
    const body = {
      memory_text: candidateDraft.memory_text,
      detail: candidateDraft.memory_text,
      type: candidateDraft.type,
      scope: candidateDraft.scope,
      tags: splitTags(candidateDraft.tags),
      reason: candidateDraft.reason,
      promotion_target_path: candidateDraft.promotion_target_path.trim() || undefined,
      project_slug: candidateDraft.scope === "project" ? candidateDraft.project_slug.trim() || undefined : undefined,
      repo_path: candidateDraft.scope === "repo" ? candidateDraft.repo_path.trim() || undefined : undefined,
      actor: "human:web"
    };
    await api(`/workspaces/${workspaceId}/memory/candidates/${id}/update`, {
      method: "POST",
      body
    });
    cancelCandidateEdit();
    await refreshWorkspaceData();
  }

  async function approveCandidate(id: string, targetPath?: string) {
    if (!workspaceId) return;
    const candidate = candidates.find((item) => item.id === id);
    const promotionTarget =
      targetPath ??
      candidate?.promotion_target_path ??
      window.prompt("Promotion target path", defaultTargetPathForCandidate(candidate));
    if (!promotionTarget) return;
    await api(`/workspaces/${workspaceId}/memory/candidates/${id}/approve`, {
      method: "POST",
      body: { reviewer: "human:web", apply: true, promotion_target_path: promotionTarget }
    });
    await refreshWorkspaceData();
  }

  async function rejectCandidate(id: string) {
    if (!workspaceId) return;
    const comment = window.prompt("Rejection reason", "Not durable memory.");
    if (comment === null) return;
    await api(`/workspaces/${workspaceId}/memory/candidates/${id}/reject`, {
      method: "POST",
      body: { reviewer: "human:web", comment }
    });
    await refreshWorkspaceData();
  }

  async function markCandidateStatus(id: string, status: "stale" | "conflicted") {
    if (!workspaceId) return;
    const reason = window.prompt(
      status === "stale" ? "Why is this stale?" : "Why is this conflicted?",
      status === "stale" ? "Superseded by newer project context." : "Conflicts with another memory."
    );
    if (!reason) return;
    await api(`/workspaces/${workspaceId}/memory/candidates/${id}/update`, {
      method: "POST",
      body: {
        status,
        reason,
        actor: "human:web"
      }
    });
    await refreshWorkspaceData();
  }

  async function createSnapshot() {
    if (!workspaceId) return;
    const name = window.prompt("Snapshot name", `snapshot-${new Date().toISOString().slice(0, 10)}`);
    if (!name) return;
    await api(`/workspaces/${workspaceId}/snapshots`, {
      method: "POST",
      body: { name, actor: "human:web" }
    });
    await refreshWorkspaceData();
  }

  async function diffSnapshot(id: string) {
    if (!workspaceId) return;
    const diff = await api<SnapshotDiff>(`/workspaces/${workspaceId}/snapshots/${id}/diff`);
    setSnapshotDiff(diff);
  }

  async function rollbackDryRun(id: string) {
    if (!workspaceId) return;
    const response = await api<{ diff: SnapshotDiff }>(`/workspaces/${workspaceId}/snapshots/${id}/rollback`, {
      method: "POST",
      body: { dry_run: true, actor: "human:web" }
    });
    setSnapshotDiff(response.diff);
  }

  async function recomputeHealth() {
    if (!workspaceId) return;
    const next = await api<MemoryHealth>(`/workspaces/${workspaceId}/memory/health/recompute`, {
      method: "POST"
    });
    setHealth(next);
    await refreshWorkspaceData();
  }

  async function createBrief() {
    if (!workspaceId) return;
    setStatus("Briefing");
    const response = await api<BriefResponse>(`/workspaces/${workspaceId}/brief`, {
      method: "POST",
      body: {
        task: query,
        actor: "human:web",
        create_run: true,
        include_recent_runs: true,
        include_open_questions: true,
        include_contradictions: true,
        limit: 12
      }
    });
    setBriefText(response.brief_markdown);
    if (response.run_id) setSelectedRunId(response.run_id);
    await refreshWorkspaceData();
    setStatus("Ready");
  }

  async function createRun() {
    if (!workspaceId) return;
    const task = window.prompt("Run task", query);
    if (!task) return;
    const run = await api<AgentRun>(`/workspaces/${workspaceId}/runs`, {
      method: "POST",
      body: { task, actor: "human:web" }
    });
    setSelectedRunId(run.id);
    await refreshWorkspaceData();
  }

  async function completeRun(id: string) {
    if (!workspaceId) return;
    await api(`/workspaces/${workspaceId}/runs/${id}/complete`, {
      method: "POST",
      body: {
        actor: "human:web",
        result: editorContent || "Completed from dashboard."
      }
    });
    await refreshWorkspaceData();
    await refreshRunDetail(id);
  }

  async function compileRun(id: string) {
    if (!workspaceId) return;
    const response = await api<{ summary: string }>(`/workspaces/${workspaceId}/runs/${id}/compile`, {
      method: "POST",
      body: { actor: "human:web" }
    });
    setStatus(response.summary);
    await refreshWorkspaceData();
    await refreshRunDetail(id);
  }

  async function createHandoff() {
    if (!workspaceId) return;
    await api(`/workspaces/${workspaceId}/handoff`, {
      method: "POST",
      body: {
        actor: "human:web",
        run_id: selectedRun?.id
      }
    });
    await refreshWorkspaceData();
  }

  async function pushSync() {
    if (!workspaceId) return;
    setStatus("Pushing sync events");
    await api(`/workspaces/${workspaceId}/sync/push`, {
      method: "POST",
      body: { actor: "human:web" }
    });
    await refreshWorkspaceData();
    setStatus("Ready");
  }

  async function pullSync() {
    if (!workspaceId) return;
    setStatus("Pulling sync events");
    await api(`/workspaces/${workspaceId}/sync/pull`, {
      method: "POST",
      body: { actor: "human:web" }
    });
    await refreshWorkspaceData();
    setStatus("Ready");
  }

  async function resolveSyncConflict(id: string, mode: "keep_local" | "keep_remote" | "keep_both") {
    if (!workspaceId) return;
    await api(`/workspaces/${workspaceId}/sync/conflicts/${id}/resolve`, {
      method: "POST",
      body: { mode, actor: "human:web" }
    });
    await refreshWorkspaceData();
  }

  async function addTeamMember() {
    if (!workspaceId || !memberHandle.trim()) return;
    await api(`/workspaces/${workspaceId}/team/members`, {
      method: "POST",
      body: {
        handle: memberHandle.trim(),
        role: memberRole,
        actor: "human:web"
      }
    });
    await refreshWorkspaceData();
  }

  async function updateTeamRole(handle: string, role: TeamMember["role"]) {
    if (!workspaceId) return;
    await api(`/workspaces/${workspaceId}/team/role`, {
      method: "POST",
      body: {
        handle,
        role,
        actor: "human:web"
      }
    });
    await refreshWorkspaceData();
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="flex min-h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-ink)]">
            <Database size={17} />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-normal">MemFS</h1>
            <p className="text-xs text-[var(--muted)]">{selectedWorkspace?.name ?? "No workspace"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="control h-9 min-w-40"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            <option value="">Select workspace</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <IconButton title="Create workspace" onClick={createWorkspace}>
            <Plus size={16} />
          </IconButton>
          <IconButton title="Refresh" onClick={() => refreshWorkspaceData()}>
            <RefreshCw size={16} />
          </IconButton>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-56px)] grid-cols-1 lg:grid-cols-[270px_minmax(0,1fr)_440px]">
        <aside className="border-b border-[var(--line)] bg-[var(--rail)] lg:border-b-0 lg:border-r">
          <PanelHeader icon={<Folder size={16} />} title="Files" count={files.length} />
          <div className="space-y-1 p-2">
            {files.length === 0 && <EmptyLine>No files</EmptyLine>}
            {files.map((file) => (
              <button
                key={file.id}
                className={`row-button ${file.path === selectedPath ? "is-active" : ""}`}
                onClick={() => openFile(file.path)}
              >
                <FileText size={15} />
                <span className="truncate">{file.path}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 border-b border-[var(--line)] bg-[var(--surface)] lg:border-b-0 lg:border-r">
          <PanelHeader icon={<BookOpen size={16} />} title="File Editor" detail={status} />
          <div className="grid gap-3 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <input
                className="control h-9 flex-1 font-mono text-xs"
                value={selectedPath}
                onChange={(event) => setSelectedPath(event.target.value)}
              />
              <label className="toggle">
                <input type="checkbox" checked={ingest} onChange={(event) => setIngest(event.target.checked)} />
                <Sparkles size={14} />
                <span>Ingest</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={allowProtected}
                  onChange={(event) => setAllowProtected(event.target.checked)}
                />
                <Shield size={14} />
                <span>Protected</span>
              </label>
              <button className="primary-button h-9" onClick={saveFile} disabled={!workspaceId}>
                <Save size={15} />
                <span>Write</span>
              </button>
              <button className="secondary-button h-9" onClick={proposePromotion} disabled={!workspaceId}>
                <ShieldCheck size={15} />
                <span>Promote</span>
              </button>
              <button className="secondary-button h-9" onClick={extractSelectedFile} disabled={!workspaceId}>
                <Sparkles size={15} />
                <span>Extract</span>
              </button>
              <label className="secondary-button h-9 cursor-pointer">
                <Upload size={15} />
                <span>Upload</span>
                <input className="sr-only" type="file" onChange={uploadLocalFile} />
              </label>
            </div>
            <textarea
              className="min-h-[48vh] resize-y rounded-md border border-[var(--line)] bg-[var(--canvas)] p-3 font-mono text-sm leading-6 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--ring)]"
              value={editorContent}
              onChange={(event) => setEditorContent(event.target.value)}
              spellCheck={false}
            />
            {extractedSources.length > 0 && (
              <section className="trust-block">
                <PanelSubhead icon={<FileText size={14} />} title="Extracted Text" />
                <div className="mt-2 space-y-2">
                  {extractedSources.map((source) => (
                    <div className="source-row" key={source.id}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="pill">{source.extractor_name}</span>
                        <time>{new Date(source.created_at).toLocaleString()}</time>
                      </div>
                      <pre className="raw-box max-h-44">{source.content_text || extractionReason(source)}</pre>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>

        <aside className="min-w-0 bg-[var(--bg)]">
          <PanelHeader icon={<Brain size={16} />} title="Memory" count={memoryNodes.length} />
          <div className="grid gap-3 p-3">
            <div className="tabs">
              <button className={`tab-button ${activePanel === "recall" ? "is-active" : ""}`} onClick={() => setActivePanel("recall")}>
                <Brain size={14} />
                Recall
              </button>
              <button className={`tab-button ${activePanel === "search" ? "is-active" : ""}`} onClick={() => setActivePanel("search")}>
                <Search size={14} />
                Search
              </button>
              <button className={`tab-button ${activePanel === "nodes" ? "is-active" : ""}`} onClick={() => setActivePanel("nodes")}>
                <ListTree size={14} />
                Nodes
              </button>
              <button className={`tab-button ${activePanel === "contradictions" ? "is-active" : ""}`} onClick={() => setActivePanel("contradictions")}>
                <GitBranch size={14} />
                Graph
              </button>
              <button className={`tab-button ${activePanel === "runs" ? "is-active" : ""}`} onClick={() => setActivePanel("runs")}>
                <ClipboardCheck size={14} />
                Runs
              </button>
              <button className={`tab-button ${activePanel === "candidates" ? "is-active" : ""}`} onClick={() => setActivePanel("candidates")}>
                <Inbox size={14} />
                Review
              </button>
              <button className={`tab-button ${activePanel === "trust" ? "is-active" : ""}`} onClick={() => setActivePanel("trust")}>
                <ShieldCheck size={14} />
                Trust
              </button>
              <button className={`tab-button ${activePanel === "sync" ? "is-active" : ""}`} onClick={() => setActivePanel("sync")}>
                <Users size={14} />
                Team
              </button>
              <button className={`tab-button ${activePanel === "audit" ? "is-active" : ""}`} onClick={() => setActivePanel("audit")}>
                <History size={14} />
                Audit
              </button>
            </div>

            {activePanel === "recall" && (
              <section className="grid gap-3">
                <div className="flex gap-2">
                  <input
                    className="control h-9 min-w-0 flex-1"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <label className="icon-toggle" title="Include raw source in recall">
                    <input
                      type="checkbox"
                      checked={includeRaw}
                      onChange={(event) => setIncludeRaw(event.target.checked)}
                    />
                    <FileText size={15} />
                  </label>
                  <button className="primary-button h-9" onClick={recall} disabled={!workspaceId}>
                    <Search size={15} />
                  </button>
                  <button className="secondary-button h-9" onClick={createBrief} disabled={!workspaceId}>
                    Brief
                  </button>
                </div>
                {briefText && <pre className="raw-box max-h-72">{briefText}</pre>}
                {recallMeta && (
                  <section className="explain-panel">
                    <div className="flex items-center justify-between gap-2">
                      <span>{recallMeta.plan?.mode ?? "general"}</span>
                      <span className="font-mono">{recallMeta.trace_id?.slice(0, 8)}</span>
                    </div>
                    {recallMeta.brief && <p>{recallMeta.brief}</p>}
                  </section>
                )}
                <ResultList results={recallResults} empty="No recall results" onLoadRaw={loadRaw} />
              </section>
            )}

            {activePanel === "search" && (
              <section className="grid gap-3">
                <div className="flex gap-2">
                  <input
                    className="control h-9 min-w-0 flex-1"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <button className="primary-button h-9" onClick={searchMemory} disabled={!workspaceId}>
                    <Search size={15} />
                  </button>
                </div>
                <ResultList results={searchResults} empty="No search results" onLoadRaw={loadRaw} />
              </section>
            )}

            {activePanel === "nodes" && (
              <section className="grid gap-3">
                <input
                  className="control h-9 w-full font-mono text-xs"
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value)}
                  placeholder="filter nodes by source path or file type"
                />
                <div className="space-y-1.5">
                  {filteredNodes.length === 0 && <EmptyLine>No memory nodes</EmptyLine>}
                  {filteredNodes.map((node) => (
                    <button
                      key={node.id}
                      className={`node-row ${selectedNode?.id === node.id ? "is-active" : ""}`}
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <span className="truncate font-medium">{node.summary}</span>
                      <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-[var(--muted)]">
                        <span className="truncate">{node.source_path}</span>
                        {node.trust_level && <span className="pill">{node.trust_level}</span>}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedNode && (
                  <article className="result-item">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-sm font-semibold leading-5">{selectedNode.summary}</h2>
                      <button className="secondary-button h-8" onClick={() => loadRaw(selectedNode.id)}>
                        <Eye size={14} />
                        Raw
                      </button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{selectedNode.trigger}</p>
                    {selectedNode.detail && <p className="mt-2 text-xs leading-5">{selectedNode.detail}</p>}
                    <MetaGrid
                      items={[
                        ["type", selectedNode.memory_type],
                        ["importance", String(selectedNode.importance)],
                        ["confidence", selectedNode.confidence.toFixed(2)],
                        ["trust", selectedNode.trust_level ?? "source_backed"],
                        ["status", selectedNode.status ?? "active"],
                        ["source", selectedNode.source_path],
                        ["source_location", compactSourceLocation(parseMaybeJson(selectedNode.source_location_json))],
                        ["raw_ref", selectedNode.raw_ref]
                      ]}
                    />
                    <TagList tags={selectedNode.tags} />
                    <section className="mt-3 border-t border-[var(--line)] pt-3">
                      <PanelSubhead icon={<Link2 size={14} />} title="Graph Links" />
                      <div className="mt-2 space-y-1.5">
                        {nodeLinks.length === 0 && <EmptyLine>No links</EmptyLine>}
                        {nodeLinks.map((link) => (
                          <div key={link.id} className="graph-row">
                            <span className="pill">{link.relation_type}</span>
                            <span className="min-w-0 truncate">{link.other_summary}</span>
                            <span className="score">{link.confidence.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 grid gap-2">
                        <input
                          className="control h-9 font-mono text-xs"
                          value={linkTarget}
                          onChange={(event) => setLinkTarget(event.target.value)}
                          placeholder="target node id"
                        />
                        <div className="flex gap-2">
                          <select className="control h-9 flex-1" value={linkRelation} onChange={(event) => setLinkRelation(event.target.value)}>
                            {["related_to", "supports", "contradicts", "supersedes", "duplicates", "caused_by", "derived_from", "belongs_to_project", "used_in_run", "promoted_from"].map((relation) => (
                              <option key={relation} value={relation}>{relation}</option>
                            ))}
                          </select>
                          <button className="secondary-button h-9" onClick={createLink}>
                            <Link2 size={14} />
                            Link
                          </button>
                        </div>
                      </div>
                    </section>
                  </article>
                )}
              </section>
            )}

            {activePanel === "contradictions" && (
              <section className="grid gap-2">
                <PanelSubhead icon={<GitBranch size={14} />} title="Contradictions Inbox" />
                {contradictions.length === 0 && <EmptyLine>No contradictions</EmptyLine>}
                {contradictions.map((item) => (
                  <article className="result-item" key={item.link.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="pill">{item.link.relation_type}</span>
                      <span className="score">{item.link.confidence.toFixed(2)}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5">{item.from_node.summary}</p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.to_node.summary}</p>
                    <div className="mt-2 font-mono text-[11px] text-[var(--muted)]">{item.link.reason}</div>
                  </article>
                ))}
              </section>
            )}

            {activePanel === "runs" && (
              <section className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                  <PanelSubhead icon={<ClipboardCheck size={14} />} title="Agent Runs" />
                  <button className="secondary-button h-8" onClick={createRun}>
                    <Plus size={14} />
                    Run
                  </button>
                </div>
                <div className="space-y-1.5">
                  {runs.length === 0 && <EmptyLine>No runs</EmptyLine>}
                  {runs.map((run) => (
                    <button
                      className={`node-row ${selectedRun?.id === run.id ? "is-active" : ""}`}
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <span className="truncate font-medium">{run.title}</span>
                      <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-[var(--muted)]">
                        <span className="pill">{run.status}</span>
                        <span className="truncate">{run.run_path}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {selectedRun && (
                  <section className="trust-block">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold">{selectedRun.title}</h2>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{selectedRun.task}</p>
                      </div>
                      <span className="pill">{selectedRun.status}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button className="secondary-button h-8" onClick={() => completeRun(selectedRun.id)}>
                        <Check size={14} />
                        Complete
                      </button>
                      <button className="secondary-button h-8" onClick={() => compileRun(selectedRun.id)}>
                        <Sparkles size={14} />
                        Compile
                      </button>
                      <button className="secondary-button h-8" onClick={createHandoff}>
                        Handoff
                      </button>
                    </div>
                    <PanelSubhead icon={<Brain size={14} />} title="Memory Used" />
                    <div className="mt-2 space-y-1">
                      {(runDetail?.memory_used ?? []).length === 0 && <EmptyLine>No memory usage</EmptyLine>}
                      {(runDetail?.memory_used ?? []).map((usage) => (
                        <div className="graph-row" key={usage.id}>
                          <span className="pill">{usage.usage_type}</span>
                          <span className="truncate">{usage.source_path}</span>
                          <span className="font-mono text-[11px]">{usage.memory_node_id.slice(0, 6)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <section className="trust-block">
                  <PanelSubhead icon={<FileText size={14} />} title="Handoffs" />
                  <div className="mt-2 space-y-1.5">
                    {handoffs.length === 0 && <EmptyLine>No handoffs</EmptyLine>}
                    {handoffs.map((handoff) => (
                      <div className="snapshot-row" key={handoff.id}>
                        <div className="min-w-0">
                          <div className="truncate">{handoff.summary}</div>
                          <time>{new Date(handoff.created_at).toLocaleString()}</time>
                        </div>
                        {handoff.project_hint && <span className="pill">{handoff.project_hint}</span>}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="trust-block">
                  <PanelSubhead icon={<Activity size={14} />} title="Stale Review" />
                  <div className="mt-2 space-y-1.5">
                    {staleMemory.length === 0 && <EmptyLine>No stale memory</EmptyLine>}
                    {staleMemory.slice(0, 6).map((candidate) => (
                      <div className="snapshot-row" key={candidate.node.id}>
                        <div className="min-w-0">
                          <div className="truncate">{candidate.node.summary}</div>
                          <div className="font-mono text-[11px] text-[var(--muted)]">{candidate.reasons.join(", ")}</div>
                        </div>
                        <span className="pill">{candidate.node.trust_level}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </section>
            )}

            {activePanel === "candidates" && (
              <CandidateReviewPanel
                candidates={filteredCandidates}
                allCandidates={candidates}
                selectedWorkspaceName={selectedWorkspace?.name ?? "workspace"}
                statusFilter={candidateStatusFilter}
                scopeFilter={candidateScopeFilter}
                riskFilter={candidateRiskFilter}
                projectFilter={candidateProjectFilter}
                riskFlags={candidateRiskFlags}
                editingCandidateId={editingCandidateId}
                draft={candidateDraft}
                onStatusFilter={setCandidateStatusFilter}
                onScopeFilter={setCandidateScopeFilter}
                onRiskFilter={setCandidateRiskFilter}
                onProjectFilter={setCandidateProjectFilter}
                onDraftChange={(patch) => setCandidateDraft((current) => ({ ...current, ...patch }))}
                onBeginEdit={beginCandidateEdit}
                onCancelEdit={cancelCandidateEdit}
                onSaveEdit={saveCandidateEdit}
                onApprove={approveCandidate}
                onReject={rejectCandidate}
                onMarkStatus={markCandidateStatus}
              />
            )}

            {activePanel === "trust" && (
              <section className="grid gap-3">
                <PanelSubhead icon={<ShieldCheck size={14} />} title="Trust Overview" />
                <div className="metric-grid">
                  <Metric label="health" value={health ? `${health.overall_score}` : "-"} />
                  <Metric label="source" value={health ? `${health.source_coverage}%` : "-"} />
                  <Metric label="candidates" value={String(candidates.filter((item) => item.status === "candidate").length)} />
                  <Metric label="trusted" value={String(trustCounts.trusted ?? 0)} />
                </div>

                {health && (
                  <section className="trust-block">
                    <div className="flex items-center justify-between gap-2">
                      <PanelSubhead icon={<Activity size={14} />} title="Memory Health" />
                      <button className="secondary-button h-8" onClick={recomputeHealth}>
                        <RefreshCw size={14} />
                        Recompute
                      </button>
                    </div>
                    <div className="health-grid">
                      <span>contradictions {health.contradiction_count}</span>
                      <span>orphans {health.orphan_node_count}</span>
                      <span>raw missing {health.raw_missing_count}</span>
                      <span>low confidence {health.low_confidence_count}</span>
                      <span>rejected {health.rejected_node_count}</span>
                      <span>stale {health.stale_node_count}</span>
                    </div>
                  </section>
                )}

                <section className="trust-block">
                  <PanelSubhead icon={<ClipboardCheck size={14} />} title="Candidate Review" />
                  <div className="mt-2 space-y-1.5">
                    {candidates.length === 0 && <EmptyLine>No candidates</EmptyLine>}
                    {candidates.slice(0, 8).map((candidate) => (
                      <article className="queue-row" key={candidate.id}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="pill">{candidate.status}</span>
                            <span className="truncate">{candidate.node.summary}</span>
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">
                            {candidate.source_refs[0]?.source_path}
                            {candidate.promotion_target_path ? ` -> ${candidate.promotion_target_path}` : ""}
                          </div>
                          {candidate.risk_flags.length > 0 && (
                            <div className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                              {candidate.risk_flags.join(", ")}
                            </div>
                          )}
                        </div>
                        {candidate.status === "candidate" && candidate.promotion_target_path && (
                          <div className="flex gap-1">
                            <button className="secondary-button h-8" onClick={() => approveCandidate(candidate.id)}>
                              <Check size={14} />
                            </button>
                            <button className="secondary-button h-8" onClick={() => rejectCandidate(candidate.id)}>
                              Reject
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>

                <section className="trust-block">
                  <PanelSubhead icon={<ClipboardCheck size={14} />} title="Promotion Queue" />
                  <div className="mt-2 space-y-1.5">
                    {promotions.length === 0 && <EmptyLine>No promotions</EmptyLine>}
                    {promotions.map((promotion) => (
                      <article className="queue-row" key={promotion.id}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="pill">{promotion.status}</span>
                            <span className="truncate font-mono text-[11px]">{promotion.source_path}</span>
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{promotion.target_path}</div>
                        </div>
                        {promotion.status === "pending" && (
                          <div className="flex gap-1">
                            <button className="secondary-button h-8" onClick={() => approvePromotion(promotion.id)}>
                              <Check size={14} />
                            </button>
                            <button className="secondary-button h-8" onClick={() => rejectPromotion(promotion.id)}>
                              Reject
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>

                <section className="trust-block">
                  <div className="flex items-center justify-between gap-2">
                    <PanelSubhead icon={<ArchiveRestore size={14} />} title="Snapshots" />
                    <button className="secondary-button h-8" onClick={createSnapshot}>
                      <Plus size={14} />
                      Create
                    </button>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {snapshots.length === 0 && <EmptyLine>No snapshots</EmptyLine>}
                    {snapshots.map((snapshot) => (
                      <div className="snapshot-row" key={snapshot.id}>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{snapshot.name}</div>
                          <time>{new Date(snapshot.created_at).toLocaleString()}</time>
                        </div>
                        <div className="flex gap-1">
                          <button className="secondary-button h-8" onClick={() => diffSnapshot(snapshot.id)}>
                            Diff
                          </button>
                          <button className="secondary-button h-8" onClick={() => rollbackDryRun(snapshot.id)}>
                            <RotateCcw size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {snapshotDiff && (
                    <div className="diff-box">
                      <span>added {snapshotDiff.added.length}</span>
                      <span>changed {snapshotDiff.changed.length}</span>
                      <span>removed {snapshotDiff.removed.length}</span>
                    </div>
                  )}
                </section>
              </section>
            )}

            {activePanel === "sync" && (
              <section className="grid gap-3">
                <PanelSubhead icon={<Users size={14} />} title="Team And Sync" />
                <div className="metric-grid">
                  <Metric label="mode" value={syncStatus?.mode ?? "-"} />
                  <Metric label="sync" value={syncStatus?.enabled ? "on" : "off"} />
                  <Metric label="events" value={String(syncStatus?.pending_events ?? 0)} />
                  <Metric label="conflicts" value={String(syncStatus?.unresolved_conflicts ?? 0)} />
                </div>

                <section className="trust-block">
                  <div className="flex items-center justify-between gap-2">
                    <PanelSubhead icon={<Database size={14} />} title="Storage" />
                    <div className="flex gap-1">
                      <button className="secondary-button h-8" onClick={pullSync}>
                        Pull
                      </button>
                      <button className="secondary-button h-8" onClick={pushSync}>
                        Push
                      </button>
                    </div>
                  </div>
                  <MetaGrid
                    items={[
                      ["object_store", syncStatus?.object_storage.configured ? "configured" : "local"],
                      ["bucket", syncStatus?.object_storage.bucket ?? "none"]
                    ]}
                  />
                </section>

                <section className="trust-block">
                  <PanelSubhead icon={<Users size={14} />} title="Members" />
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_110px_auto] gap-2">
                    <input
                      className="control h-9 min-w-0"
                      value={memberHandle}
                      onChange={(event) => setMemberHandle(event.target.value)}
                    />
                    <select className="control h-9" value={memberRole} onChange={(event) => setMemberRole(event.target.value as TeamMember["role"])}>
                      {["agent", "viewer", "editor", "admin", "owner"].map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <button className="secondary-button h-9" onClick={addTeamMember}>
                      Add
                    </button>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {teamMembers.length === 0 && <EmptyLine>No team members</EmptyLine>}
                    {teamMembers.map((member) => (
                      <div className="snapshot-row" key={member.id}>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{member.handle}</div>
                          <div className="truncate text-[11px] text-[var(--muted)]">{member.display_name ?? "MemFS actor"}</div>
                        </div>
                        <select
                          className="control h-8 w-28"
                          value={member.role}
                          onChange={(event) => updateTeamRole(member.handle, event.target.value as TeamMember["role"])}
                        >
                          {["owner", "admin", "editor", "agent", "viewer"].map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="trust-block">
                  <PanelSubhead icon={<GitBranch size={14} />} title="Conflict Inbox" />
                  <div className="mt-2 space-y-1.5">
                    {syncConflicts.length === 0 && <EmptyLine>No sync conflicts</EmptyLine>}
                    {syncConflicts.map((conflict) => (
                      <article className="queue-row" key={conflict.id}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="pill">{conflict.status}</span>
                            <span className="truncate font-mono text-[11px]">{conflict.conflict_type}</span>
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">
                            {conflict.object_type}/{conflict.object_id}
                          </div>
                        </div>
                        {conflict.status === "unresolved" && (
                          <div className="flex flex-wrap gap-1">
                            <button className="secondary-button h-8" onClick={() => resolveSyncConflict(conflict.id, "keep_local")}>
                              Local
                            </button>
                            <button className="secondary-button h-8" onClick={() => resolveSyncConflict(conflict.id, "keep_remote")}>
                              Remote
                            </button>
                            <button className="secondary-button h-8" onClick={() => resolveSyncConflict(conflict.id, "keep_both")}>
                              Both
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              </section>
            )}

            {activePanel === "audit" && (
              <section>
                <PanelSubhead icon={<Check size={14} />} title="Audit Events" />
                <input
                  className="control mt-2 h-9 w-full"
                  value={auditFilter}
                  onChange={(event) => setAuditFilter(event.target.value)}
                  placeholder="filter events or actors"
                />
                <div className="mt-2 space-y-1.5">
                  {filteredAudit.length === 0 && <EmptyLine>No audit events</EmptyLine>}
                  {filteredAudit.map((event) => (
                    <div key={event.id} className="audit-row">
                      <span className="truncate">{event.event_type}</span>
                      <time>{new Date(event.created_at).toLocaleTimeString()}</time>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {rawViewer && (
              <section className="border-t border-[var(--line)] pt-3">
                <PanelSubhead icon={<FileText size={14} />} title="Raw Source" />
                <div className="mt-2 font-mono text-[11px] text-[var(--muted)]">{rawViewer.nodeId}</div>
                <pre className="raw-box max-h-64">{rawViewer.content}</pre>
              </section>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function CandidateReviewPanel({
  candidates,
  allCandidates,
  selectedWorkspaceName,
  statusFilter,
  scopeFilter,
  riskFilter,
  projectFilter,
  riskFlags,
  editingCandidateId,
  draft,
  onStatusFilter,
  onScopeFilter,
  onRiskFilter,
  onProjectFilter,
  onDraftChange,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onApprove,
  onReject,
  onMarkStatus
}: {
  candidates: MemoryCandidate[];
  allCandidates: MemoryCandidate[];
  selectedWorkspaceName: string;
  statusFilter: string;
  scopeFilter: string;
  riskFilter: string;
  projectFilter: string;
  riskFlags: string[];
  editingCandidateId: string;
  draft: CandidateDraft;
  onStatusFilter: (value: string) => void;
  onScopeFilter: (value: string) => void;
  onRiskFilter: (value: string) => void;
  onProjectFilter: (value: string) => void;
  onDraftChange: (patch: Partial<CandidateDraft>) => void;
  onBeginEdit: (candidate: MemoryCandidate) => void;
  onCancelEdit: () => void;
  onSaveEdit: (candidateId: string) => void;
  onApprove: (candidateId: string, targetPath?: string) => void;
  onReject: (candidateId: string) => void;
  onMarkStatus: (candidateId: string, status: "stale" | "conflicted") => void;
}) {
  const pendingCount = allCandidates.filter((candidate) => ["observed", "candidate", "duplicate", "conflicted"].includes(candidate.status)).length;

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <PanelSubhead icon={<Inbox size={14} />} title="Memory Candidates" />
        <span className="counter">{pendingCount}</span>
      </div>

      <div className="candidate-filter-grid">
        <select className="control h-9" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
          <option value="all">all status</option>
          {candidateStatusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select className="control h-9" value={scopeFilter} onChange={(event) => onScopeFilter(event.target.value)}>
          <option value="all">all scope</option>
          {scopeOptions.map((scope) => (
            <option key={scope} value={scope}>
              {scope}
            </option>
          ))}
        </select>
        <select className="control h-9" value={riskFilter} onChange={(event) => onRiskFilter(event.target.value)}>
          <option value="all">all risk</option>
          {riskFlags.map((risk) => (
            <option key={risk} value={risk}>
              {risk}
            </option>
          ))}
        </select>
        <input
          className="control h-9"
          value={projectFilter}
          onChange={(event) => onProjectFilter(event.target.value)}
          placeholder="project, repo, or source"
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span className="truncate">Workspace: {selectedWorkspaceName}</span>
        <span className="font-mono">{candidates.length}/{allCandidates.length}</span>
      </div>

      {allCandidates.length === 0 && (
        <EmptyLine>Agents can propose memories after runs. Run compilation and archive extraction will place reviewable candidates here.</EmptyLine>
      )}
      {allCandidates.length > 0 && candidates.length === 0 && <EmptyLine>No candidates match these filters</EmptyLine>}

      <div className="space-y-2">
        {candidates.map((candidate) => {
          const editing = editingCandidateId === candidate.id;
          const terminal = ["approved", "rejected", "superseded"].includes(candidate.status);
          const materialRisk = candidate.risk_flags.some((risk) => risk !== "none");
          return (
            <article className="candidate-card" key={candidate.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="pill">{candidate.status}</span>
                    <span className="pill">{candidate.type}</span>
                    <span className="pill">{candidate.scope}</span>
                    {materialRisk && (
                      <span className="risk-pill">
                        <AlertTriangle size={12} />
                        risk
                      </span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-5">{candidate.memory_text}</p>
                </div>
                <span className="score">{candidate.confidence.toFixed(2)}</span>
              </div>

              {editing ? (
                <div className="candidate-edit-grid">
                  <label>
                    <span>Memory</span>
                    <textarea
                      className="control min-h-28 w-full py-2"
                      value={draft.memory_text}
                      onChange={(event) => onDraftChange({ memory_text: event.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span>Type</span>
                      <select className="control h-9 w-full" value={draft.type} onChange={(event) => onDraftChange({ type: event.target.value })}>
                        {memoryTypeOptions.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Scope</span>
                      <select className="control h-9 w-full" value={draft.scope} onChange={(event) => onDraftChange({ scope: event.target.value })}>
                        {scopeOptions.map((scope) => (
                          <option key={scope} value={scope}>
                            {scope}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span>Project</span>
                      <input
                        className="control h-9 w-full"
                        value={draft.project_slug}
                        onChange={(event) => onDraftChange({ project_slug: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Repo</span>
                      <input
                        className="control h-9 w-full"
                        value={draft.repo_path}
                        onChange={(event) => onDraftChange({ repo_path: event.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    <span>Tags</span>
                    <input
                      className="control h-9 w-full"
                      value={draft.tags}
                      onChange={(event) => onDraftChange({ tags: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Target path</span>
                    <input
                      className="control h-9 w-full font-mono text-xs"
                      value={draft.promotion_target_path}
                      onChange={(event) => onDraftChange({ promotion_target_path: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Reason</span>
                    <input
                      className="control h-9 w-full"
                      value={draft.reason}
                      onChange={(event) => onDraftChange({ reason: event.target.value })}
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <button className="primary-button h-8" onClick={() => onSaveEdit(candidate.id)}>
                      <Save size={14} />
                      Save
                    </button>
                    <button className="secondary-button h-8" onClick={onCancelEdit}>
                      <X size={14} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <MetaGrid
                    items={[
                      ["target", candidate.promotion_target_path ?? "required before approval"],
                      ["created_by", candidate.created_by],
                      ["created_at", new Date(candidate.created_at).toLocaleString()],
                      ["reason", candidate.reason ?? "none"],
                      ["project", candidate.node.project_slug ?? "none"],
                      ["repo", candidate.node.repo_path ?? "none"]
                    ]}
                  />
                  <TagList tags={candidate.node.tags} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(candidate.risk_flags.length ? candidate.risk_flags : ["none"]).map((risk) => (
                      <span className={risk === "none" ? "pill" : "risk-pill"} key={risk}>
                        {risk !== "none" && <AlertTriangle size={12} />}
                        {risk}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1">
                    {candidate.source_refs.map((source, index) => (
                      <div className="source-ref-row" key={`${source.source_path}-${index}`}>
                        <span className="truncate">{source.source_path}</span>
                        <span className="truncate">{source.raw_ref}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="candidate-action-row">
                <button className="secondary-button h-8" onClick={() => onBeginEdit(candidate)}>
                  <Pencil size={14} />
                  Edit
                </button>
                <button
                  className="primary-button h-8"
                  onClick={() => onApprove(candidate.id, candidate.promotion_target_path ?? undefined)}
                  disabled={terminal}
                  title="Approve through the candidate promotion API"
                >
                  <Check size={14} />
                  Approve
                </button>
                <button className="secondary-button h-8" onClick={() => onReject(candidate.id)} disabled={candidate.status === "rejected"}>
                  <Ban size={14} />
                  Reject
                </button>
                <button className="secondary-button h-8" onClick={() => onMarkStatus(candidate.id, "stale")} disabled={candidate.status === "stale"}>
                  Stale
                </button>
                <button className="secondary-button h-8" onClick={() => onMarkStatus(candidate.id, "conflicted")} disabled={candidate.status === "conflicted"}>
                  Conflict
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ResultList({
  results,
  empty,
  onLoadRaw
}: {
  results: RecallResult[];
  empty: string;
  onLoadRaw: (nodeId: string) => void;
}) {
  return (
    <div className="space-y-2">
      {results.length === 0 && <EmptyLine>{empty}</EmptyLine>}
      {results.map((result) => (
        <article key={result.node_id} className="result-item">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold leading-5">{result.summary}</h2>
            <span className="score">{result.score.toFixed(2)}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{result.trigger}</p>
          {result.detail && <p className="mt-2 text-xs leading-5">{result.detail}</p>}
          <MetaGrid
            items={[
              ["type", result.memory_type],
              ["importance", String(result.importance)],
              ...(result.trust_level ? [["trust", result.trust_level], ["status", result.status ?? "active"]] as Array<[string, string]> : []),
              ["source", result.source_path],
              ...(result.source_kind ? [["source_kind", result.source_kind]] as Array<[string, string]> : []),
              ["source_location", compactSourceLocation(result.source_location)],
              ["raw_ref", result.raw_ref]
            ]}
          />
          <TagList tags={result.tags} />
          {result.warnings && result.warnings.length > 0 && (
            <div className="warning-row">{result.warnings.join(" ")}</div>
          )}
          {result.why && (
            <section className="why-box">
              <p>{result.why.explanation}</p>
              <div className="why-grid">
                <span>trigger {result.why.trigger_similarity.toFixed(2)}</span>
                <span>summary {result.why.summary_similarity.toFixed(2)}</span>
                <span>keyword {result.why.keyword_score.toFixed(2)}</span>
                <span>graph {result.why.graph_score.toFixed(2)}</span>
              </div>
              {result.why.matched_terms.length > 0 && (
                <div className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                  matched {result.why.matched_terms.join(", ")}
                </div>
              )}
            </section>
          )}
          {result.links && result.links.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.links.slice(0, 3).map((link) => (
                <div className="graph-row" key={link.id}>
                  <span className="pill">{link.relation_type}</span>
                  <span className="truncate">{link.other_summary}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            {result.raw_excerpt ? <span className="text-xs text-[var(--muted)]">Raw excerpt loaded</span> : <span />}
            <button className="secondary-button h-8" onClick={() => onLoadRaw(result.node_id)}>
              <Eye size={14} />
              Raw
            </button>
          </div>
          {result.raw_excerpt && <pre className="raw-box">{result.raw_excerpt}</pre>}
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tags.slice(0, 8).map((tag) => (
        <span className="pill" key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function MetaGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="meta-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PanelHeader({
  icon,
  title,
  count,
  detail
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  detail?: string;
}) {
  return (
    <div className="flex h-11 items-center justify-between border-b border-[var(--line)] px-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      {count !== undefined && <span className="counter">{count}</span>}
      {detail && <span className="text-xs text-[var(--muted)]">{detail}</span>}
    </div>
  );
}

function PanelSubhead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button className="icon-button h-9 w-9" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-[var(--line)] px-3 py-4 text-sm text-[var(--muted)]">{children}</div>;
}

function emptyCandidateDraft(): CandidateDraft {
  return {
    memory_text: "",
    type: "fact",
    scope: "workspace",
    tags: "",
    reason: "",
    promotion_target_path: "",
    project_slug: "",
    repo_path: ""
  };
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

function defaultTargetPathForCandidate(candidate: MemoryCandidate | undefined): string {
  if (!candidate) return "/memory/reviewed.md";
  if (candidate.promotion_target_path) return candidate.promotion_target_path;
  if (candidate.scope === "project" && candidate.node.project_slug && candidate.type === "decision") {
    return `/projects/${candidate.node.project_slug}/decisions.md`;
  }
  if (candidate.scope === "project" && candidate.node.project_slug && candidate.type === "constraint") {
    return `/projects/${candidate.node.project_slug}/constraints.md`;
  }
  if (candidate.type === "preference") return "/preferences.md";
  return "/memory/reviewed.md";
}

function trustSummary(nodes: MemoryNode[]): Record<string, number> {
  return nodes.reduce<Record<string, number>>((counts, node) => {
    const key = node.trust_level ?? "source_backed";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function extractionReason(source: ExtractedSource): string {
  const metadata = parseMaybeJson(source.metadata_json);
  return typeof metadata?.reason === "string" ? metadata.reason : "(no extracted text)";
}

function parseMaybeJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function compactSourceLocation(location: Record<string, unknown> | null | undefined): string {
  if (!location) return "none";
  const type = typeof location.type === "string" ? `${location.type}: ` : "";
  const rest = Object.entries(location)
    .filter(([key]) => key !== "type")
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `${type}${rest || "document"}`;
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `Request failed with ${response.status}.`);
  }

  return response.json() as Promise<T>;
}
