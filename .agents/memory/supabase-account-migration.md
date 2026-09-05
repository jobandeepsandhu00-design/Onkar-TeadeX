---
name: Supabase account migration
description: Durable constraints for migrating legacy Trading OS identities into Supabase Auth.
---

Create migrated identities with random temporary passwords and require users to claim them through Supabase password recovery. Keep generated passwords below bcrypt's 72-byte limit.

**Why:** Supabase Auth's bcrypt layer panics when an administrative create-user request supplies a password longer than 72 bytes; two UUIDs plus a separator exceed the limit.

Identity reuse must rely on the immutable legacy-user-to-Auth-user mapping, not email or client-editable Auth metadata. Owner assignment must resolve one explicitly reviewed legacy identity and verify exactly one mapped owner after migration.

**Why:** Email collisions and client-editable metadata are not proof that an existing Auth identity belongs to a legacy account; trusting either can overwrite another user's data. Implicit first-row owner selection can grant privileged access arbitrarily.

**How to apply:** Use a compact cryptographically random value such as 32 random bytes encoded as base64url. On reruns, reuse users only through the migration mapping. Fail for manual reconciliation on unmapped email collisions or ambiguous owners.