import { createResource, createSignal, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

export const SettingsIntegrationsV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [token, setToken] = createSignal("")
  const [error, setError] = createSignal<string | undefined>()
  const [connecting, setConnecting] = createSignal(false)
  const [disconnecting, setDisconnecting] = createSignal(false)

  const [status, { refetch }] = createResource(async () => (await serverSDK().client.telegram.status()).data)

  const connect = async (e: SubmitEvent) => {
    e.preventDefault()
    const value = token().trim()
    if (!value) {
      setError(language.t("settings.integrations.telegram.error.required"))
      return
    }
    setError(undefined)
    setConnecting(true)
    try {
      await serverSDK().client.telegram.connect({ token: value })
      setToken("")
      await refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.integrations.telegram.toast.connected.title"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await serverSDK().client.telegram.disconnect()
      await refetch()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.integrations.title")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.integrations.section.channels")}</h3>
          <SettingsListV2>
            <div class="settings-v2-provider-row">
              <div class="settings-v2-provider-lead">
                <Icon name="share" class="settings-v2-provider-icon shrink-0" />
                <div class="settings-v2-provider-main">
                  <span class="settings-v2-provider-name">{language.t("settings.integrations.telegram.title")}</span>
                  <Show when={!status.loading && status()?.connected}>
                    <Tag>{`@${status()?.bot?.username}`}</Tag>
                  </Show>
                </div>
              </div>
              <Show
                when={!status.loading && status()?.connected}
                fallback={
                  <Show when={!status.loading}>
                    <form onSubmit={connect} class="flex items-center gap-2">
                      <Field invalid={!!error()}>
                        <Field.Control>
                          <TextInputV2
                            class="!w-64"
                            placeholder={language.t("settings.integrations.telegram.field.token.placeholder")}
                            value={token()}
                            disabled={connecting()}
                            onInput={(e) => {
                              setToken(e.currentTarget.value)
                              setError(undefined)
                            }}
                          />
                        </Field.Control>
                        <Show when={error()}>
                          <Field.Suffix class="text-v2-state-fg-danger">{error()}</Field.Suffix>
                        </Show>
                      </Field>
                      <ButtonV2 type="submit" size="normal" variant="neutral" disabled={connecting()}>
                        <Show when={connecting()}>
                          <Spinner class="size-4" />
                        </Show>
                        {language.t("common.connect")}
                      </ButtonV2>
                    </form>
                  </Show>
                }
              >
                <ButtonV2
                  size="normal"
                  variant="ghost-muted"
                  class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger"
                  disabled={disconnecting()}
                  onClick={() => void disconnect()}
                >
                  <Show when={disconnecting()}>
                    <Spinner class="size-4" />
                  </Show>
                  {language.t("common.disconnect")}
                </ButtonV2>
              </Show>
            </div>
          </SettingsListV2>
          <p class="settings-v2-provider-description">{language.t("settings.integrations.telegram.description")}</p>
        </div>
      </div>
    </>
  )
}
