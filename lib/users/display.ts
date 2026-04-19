// Single source of truth for rendering a user's name.
//
// Today every current account has a null full_name (magic-link
// signup doesn't collect one), so the fallback is load-bearing. We
// don't backfill full_name with the email local-part because that
// would conflate "user didn't set a name" with "user chose this
// name" — future profile/settings UI (Sprint 4) needs to distinguish
// them. Keep the fallback in presentation, not in the DB.

export function displayName(user: {
  full_name?: string | null
  email: string
}): string {
  const trimmed = user.full_name?.trim()
  if (trimmed) return trimmed
  return user.email.split('@')[0]
}
