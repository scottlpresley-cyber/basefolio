// Plan → limit mapping. Stubbed for Sprint 2 — we need the project
// gate now, but Stripe billing (user limits, price IDs, trial logic)
// doesn't land until Sprint 4. Keep this file narrow until then so
// it's obvious what needs to grow when billing work picks up.

export const PLAN_LIMITS = {
  starter: { maxProjects: 15 },
  team: { maxProjects: 40 },
  business: { maxProjects: Infinity },
  enterprise: { maxProjects: Infinity },
} as const

export type Plan = keyof typeof PLAN_LIMITS
