import { Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { showToast } from "@/utils/toast"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"

export const OMNIROUTE_PROVIDER_ID = "omnrt"

export function DialogConnectOmniroute(props: { autofocus?: boolean } = {}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const providers = useProviders(() => undefined)
  const language = useLanguage()

  const existing = () => providers.all().get(OMNIROUTE_PROVIDER_ID)

  const [form, setForm] = createStore({
    baseURL: (existing()?.options?.baseURL as string | undefined) ?? "",
    apiKey: existing()?.key ?? "",
    err: {} as { baseURL?: string; apiKey?: string },
  })

  const setField = (key: "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    setForm("err", key, undefined)
  }

  const validate = () => {
    const baseURL = form.baseURL.trim()
    const apiKey = form.apiKey.trim()
    const err = {
      baseURL: !baseURL
        ? language.t("provider.custom.error.baseURL.required")
        : !/^https?:\/\//.test(baseURL)
          ? language.t("provider.custom.error.baseURL.format")
          : undefined,
      apiKey: !apiKey ? language.t("provider.custom.error.required") : undefined,
    }
    setForm("err", err)
    if (err.baseURL || err.apiKey) return
    return { baseURL, apiKey }
  }

  // The Native Provider Plugin (packages/core/src/plugin/provider/omniroute.ts)
  // owns model discovery entirely now — this dialog's only job is to persist
  // the credential (baseURL + key) the plugin reads to talk to the gateway,
  // then nudge the server to pick it up. No more client-side model fetch/
  // parse/snapshot. See ADR 0002, docs/agents/omniroute-native-provider.md.
  const connectMutation = useMutation(() => ({
    mutationFn: async (input: { baseURL: string; apiKey: string }) => {
      await serverSDK().client.auth.set({
        providerID: OMNIROUTE_PROVIDER_ID,
        auth: { type: "api", key: input.apiKey, metadata: { baseURL: input.baseURL } },
      })
      await serverSync()
        .refreshProviders()
        .catch(() => undefined)
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: "Omniroute" }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (connectMutation.isPending) return
    const result = validate()
    if (!result) return
    connectMutation.mutate(result)
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <div class="px-2.5 flex gap-4 items-center">
        <ProviderIcon id={OMNIROUTE_PROVIDER_ID} class="size-5 shrink-0 icon-strong-base" />
        <div class="text-16-medium text-text-strong">{language.t("provider.omniroute.title")}</div>
      </div>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">{language.t("provider.omniroute.description")}</p>

        <div class="flex flex-col gap-4">
          <Field invalid={!!form.err.baseURL}>
            <Field.Label>{language.t("provider.custom.field.baseURL.label")}</Field.Label>
            <Field.Control>
              <TextInputV2
                autofocus={props.autofocus ?? true}
                class="!w-full"
                placeholder={language.t("provider.custom.field.baseURL.placeholder")}
                value={form.baseURL}
                onInput={(e) => setField("baseURL", e.currentTarget.value)}
              />
            </Field.Control>
            <Show when={form.err.baseURL}>
              <Field.Suffix class="text-v2-state-fg-danger">{form.err.baseURL}</Field.Suffix>
            </Show>
          </Field>
          <Field invalid={!!form.err.apiKey}>
            <Field.Label>{language.t("provider.custom.field.apiKey.label")}</Field.Label>
            <Field.Control>
              <TextInputV2
                class="!w-full"
                placeholder={language.t("provider.custom.field.apiKey.placeholder")}
                value={form.apiKey}
                onInput={(e) => setField("apiKey", e.currentTarget.value)}
              />
            </Field.Control>
            <Show when={form.err.apiKey}>
              <Field.Suffix class="text-v2-state-fg-danger">{form.err.apiKey}</Field.Suffix>
            </Show>
          </Field>
        </div>

        <ButtonV2
          class="w-auto self-start"
          type="submit"
          size="large"
          variant="contrast"
          disabled={connectMutation.isPending}
        >
          {connectMutation.isPending ? language.t("provider.omniroute.importing") : language.t("common.submit")}
        </ButtonV2>
      </form>
    </div>
  )
}
