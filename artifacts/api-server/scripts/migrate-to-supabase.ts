import crypto from "node:crypto";
import { pool } from "@workspace/db";

const url = process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = process.env.MIGRATION_RUN_ID || crypto.randomUUID();
const PAGE_SIZE = 250;
const BUCKET = "trading-attachments";

if (!url || !publishableKey || !serviceKey) {
  throw new Error("Supabase migration environment is incomplete: set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY.");
}

const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

type Attachment = { path: string; bytes: Buffer; contentType: string; sourceHash: string };
type Verification = { categories: Record<string, { count: number; hash: string }>; attachments: { count: number; hash: string } };

function sha256(value: Buffer | string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** JSON.stringify is not stable for objects assembled in a different key order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path}: ${response.status} ${text || response.statusText}`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${init.method || "GET"} ${path}: expected JSON response, received ${text.slice(0, 200)}`);
  }
}

async function allAuthUsers() {
  const users: any[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await request(`/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`);
    if (!Array.isArray(listed?.users)) throw new Error(`Auth user list page ${page} did not contain a users array`);
    users.push(...listed.users);
    if (listed.users.length < PAGE_SIZE) return users;
  }
}

async function getOrCreateUser(email: string, legacyUserId: string, authUsers: Map<string, any>, usersById: Map<string, any>, mappedUserId?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Cannot migrate a legacy user with an empty email address");
  if (mappedUserId) {
    const mapped = usersById.get(mappedUserId);
    if (!mapped) throw new Error(`Legacy mapping ${legacyUserId} points to missing Auth user ${mappedUserId}`);
    if (mapped.email?.toLowerCase() !== normalizedEmail) throw new Error(`Legacy mapping ${legacyUserId} email does not match its Auth user`);
    return mapped;
  }
  const existing = authUsers.get(normalizedEmail);
  if (existing) {
    throw new Error(`Auth email collision for ${email}; manual identity reconciliation is required`);
  }
  const created = await request("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      // 32 bytes base64url is below bcrypt's 72-byte password limit.
      password: crypto.randomBytes(32).toString("base64url"),
      email_confirm: true,
      user_metadata: { migrated_from: "trading-os-legacy" },
    }),
  });
  if (!created?.id) throw new Error(`Supabase did not return an id while creating ${email}`);
  authUsers.set(normalizedEmail, created);
  usersById.set(created.id, created);
  return created;
}

function safeName(value: unknown) {
  return String(value || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "attachment";
}

function parseAttachment(dataUrl: string, name: unknown, userId: string): Attachment {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/s);
  if (!match) throw new Error(`Unrecoverable attachment "${safeName(name)}": dataUrl is not a valid base64 data URL`);
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length) throw new Error(`Unrecoverable attachment "${safeName(name)}": dataUrl decoded to an empty file`);
  const sourceHash = sha256(bytes);
  // Content-addressed paths make retries and resumed runs overwrite the same object, never create duplicates.
  return {
    path: `${userId}/legacy/${sourceHash.slice(0, 2)}/${sourceHash}-${safeName(name)}`,
    bytes,
    contentType: match[1] || "application/octet-stream",
    sourceHash,
  };
}

async function uploadAndVerifyAttachment(attachment: Attachment) {
  const upload = await fetch(`${url}/storage/v1/object/${BUCKET}/${attachment.path}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": attachment.contentType,
      "x-upsert": "true",
    },
    body: attachment.bytes,
  });
  const uploadText = await upload.text();
  if (!upload.ok) throw new Error(`Attachment upload ${attachment.path} failed: ${upload.status} ${uploadText || upload.statusText}`);

  const downloaded = await fetch(`${url}/storage/v1/object/${BUCKET}/${attachment.path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!downloaded.ok) throw new Error(`Attachment verification download ${attachment.path} failed: ${downloaded.status} ${await downloaded.text()}`);
  const storedHash = sha256(Buffer.from(await downloaded.arrayBuffer()));
  if (storedHash !== attachment.sourceHash) throw new Error(`Attachment verification failed for ${attachment.path}: expected ${attachment.sourceHash}, got ${storedHash}`);
}

async function migrateAttachments(value: any, userId: string, attachments: Attachment[]): Promise<any> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => migrateAttachments(item, userId, attachments)));
  if (!value || typeof value !== "object") return value;
  const copy: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) copy[key] = await migrateAttachments(child, userId, attachments);
  if (typeof copy.dataUrl === "string" && copy.dataUrl.startsWith("data:")) {
    const attachment = parseAttachment(copy.dataUrl, copy.name, userId);
    await uploadAndVerifyAttachment(attachment);
    attachments.push(attachment);
    copy.storagePath = attachment.path;
    copy.dataUrl = null;
    copy.tooBig = false;
  }
  return copy;
}

function verification(source: unknown, attachments: Attachment[]): Verification {
  const categories: Verification["categories"] = {};
  const root = source && typeof source === "object" && !Array.isArray(source) ? source as Record<string, unknown> : { state: source };
  for (const [name, value] of Object.entries(root)) {
    categories[name] = { count: Array.isArray(value) ? value.length : value == null ? 0 : 1, hash: sha256(canonicalJson(value)) };
  }
  const hashes = attachments.map((item) => item.sourceHash).sort();
  return { categories, attachments: { count: attachments.length, hash: sha256(hashes.join("\n")) } };
}

async function recordRun(status: "running" | "completed" | "failed", details: Record<string, unknown>) {
  const body = { id: runId, status, details, updated_at: new Date().toISOString(), ...(status === "running" ? { started_at: new Date().toISOString() } : { completed_at: new Date().toISOString() }) };
  await request("/rest/v1/migration_runs?on_conflict=id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(body),
  });
}

async function checkpoint(legacyUserId: string, status: "completed" | "failed", details: Record<string, unknown>) {
  await request("/rest/v1/migration_checkpoints?on_conflict=run_id,legacy_user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ run_id: runId, legacy_user_id: legacyUserId, status, details, updated_at: new Date().toISOString() }),
  });
}

async function requestRecovery(email: string) {
  const response = await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: publishableKey!, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Password recovery request for ${email} failed: ${response.status} ${text || response.statusText}`);
}

async function run() {
  await recordRun("running", { source: "legacy-postgres", rollback_window: "See scripts/MIGRATION-ROLLOUT.md" });
  const listedUsers = await allAuthUsers();
  const authUsers = new Map(listedUsers.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user]));
  const usersById = new Map(listedUsers.map((user) => [user.id, user]));
  const mappings = await request("/rest/v1/legacy_migrations?select=legacy_user_id,user_id");
  const mappedUsers = new Map((Array.isArray(mappings) ? mappings : []).map((item) => [String(item.legacy_user_id), item.user_id]));
  const existingOwners = await request("/rest/v1/profiles?role=eq.owner&select=legacy_user_id,email");
  const configuredOwnerEmail = process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase();
  if (Array.isArray(existingOwners) && existingOwners.length > 1) throw new Error("More than one migrated owner profile exists; reconcile roles before migrating");
  const preservedOwnerId = Array.isArray(existingOwners) && existingOwners.length === 1 ? String(existingOwners[0].legacy_user_id || "") : "";
  if (Array.isArray(existingOwners) && existingOwners.length === 1 && !preservedOwnerId) {
    throw new Error("The existing owner profile has no legacy identity mapping; reconcile it before migrating");
  }
  if (!configuredOwnerEmail && !preservedOwnerId) throw new Error("LEGACY_OWNER_EMAIL is required for the first migration");
  let configuredOwnerId = "";
  if (configuredOwnerEmail) {
    const owner = await pool.query("select id from users where lower(email)=$1", [configuredOwnerEmail]);
    if (owner.rowCount !== 1) throw new Error("LEGACY_OWNER_EMAIL must resolve to exactly one legacy user");
    configuredOwnerId = String(owner.rows[0].id);
    if (preservedOwnerId && preservedOwnerId !== configuredOwnerId) throw new Error("LEGACY_OWNER_EMAIL conflicts with the existing owner mapping");
  }
  const expectedOwnerId = preservedOwnerId || configuredOwnerId;
  const checkpoints = await request(`/rest/v1/migration_checkpoints?run_id=eq.${encodeURIComponent(runId)}&status=eq.completed&select=legacy_user_id,details`);
  const completed = new Map((Array.isArray(checkpoints) ? checkpoints : []).map((item) => [String(item.legacy_user_id), item.details?.source_checksum]));
  let migrated = 0;
  let attachmentCount = 0;
  let afterId = 0;
  for (;;) {
    const result = await pool.query(
      `select u.id,u.email,s.data from users u left join app_state s on s.user_id=u.id where u.id>$1 order by u.id asc limit $2`,
      [afterId, PAGE_SIZE],
    );
    if (!result.rows.length) break;
    for (const row of result.rows) {
    try {
      const rawState = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
      const sourceChecksum = sha256(canonicalJson(rawState));
      if (completed.get(String(row.id)) === sourceChecksum) continue;
      const previousMigrations = await request(`/rest/v1/legacy_migrations?legacy_user_id=eq.${encodeURIComponent(String(row.id))}&select=source_checksum`);
      // Any prior migration record means the account has already received its
      // claiming email. A checksum change should refresh data, not spam email.
      const alreadyClaimable = Array.isArray(previousMigrations) && previousMigrations.length > 0;
      const authUser = await getOrCreateUser(row.email, String(row.id), authUsers, usersById, mappedUsers.get(String(row.id)));
      const attachments: Attachment[] = [];
      const state = await migrateAttachments(rawState, authUser.id, attachments);
      const checks = verification(rawState, attachments);
      const isOwner = String(row.id) === expectedOwnerId;
      const profile = { id: authUser.id, email: row.email, legacy_user_id: row.id, role: isOwner ? "owner" : "user" };
      await request("/rest/v1/profiles?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(profile) });
      await request("/rest/v1/rpc/sync_trading_state_for_user", { method: "POST", body: JSON.stringify({ target_user_id: authUser.id, state }) });
      const target = await request(`/rest/v1/app_state?user_id=eq.${encodeURIComponent(authUser.id)}&select=data`);
      if (!Array.isArray(target) || target.length !== 1 || sha256(canonicalJson(target[0].data)) !== sha256(canonicalJson(state))) throw new Error("app_state read-back checksum did not match the written state");
      await request("/rest/v1/legacy_migrations?on_conflict=legacy_user_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ legacy_user_id: row.id, user_id: authUser.id, attachment_count: attachments.length, source_checksum: sourceChecksum, verification: checks }),
      });
      if (!alreadyClaimable) await requestRecovery(row.email);
      await checkpoint(row.id, "completed", { user_id: authUser.id, source_checksum: sourceChecksum, verification: checks });
      migrated += 1;
      attachmentCount += attachments.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await checkpoint(row.id, "failed", { error: message });
      throw new Error(`Migration failed for legacy user ${row.id} (${row.email}): ${message}`);
    }
    }
    afterId = Number(result.rows[result.rows.length - 1].id);
  }
  const ownersAfter = await request("/rest/v1/profiles?role=eq.owner&select=legacy_user_id");
  if (!Array.isArray(ownersAfter) || ownersAfter.length !== 1 || String(ownersAfter[0].legacy_user_id || "") !== expectedOwnerId) {
    throw new Error("Post-migration owner verification failed: expected exactly one mapped owner");
  }
  await recordRun("completed", { users: migrated, attachments: attachmentCount });
  console.log(JSON.stringify({ runId, migrated, attachmentCount }));
}

run().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try { await recordRun("failed", { error: message }); } catch (recordError) { console.error(`Could not record failed migration run: ${recordError}`); }
  console.error(message);
  await pool.end();
  process.exit(1);
}).then(() => pool.end());