import type { VersionRow } from "./store";

/**
 * One setup may have many immutable versions. Automatic scanning must use only
 * the newest approved version for each Setup Library record so an older rule
 * set cannot scan or execute beside its replacement.
 */
export function latestApprovedVersions<T extends VersionRow>(versions: T[]) {
  const latest = new Map<string, T>();
  for (const version of [...versions].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )) {
    if (
      version.definition.approval === "approved" &&
      !latest.has(version.source_setup_id)
    )
      latest.set(version.source_setup_id, version);
  }
  return [...latest.values()];
}
