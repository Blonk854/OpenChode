import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import type { CredentialQuota } from "@opencode/schema/credential-quota"
import { For, Show, createEffect, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import "@/settings/settings.css"

const metrics: CredentialQuota.Metric[] = ["requests", "tokens", "usd"]

export function SettingsUsage() {
  const language = useLanguage()
  const sdk = useServerSDK()
  const integrations = useIntegrations(() => undefined)
  const [report, { refetch }] = createResource(() => sdk.api.credential.usage())
  const [state, setState] = createStore<{
    open: Record<string, boolean>
    draft: Record<string, { metric: CredentialQuota.Metric; amount: string }>
    busy?: string
    error?: string
  }>({
    open: {},
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
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={state.error}>
          {(error) => (
            <p role="alert" class="text-11-regular text-v2-state-fg-danger">
              {error()}
            </p>
          )}
        </Show>
        <Show when={report.state === "errored"}>
          <p role="alert" class="text-11-regular text-v2-state-fg-danger">
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
            {(provider) => (
              <div class="settings-section">
                <h3 class="settings-section-title">{providerName(provider.integrationID)}</h3>
                <Show
                  when={provider.combined.length > 0}
                  fallback={
                    <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.usage.unlimited")}</p>
                  }
                >
                  <For each={provider.combined}>
                    {(combined) => (
                      <p class="text-11-regular text-v2-text-text-base">
                        {language.t("settings.usage.combined.remaining", {
                          remaining: format(combined.remaining),
                          limit: format(combined.limit),
                          metric: metricLabel(combined.metric),
                        })}
                      </p>
                    )}
                  </For>
                </Show>
                <Button
                  type="button"
                  variant="neutral"
                  aria-expanded={state.open[provider.integrationID] === true}
                  onClick={() => setState("open", provider.integrationID, (open) => !open)}
                >
                  {language.t("settings.usage.accounts")}
                </Button>
                <Show when={state.open[provider.integrationID]}>
                  <SettingsList>
                    <For each={provider.accounts}>
                      {(account) => {
                        const draft = () =>
                          state.draft[account.id] ?? {
                            metric: account.limit?.metric ?? "requests",
                            amount: account.limit ? String(account.limit.amount) : "",
                          }
                        const amount = () => Number(draft().amount)
                        const canSave = () => Number.isFinite(amount()) && amount() > 0 && state.busy !== account.id
                        return (
                          <SettingsRow
                            title={account.label}
                            description={
                              <>
                                <div>
                                  {language.t("settings.usage.account.used", {
                                    requests: format(account.used.requests),
                                    tokens: format(account.used.tokens),
                                    cost: format(account.used.cost),
                                  })}
                                </div>
                                <div>
                                  {account.limit
                                    ? language.t("settings.usage.remaining", {
                                        remaining: format(account.remaining ?? 0),
                                        limit: format(account.limit.amount),
                                        metric: metricLabel(account.limit.metric),
                                      })
                                    : language.t("settings.usage.unlimited")}
                                </div>
                                <Show when={account.blockedUntil}>
                                  {(until) => (
                                    <div>
                                      {language.t("settings.usage.blocked", {
                                        time: new Date(until()).toLocaleString(language.intl()),
                                      })}
                                    </div>
                                  )}
                                </Show>
                                <Show when={account.models.length > 0}>
                                  <div>{language.t("settings.usage.models")}</div>
                                  <For each={account.models}>
                                    {(model) => (
                                      <div>
                                        {model.providerID}/{model.modelID}:{" "}
                                        {language.t("settings.usage.account.used", {
                                          requests: format(model.requests),
                                          tokens: format(model.tokens),
                                          cost: format(model.cost),
                                        })}
                                      </div>
                                    )}
                                  </For>
                                </Show>
                              </>
                            }
                          >
                            <div class="flex flex-col items-end gap-2">
                              <Show when={account.blockedUntil}>
                                <Button
                                  type="button"
                                  variant="neutral"
                                  disabled={state.busy === account.id}
                                  onClick={() =>
                                    void run(account.id, () => sdk.api.credential.unblock({ credentialID: account.id }))
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
                              <div class="flex gap-2">
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
                            </div>
                          </SettingsRow>
                        )
                      }}
                    </For>
                  </SettingsList>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  )
}
