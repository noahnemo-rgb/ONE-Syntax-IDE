import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Auth.js tables
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  githubLogin: text("github_login"),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// Organizations and billing
// ---------------------------------------------------------------------------

export const planEnum = pgEnum("plan", ["free", "pro", "team", "enterprise"]);
export const roleEnum = pgEnum("member_role", ["owner", "admin", "member"]);

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  aiTriageEnabled: boolean("ai_triage_enabled").notNull().default(true),
  retentionDays: integer("retention_days").notNull().default(90),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  plan: planEnum("plan").notNull(),
  priceId: text("price_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Source code
// ---------------------------------------------------------------------------

export const repoSourceEnum = pgEnum("repo_source", ["github", "upload"]);

export const githubInstallations = pgTable("github_installations", {
  installationId: bigint("installation_id", { mode: "number" }).primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  accountLogin: text("account_login").notNull(),
  suspended: boolean("suspended").notNull().default(false),
  createdAt: createdAt(),
});

export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    source: repoSourceEnum("source").notNull(),
    name: text("name").notNull(),
    githubInstallationId: bigint("github_installation_id", { mode: "number" }).references(
      () => githubInstallations.installationId,
      { onDelete: "cascade" },
    ),
    githubRepoId: bigint("github_repo_id", { mode: "number" }),
    defaultBranch: text("default_branch"),
    isPrivate: boolean("is_private").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("repos_org_github_repo_uq").on(t.orgId, t.githubRepoId)],
);

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Live targets
// ---------------------------------------------------------------------------

export const scanProfileEnum = pgEnum("scan_profile", ["passive", "active"]);
export const verificationMethodEnum = pgEnum("verification_method", ["dns", "http"]);

export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    verificationToken: text("verification_token").notNull(),
    verificationMethod: verificationMethodEnum("verification_method"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
    profile: scanProfileEnum("profile").notNull().default("passive"),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("targets_org_hostname_uq").on(t.orgId, t.hostname)],
);

export const attestations = pgTable("attestations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  targetId: uuid("target_id")
    .notNull()
    .references(() => targets.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  profile: scanProfileEnum("profile").notNull(),
  statement: text("statement").notNull(),
  signerName: text("signer_name").notNull(),
  signerTitle: text("signer_title"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Scans and findings
// ---------------------------------------------------------------------------

export const scanKindEnum = pgEnum("scan_kind", ["code", "web"]);
export const scanStatusEnum = pgEnum("scan_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    kind: scanKindEnum("kind").notNull(),
    repoId: uuid("repo_id").references(() => repos.id, { onDelete: "cascade" }),
    uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
    targetId: uuid("target_id").references(() => targets.id, { onDelete: "cascade" }),
    profile: scanProfileEnum("profile"),
    ref: text("ref"),
    commitSha: text("commit_sha"),
    status: scanStatusEnum("status").notNull().default("queued"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    attempts: integer("attempts").notNull().default(0),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    logs: text("logs").notNull().default(""),
    summary: jsonb("summary").$type<Record<string, number>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("scans_queue_idx").on(t.status, t.kind, t.createdAt),
    index("scans_org_idx").on(t.orgId, t.createdAt),
  ],
);

export const severityEnum = pgEnum("severity", ["critical", "high", "medium", "low", "info"]);
export const findingCategoryEnum = pgEnum("finding_category", [
  "sast",
  "dependency",
  "secret",
  "iac",
  "web",
]);
export const aiVerdictEnum = pgEnum("ai_verdict", [
  "true_positive",
  "false_positive",
  "needs_review",
]);
export const findingStatusEnum = pgEnum("finding_status", ["open", "dismissed", "fixed"]);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    tools: text("tools").array().notNull(),
    ruleId: text("rule_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    severity: severityEnum("severity").notNull(),
    category: findingCategoryEnum("category").notNull(),
    cwe: text("cwe"),
    filePath: text("file_path"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    url: text("url"),
    evidence: text("evidence"),
    packageName: text("package_name"),
    installedVersion: text("installed_version"),
    fixedVersion: text("fixed_version"),
    aiVerdict: aiVerdictEnum("ai_verdict"),
    aiConfidence: real("ai_confidence"),
    aiSeverity: severityEnum("ai_severity"),
    aiExplanation: text("ai_explanation"),
    aiFixDiff: text("ai_fix_diff"),
    status: findingStatusEnum("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("findings_scan_fingerprint_uq").on(t.scanId, t.fingerprint),
    index("findings_org_idx").on(t.orgId),
  ],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id"),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    ipAddress: text("ip_address"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt)],
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const abuseReports = pgTable("abuse_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterEmail: text("reporter_email").notNull(),
  affectedHost: text("affected_host").notNull(),
  sourceIp: text("source_ip"),
  observedAt: text("observed_at"),
  description: text("description").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: createdAt(),
});
