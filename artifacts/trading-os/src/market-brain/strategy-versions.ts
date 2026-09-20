import type { ScannerSnapshot } from "@workspace/api-zod";

export function latestApprovedVersions(snapshot: ScannerSnapshot) {
  const seen = new Set<string>();
  return [...snapshot.versions]
    .filter((version) => version.definition.approval === "approved")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter((version) => {
      if (seen.has(version.source_setup_id)) return false;
      seen.add(version.source_setup_id);
      return true;
    });
}
