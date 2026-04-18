// Plan-limit gate used before createProject. Separate from mutations
// because it reaches into stripe/plans — which is a Sprint 4 concern —
// so keeping the dependency isolated makes it easy to evolve when
// billing lands.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { PLAN_LIMITS, type Plan } from '@/lib/stripe/plans'
import { countActiveProjects } from '@/lib/projects/queries'

export class PlanLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
    public readonly plan: string,
  ) {
    super(`Plan limit reached: ${current}/${limit} projects on ${plan}`)
    this.name = 'PlanLimitError'
  }
}

// Throws PlanLimitError iff adding one more active project would push
// the org past its plan cap. Safe to call unconditionally — Infinity
// limits short-circuit before touching the DB.
export async function enforceProjectLimit(
  client: SupabaseClient<Database>,
  orgPlan: Plan,
): Promise<void> {
  const { maxProjects } = PLAN_LIMITS[orgPlan]
  if (maxProjects === Infinity) return

  const current = await countActiveProjects(client)
  if (current >= maxProjects) {
    throw new PlanLimitError(maxProjects, current, orgPlan)
  }
}
