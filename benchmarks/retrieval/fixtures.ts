export type FixtureLabel =
  | "authDecision"
  | "oldAuthDecision"
  | "supabaseRunError"
  | "supabaseHandoff"
  | "largeUploadRunError"
  | "largeUploadCandidate"
  | "largeUploadReasoning"
  | "deploymentConstraint"
  | "legacyDeploymentConstraint"
  | "creatorPreference"
  | "creatorArchive"
  | "onboardingFact"
  | "onboardingDecision"
  | "onboardingFailure";

type RetrievalMode = "grep" | "brief";

interface FixtureFile {
  label: FixtureLabel;
  path: string;
  content: string;
  allowProtected?: boolean;
  stale?: string;
}

interface FixtureRun {
  label: "supabase" | "largeUpload" | "onboarding";
  task: string;
  title: string;
  result: string;
  errors?: string;
  followups?: string;
  handoffProject?: string;
  compileReasoning?: boolean;
}

interface FixtureArchive {
  label: FixtureLabel;
  archive_type: "conversation" | "transcript" | "imported" | "agent-run" | "raw";
  title: string;
  content: string;
}

export interface BenchmarkQuery {
  id: string;
  query: string;
  mode: RetrievalMode;
  expected: FixtureLabel[];
  absent?: FixtureLabel[];
  projectSlug?: string;
  files?: string[];
  trustedPreferred?: boolean;
  limit?: number;
}

export const fixtureFiles: FixtureFile[] = [
  {
    label: "authDecision",
    path: "/projects/auth/decisions.md",
    allowProtected: true,
    content:
      "Decision: OAuth refresh tokens are stored server-side, rotated on login, and never written to browser localStorage."
  },
  {
    label: "oldAuthDecision",
    path: "/projects/auth/decisions-old.md",
    allowProtected: true,
    content:
      "Decision: OAuth refresh tokens were stored in browser localStorage during the alpha prototype."
  },
  {
    label: "deploymentConstraint",
    path: "/projects/pipsqueak/constraints.md",
    allowProtected: true,
    content:
      "Constraint: Deployment constraints require Netlify hosting, Netlify Functions for backend MVP work, and no long-running server process."
  },
  {
    label: "legacyDeploymentConstraint",
    path: "/memory/legacy-deployment.md",
    content:
      "Constraint: Deployment constraints require a Railway Node server and persistent worker for the legacy prototype.",
    stale: "The deployment target changed to Netlify."
  },
  {
    label: "creatorPreference",
    path: "/preferences.md",
    allowProtected: true,
    content:
      "Preference: Creator outreach preferences favor concise warm emails, clear collaboration terms, and no automated bulk DMs."
  },
  {
    label: "onboardingFact",
    path: "/projects/pipsqueak/facts.md",
    allowProtected: true,
    content:
      "Fact: Pipsqueak onboarding edits usually touch apps/web/src/onboarding.tsx and the onboarding checklist copy."
  },
  {
    label: "onboardingDecision",
    path: "/projects/pipsqueak/decisions.md",
    allowProtected: true,
    content:
      "Decision: Before editing onboarding, preserve the first useful result flow and keep setup steps under three screens."
  }
];

export const fixtureRuns: FixtureRun[] = [
  {
    label: "supabase",
    title: "Debug Supabase auth 401",
    task: "Fix Supabase auth 401 during OAuth refresh token renewal.",
    result:
      "Result: Supabase auth 401 was caused by sending an expired access token after refresh rotation. The fix retries with the refreshed token.",
    errors:
      "Error: Supabase auth 401 appeared when OAuth refresh tokens rotated but the client reused the stale access token.",
    followups: "Follow up: Add a regression check for invalid_grant and stale bearer token handling.",
    handoffProject: "auth"
  },
  {
    label: "largeUpload",
    title: "Debug large upload failed",
    task: "Investigate why large upload failed through the serverless function.",
    result:
      "Result: Large upload failed because the function proxied the full binary. Use signed upload URLs and direct object storage uploads.",
    errors:
      "Error: Large upload failed with timeout and payload limit errors while proxying video bytes through the function.",
    followups: "Follow up: Keep upload progress in the client and store the final object key.",
    compileReasoning: true
  },
  {
    label: "onboarding",
    title: "Review onboarding edit",
    task: "Prepare to edit Pipsqueak onboarding.",
    result:
      "Result: Onboarding edits should keep the first useful result visible and avoid adding another setup screen.",
    errors: "Error: A previous onboarding edit failed because it hid the first useful result behind extra configuration.",
    followups: "Follow up: Check apps/web/src/onboarding.tsx before changing checklist copy."
  }
];

export const fixtureArchives: FixtureArchive[] = [
  {
    label: "creatorArchive",
    archive_type: "conversation",
    title: "Creator outreach transcript",
    content:
      "Transcript: The user said creator outreach preferences should stay warm, concise, and human-reviewed. Do not treat external creator replies as durable user preferences without review."
  }
];

export const benchmarkQueries: BenchmarkQuery[] = [
  {
    id: "oauth-refresh",
    query: "OAuth refresh tokens",
    mode: "grep",
    expected: ["authDecision"],
    absent: ["oldAuthDecision"],
    trustedPreferred: true
  },
  {
    id: "supabase-401",
    query: "Supabase auth 401",
    mode: "grep",
    expected: ["supabaseRunError", "supabaseHandoff"],
    trustedPreferred: false
  },
  {
    id: "large-upload",
    query: "large upload failed",
    mode: "grep",
    expected: ["largeUploadRunError", "largeUploadCandidate", "largeUploadReasoning"],
    trustedPreferred: false
  },
  {
    id: "deployment",
    query: "deployment constraints",
    mode: "grep",
    expected: ["deploymentConstraint"],
    absent: ["legacyDeploymentConstraint"],
    projectSlug: "pipsqueak",
    trustedPreferred: true
  },
  {
    id: "creator-outreach",
    query: "creator outreach preferences",
    mode: "grep",
    expected: ["creatorPreference", "creatorArchive"],
    trustedPreferred: true
  },
  {
    id: "onboarding-brief",
    query: "what should I remember before editing onboarding?",
    mode: "brief",
    expected: ["onboardingFact", "onboardingDecision", "onboardingFailure"],
    absent: ["legacyDeploymentConstraint"],
    projectSlug: "pipsqueak",
    files: ["apps/web/src/onboarding.tsx"],
    trustedPreferred: true
  }
];

export const benchmarkLimitations = [
  "The fixture uses deterministic local extraction and hash embeddings, not a hosted embedding model.",
  "Scores are useful for regression checks inside this repo, not for comparing VeriFS to external systems.",
  "The corpus is intentionally tiny, so top-k metrics can move when ranking heuristics change.",
  "Run and archive paths are generated at runtime; expected labels are resolved after seeding."
];
