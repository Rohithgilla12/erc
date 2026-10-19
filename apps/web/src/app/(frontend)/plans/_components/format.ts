import {
  goalLabel,
  PLAN_LEVEL_LABELS,
  planWeekCount,
  RESOURCE_FILE_TYPES,
  type AccessTier,
  type SessionTarget,
  type TrainingPlan,
} from '@erc/domain'

export const accessLabel = (access: AccessTier): string => {
  switch (access.kind) {
    case 'free':
      return 'Free'
  }
}

export const formatWeeks = (plan: Pick<TrainingPlan, 'weeks'>) => {
  const count = planWeekCount(plan)
  return count === 1 ? '1 week' : `${count} weeks`
}

/** "Beginner · 5K · 8 weeks": the three labels a runner scans for first, in the order they decide by. */
export const planLabels = (plan: Pick<TrainingPlan, 'level' | 'goal' | 'weeks'>) => [PLAN_LEVEL_LABELS[plan.level], goalLabel(plan.goal), formatWeeks(plan)]

const kmFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

export const formatTarget = (target: SessionTarget): string | null => {
  switch (target.kind) {
    case 'distance':
      return target.metres < 1000 ? `${target.metres} m` : `${kmFormat.format(target.metres / 1000)} km`
    case 'duration': {
      const minutes = Math.round(target.seconds / 60)
      if (minutes < 60) return `${minutes} min`
      const rest = minutes % 60
      return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`
    }
    case 'none':
      return null
  }
}

const FILE_TYPES: Readonly<Record<string, string>> = RESOURCE_FILE_TYPES

const sizeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

export const describeFile = ({ mimeType, bytes }: { mimeType: string; bytes: number }): string => {
  const size = bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${sizeFormat.format(bytes / 1024 / 1024)} MB`
  return `${FILE_TYPES[mimeType] ?? 'File'}, ${size}`
}

// JSON.stringify leaves `<` alone, so a title containing `</script>` could otherwise end the tag early.
export const jsonLd = (value: unknown) => ({ __html: JSON.stringify(value).replace(/</g, '\\u003c') })
