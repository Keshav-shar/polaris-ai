// Pure: takes the secrets rather than reading config, so it is testable and belongs to no layer.
// Longest first, so one secret being a prefix of another cannot leave a tail behind. Empty and
// undefined entries are ignored - replacing "" would shred the whole string.
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  const ordered = secrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  ordered.sort((a, b) => b.length - a.length);
  return ordered.reduce((out, secret) => out.replaceAll(secret, "[redacted]"), text);
}
