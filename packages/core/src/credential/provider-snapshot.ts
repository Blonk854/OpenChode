const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const whole = (value: unknown) => {
  const number = finite(value)
  if (number === undefined || !Number.isInteger(number) || number < 0) return undefined
  return number
}

export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly inputTokenLimit?: number
  readonly outputTokenLimit?: number
}

export interface Credit {
  readonly limit?: number
  readonly remaining?: number
  readonly usage?: number
}

export const googlePageToken = (page: unknown) => {
  const token = asRecord(page)?.nextPageToken
  if (typeof token !== "string" || token.length === 0) return undefined
  return token
}

export const googleCatalog = (pages: readonly unknown[]) => {
  const models: CatalogModel[] = []
  for (const page of pages) {
    const listed = asRecord(page)?.models
    if (!Array.isArray(listed)) continue
    for (const item of listed) {
      const record = asRecord(item)
      if (!record) continue
      const raw = record.name
      if (typeof raw !== "string") continue
      const id = raw.startsWith("models/") ? raw.slice("models/".length) : raw
      if (id.length === 0) continue
      const display = record.displayName
      const inputTokenLimit = whole(record.inputTokenLimit)
      const outputTokenLimit = whole(record.outputTokenLimit)
      models.push({
        id,
        name: typeof display === "string" && display.length > 0 ? display : id,
        ...(inputTokenLimit === undefined ? {} : { inputTokenLimit }),
        ...(outputTokenLimit === undefined ? {} : { outputTokenLimit }),
      })
    }
  }
  return models
}

export const openRouterCredit = (body: unknown) => {
  const record = asRecord(body)
  const data = asRecord(record?.data) ?? record
  if (!data) return undefined
  const limit = finite(data.limit)
  const remaining = finite(data.limit_remaining)
  const usage = finite(data.usage)
  if (limit === undefined && remaining === undefined && usage === undefined) return undefined
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(usage === undefined ? {} : { usage }),
  } satisfies Credit
}
