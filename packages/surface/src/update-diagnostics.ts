/** Explicit projection: no URL, token, server text or arbitrary exception can enter a log. */
export const updateEvents = ['check_auto', 'check_manual', 'none', 'newer', 'same', 'error', 'link_fetched',
  'download_start', 'download_end', 'cancel', 'verify_hash', 'verify_package', 'verify_version', 'verify_signer',
  'permission_yes', 'permission_no', 'settings_opened', 'installer_launched', 'installer_result', 'update_done'] as const;
export interface UpdateDiagnostic {
  event: typeof updateEvents[number]; code?: string; bytes?: number; duration?: number; status?: number;
  from?: string; to?: string;
}
const codes = ['UPDATE_HASH_MISMATCH', 'UPDATE_PACKAGE_MISMATCH', 'UPDATE_NOT_NEWER', 'UPDATE_SIGNER_MISMATCH',
  'UPDATE_LINK_EXPIRED', 'UPDATE_DOWNLOAD_FAILED', 'UPDATE_CANCELLED', 'UPDATE_INSTALL_FAILED', 'UPDATE_METADATA_INVALID',
  'UPDATE_CHECK_AUTH', 'UPDATE_CHECK_FORBIDDEN', 'UPDATE_CHECK_INVALID', 'UPDATE_CHECK_NOT_FOUND', 'UPDATE_CHECK_CONFLICT', 'UPDATE_CHECK_SERVER'];
export function sanitizeUpdate(value: UpdateDiagnostic): Record<string, unknown> {
  const out: Record<string, unknown> = { event: updateEvents.includes(value.event) ? value.event : 'error' };
  if (codes.includes(value.code ?? '')) out.code = value.code;
  for (const key of ['bytes', 'duration', 'status'] as const)
    if (Number.isSafeInteger(value[key]) && value[key]! >= -1) out[key] = value[key];
  for (const key of ['from', 'to'] as const)
    if (/^\d+\.\d+\.\d+ \(\d+\)$/.test(value[key] ?? '')) out[key] = value[key];
  return out;
}
