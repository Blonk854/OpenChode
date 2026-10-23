import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import type { CredentialQuota } from "@opencode/schema/credential-quota"
import { For, Show, createEffect, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import "@/settings/settings.css"
import "./usage.css"

const metrics: CredentialQuota.Metric[] = ["requests", "tokens", "usd"]

export function SettingsUsage() {
  const language = useLanguage()
  const sdk = useServerSDK()
  const integrations = useIntegrations(() => undefined)
  const [report, { refetch }] = createResource(() => sdk.api.credential.usage())
  const [state, setState] = createStore<{
    editing: Record<string, boolean>
    draft: Record<string, { metric: CredentialQuota.Metric; amount: string }>
    busy?: string
    error?: string
  }>({
    editing: {},
    draft: {},
  })

  const loaded = () => report.state === "ready" || report.state === "refreshing"
  const providers = () => (loaded() ? (report.latest?.providers ?? []) : [])

  createEffect(() => {
    const accounts = providers().flatMap((provider) => provider.accounts)
    setState("draft", (draft) => {
      const missing = accounts.filter((account) => draft[account.id] === undefined)
      if (missing.length === 0) return draft
      return {
        ...draft,
        ...Object.fromEntries(
          missing.map((account) => [
            account.id,
            {
              metric: account.limit?.metric ?? "requests",
              amount: account.limit ? String(account.limit.amount) : "",
            },
          ]),
        ),
      }
    })
  })

  const format = (value: number) => value.toLocaleString(language.intl(), { maximumFractionDigits: 4 })

  const metricLabel = (metric: CredentialQuota.Metric) => {
    if (metric === "requests") return language.t("settings.usage.metric.requests")
    if (metric === "tokens") return language.t("settings.usage.metric.tokens")
    return language.t("settings.usage.metric.usd")
  }

  const providerName = (id: string) => integrations.list().find((item) => item.id === id)?.name ?? id

  const run = async (id: string, action: () => Promise<void>) => {
    setState({ busy: id, error: undefined })
    const result = await action()
      .then(() => refetch())
      .then(() => ({ ok: true as const }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    if (!result.ok) {
      setState({
        busy: undefined,
        error: formatServerError(result.error, language.t, language.t("settings.usage.error")),
      })
      return
    }
    setState("busy", undefined)
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.usage.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.usage.description")}</span>
          </div>
          <Button
            type="button"
            variant="neutral"
            disabled={state.busy === "refresh" || !loaded()}
            onClick={() => void run("refresh", () => sdk.api.credential.refresh().then(() => undefined))}
          >
            {language.t("settings.usage.refresh")}
          </Button>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={state.error}>
          {(error) => (
            <p role="alert" class="settings-usage-error text-11-regular text-v2-state-fg-danger">
              {error()}
            </p>
          )}
        </Show>
        <Show when={report.state === "errored"}>
          <p role="alert" class="settings-usage-error text-11-regular text-v2-state-fg-danger">
            {formatServerError(report.error, language.t, language.t("settings.usage.error"))}
          </p>
        </Show>
        <Show
          when={loaded() && providers().length > 0}
          fallback={
            <Show when={loaded()}>
              <div class="settings-provider-empty">{language.t("settings.usage.empty")}</div>
            </Show>
          }
        >
          <For each={providers()}>
            {(provider) => {
              const totals = () =>
                provider.accounts.reduce(
                  (total, account) => ({
                    requests: total.requests + account.used.requests,
                    tokens: total.tokens + account.used.tokens,
                    cost: total.cost + account.used.cost,
                  }),
                  { requests: 0, tokens: 0, cost: 0 },
                )
              return (
                <div class="settings-section">
                  <h3 class="settings-section-title">{providerName(provider.integrationID)}</h3>
                  <p class="settings-usage-summary text-12-regular text-v2-text-text-base">
                    {language.t("settings.usage.summary", {
                      requests: format(totals().requests),
                      tokens: format(totals().tokens),
                      cost: format(totals().cost),
                    })}
                  </p>
                  <For each={provider.combined}>
                    {(combined) => (
                      <p class="settings-usage-note text-11-regular text-v2-text-text-muted">
                        {language.t("settings.usage.combined.remaining", {
                          remaining: format(combined.remaining),
                          limit: format(combined.limit),
                          metric: metricLabel(combined.metric),
                        })}
                      </p>
                    )}
                  </For>
                  <Show when={provider.integrationID === "google"}>
                    <p class="settings-usage-note text-11-regular text-v2-text-text-muted">
                      <a
                        class="settings-usage-link"
                        href="https://aistudio.google.com/rate-limit"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {language.t("settings.usage.google.rpm")}
                      </a>
                    </p>
                  </Show>
                  <div class="settings-usage-cards">
                    <For each={provider.accounts}>
                      {(account) => {
                        const draft = () =>
                          state.draft[account.id] ?? {
                            metric: account.limit?.metric ?? "requests",
                            amount: account.limit ? String(account.limit.amount) : "",
                          }
                        const amount = () => Number(draft().amount)
                        const canSave = () => Number.isFinite(amount()) && amount() > 0 && state.busy !== account.id
                        const ratio = () => {
                          const limit = account.limit
                          if (!limit || limit.amount <= 0) return 0
                          return Math.min(1, Math.max(0, usedAmount(limit.metric, account.used) / limit.amount))
                        }
                        return (
                          <article class="settings-usage-card">
                            <h4 class="settings-usage-card-title text-12-medium text-v2-text-text-base">
                              {account.label}
                            </h4>
                            <p class="settings-usage-note text-11-regular text-v2-text-text-base">
                              {language.t("settings.usage.account.used", {
                                requests: format(account.used.requests),
                                tokens: format(account.used.tokens),
                                cost: format(account.used.cost),
                              })}
                            </p>
                            <Show
                              when={account.limit}
                              fallback={
                                <p class="settings-usage-note text-11-regular text-v2-text-text-muted">
                                  {language.t("settings.usage.unlimited")}
                                </p>
                              }
                            >
                              {(limit) => (
                                <>
                                  <p class="settings-usage-note text-11-regular text-v2-text-text-base">
                                    {language.t("settings.usage.remaining", {
                                      remaining: format(account.remaining ?? 0),
                                      limit: format(limit().amount),
                                      metric: metricLabel(limit().metric),
                                    })}
                                  </p>
                                  <div class="settings-usage-meter" aria-hidden="true">
                                    <span style={{ width: `${ratio() * 100}%` }} />
                                  </div>
                                </>
                              )}
                            </Show>
                            <Show when={account.window}>
                              {(window) => (
                                <p class="settings-usage-window text-11-regular text-v2-text-text-base">
                                  {windowText(language.t, window())}
                                  <span class="text-v2-text-text-muted">
                                    {" "}
                                    {language.t("settings.usage.window.asOf", {
                                      time: new Date(window().observedAt).toLocaleString(language.intl()),
                                    })}
                                  </span>
                                </p>
                              )}
                            </Show>
                            <Show when={account.credit}>
                              {(credit) => (
                                <p class="settings-usage-note text-11-regular text-v2-text-text-base">
                                  {creditText(language.t, format, credit())}
                                </p>
                              )}
                            </Show>
                            <Show when={account.snapshotError}>
                              {(error) => (
                                <p class="settings-usage-error text-11-regular text-v2-text-text-muted">{error()}</p>
                              )}
                            </Show>
                            <Show when={account.blockedUntil}>
                              {(until) => (
                                <p class="settings-usage-note text-11-regular text-v2-state-fg-danger">
                                  {language.t("settings.usage.blocked", {
                                    time: new Date(until()).toLocaleString(language.intl()),
                                  })}
                                </p>
                              )}
                            </Show>
                            <Show when={account.models.length > 0}>
                              <div class="settings-usage-table-wrap">
                                <table class="settings-usage-table text-11-regular text-v2-text-text-base">
                                  <thead>
                                    <tr>
                                      <th>{language.t("settings.usage.model")}</th>
                                      <th>{language.t("settings.usage.column.requests")}</th>
                                      <th>{language.t("settings.usage.column.tokens")}</th>
                                      <th>{language.t("settings.usage.column.dollars")}</th>
                                      <th>{language.t("settings.usage.column.window")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <For each={account.models}>
                                      {(model) => (
                                        <tr>
                                          <td>
                                            <div>{modelLabel(account, model)}</div>
                                            <Show when={tokenNote(language.t, format, model)}>
                                              {(note) => <div class="text-v2-text-text-muted">{note()}</div>}
                                            </Show>
                                          </td>
                                          <td>{format(model.requests)}</td>
                                          <td>{format(model.tokens)}</td>
                                          <td>{format(model.cost)}</td>
                                          <td>
                                            {model.window
                                              ? windowText(language.t, model.window)
                                              : language.t("settings.usage.window.unavailable")}
                                          </td>
                                        </tr>
                                      )}
                                    </For>
                                  </tbody>
                                </table>
                              </div>
                            </Show>
                            <div>
                              <Button
                                type="button"
                                variant="neutral"
                                aria-expanded={state.editing[account.id] === true}
                                onClick={() => setState("editing", account.id, (open) => !open)}
                              >
                                {language.t("settings.usage.limit.edit")}
                              </Button>
                            </div>
                            <Show when={state.editing[account.id]}>
                              <div class="settings-usage-limit">
                                <Show when={account.blockedUntil}>
                                  <Button
                                    type="button"
                                    variant="neutral"
                                    disabled={state.busy === account.id}
                                    onClick={() =>
                                      void run(account.id, () =>
                                        sdk.api.credential.unblock({ credentialID: account.id }),
                                      )
                                    }
                                  >
                                    {language.t("settings.usage.unblock")}
                                  </Button>
                                </Show>
                                <Select
                                  options={metrics}
                                  current={draft().metric}
                                  label={metricLabel}
                                  aria-label={language.t("provider.connect.quota.metric")}
                                  placement="bottom-end"
                                  gutter={6}
                                  disabled={state.busy === account.id}
                                  onSelect={(metric) => {
                                    if (!metric) return
                                    setState("draft", account.id, { metric, amount: draft().amount })
                                  }}
                                />
                                <TextInput
                                  numeric
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={draft().amount}
                                  aria-label={language.t("provider.connect.quota.amount")}
                                  disabled={state.busy === account.id}
                                  onInput={(event) =>
                                    setState("draft", account.id, {
                                      metric: draft().metric,
                                      amount: event.currentTarget.value,
                                    })
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="contrast"
                                  disabled={!canSave()}
                                  onClick={() =>
                                    void run(account.id, async () => {
                                      await sdk.api.credential.limit({
                                        credentialID: account.id,
                                        limit: { metric: draft().metric, amount: amount() },
                                      })
                                      setState("draft", account.id, "amount", String(amount()))
                                    })
                                  }
                                >
                                  {language.t("settings.usage.limit.save")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="neutral"
                                  disabled={state.busy === account.id || !account.limit}
                                  onClick={() =>
                                    void run(account.id, async () => {
                                      await sdk.api.credential.limit({ credentialID: account.id, limit: null })
                                      setState("draft", account.id, { metric: "requests", amount: "" })
                                    })
                                  }
                                >
                                  {language.t("settings.usage.limit.clear")}
                                </Button>
                              </div>
                            </Show>
                          </article>
                        )
                      }}
                    </For>
                  </div>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </>
  )
}

const usedAmount = (metric: CredentialQuota.Metric, usage: CredentialQuota.Usage) => {
  if (metric === "requests") return usage.requests
  if (metric === "tokens") return usage.tokens
  return usage.cost
}

const windowText = (
  t: (key: string, values?: Record<string, string>) => string,
  window: CredentialQuota.Window,
) => {
  const metric = window.remaining?.requests
    ? "requests"
    : (Object.keys(window.remaining ?? window.limit ?? {})[0] ?? "requests")
  const label = metric.replaceAll("-", " ")
  const remaining = window.remaining?.[metric]
  const limit = window.limit?.[metric]
  const reset = window.reset?.[metric]
  const left =
    remaining !== undefined && limit !== undefined
      ? t("settings.usage.window.left", { remaining, limit, metric: label })
      : remaining !== undefined
        ? t("settings.usage.window.remaining", { remaining, metric: label })
        : limit !== undefined
          ? t("settings.usage.window.limit", { limit, metric: label })
          : undefined
  if (!left) return t("settings.usage.window.unavailable")
  if (!reset) return left
  return `${left}, ${t("settings.usage.window.reset", { reset })}`
}

const creditText = (
  t: (key: string, values?: Record<string, string>) => string,
  format: (value: number) => string,
  credit: CredentialQuota.Credit,
) => {
  if (credit.remaining !== undefined && credit.limit !== undefined)
    return t("settings.usage.credit", {
      remaining: format(credit.remaining),
      limit: format(credit.limit),
      usage: format(credit.usage ?? 0),
    })
  return t("settings.usage.credit.usage", { usage: format(credit.usage ?? 0) })
}

const modelLabel = (
  account: { readonly catalog?: ReadonlyArray<{ readonly id: string; readonly name: string }> },
  model: { readonly providerID: string; readonly modelID: string },
) => account.catalog?.find((item) => item.id === model.modelID)?.name ?? `${model.providerID}/${model.modelID}`

const tokenNote = (
  t: (key: string, values?: Record<string, string>) => string,
  format: (value: number) => string,
  model: CredentialQuota.ModelUsage,
) => {
  const parts = [
    model.inputTokenLimit === undefined
      ? undefined
      : t("settings.usage.google.input", { count: format(model.inputTokenLimit) }),
    model.outputTokenLimit === undefined
      ? undefined
      : t("settings.usage.google.output", { count: format(model.outputTokenLimit) }),
  ].filter((part) => part !== undefined)
  if (parts.length === 0) return undefined
  return parts.join(", ")
}
