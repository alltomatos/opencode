import { Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { showToast } from "@/utils/toast"
import { createStore } from "solid-js/store"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"

export const OMNIROUTE_PROVIDER_ID = "omnrt"
const OMNIROUTE_NPM = "@ai-sdk/openai-compatible"
const COMBO_CATEGORY = "combo"

type OmnirouteModality = "text" | "audio" | "image" | "video" | "pdf"
type OmnirouteModel = {
  id: string
  owned_by?: string
  input_modalities?: string[]
  output_modalities?: string[]
  capabilities?: {
    vision?: boolean
    tool_calling?: boolean
    reasoning?: boolean
    thinking?: boolean
    temperature?: boolean
  }
}

const KNOWN_MODALITIES: OmnirouteModality[] = ["text", "audio", "image", "video", "pdf"]
const asModalities = (values: string[] | undefined): OmnirouteModality[] | undefined =>
  values?.filter((value): value is OmnirouteModality => (KNOWN_MODALITIES as string[]).includes(value))

function modelConfigEntry(model: OmnirouteModel) {
  const input = asModalities(model.input_modalities)
  const output = asModalities(model.output_modalities)
  return {
    name: model.id,
    attachment: model.capabilities?.vision ?? input?.includes("image") ?? false,
    reasoning: model.capabilities?.reasoning ?? model.capabilities?.thinking ?? false,
    temperature: model.capabilities?.temperature ?? false,
    tool_call: model.capabilities?.tool_calling ?? false,
    modalities: input || output ? { input, output } : undefined,
  }
}
type OmnirouteConnection = { provider: string; isActive?: boolean; testStatus?: string }

async function fetchOmnirouteModels(baseURL: string, apiKey: string) {
  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const body = (await response.json()) as { data?: OmnirouteModel[] }
  if (!body.data?.length) throw new Error("empty model list")
  return body.data
}

async function fetchUnhealthyProviders(baseURL: string, apiKey: string) {
  try {
    const origin = new URL(baseURL).origin
    const response = await fetch(`${origin}/api/providers`, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!response.ok) return undefined
    const body = (await response.json().catch(() => undefined)) as { connections?: OmnirouteConnection[] } | undefined
    if (!body?.connections) return undefined
    return new Set(
      body.connections
        .filter((c) => c.isActive === false || (c.testStatus !== undefined && c.testStatus !== "active"))
        .map((c) => c.provider),
    )
  } catch {
    return undefined
  }
}

export function DialogConnectOmniroute(props: { autofocus?: boolean } = {}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const models = useModels()
  const providers = useProviders(() => undefined)
  const language = useLanguage()

  const existing = () => providers.all().get(OMNIROUTE_PROVIDER_ID)

  const [form, setForm] = createStore({
    baseURL: (existing()?.options?.baseURL as string | undefined) ?? "",
    apiKey: existing()?.key ?? "",
    combosOnly: true,
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

  const connectMutation = useMutation(() => ({
    mutationFn: async (input: { baseURL: string; apiKey: string; combosOnly: boolean }) => {
      const all = await fetchOmnirouteModels(input.baseURL, input.apiKey)
      const unhealthy = await fetchUnhealthyProviders(input.baseURL, input.apiKey)
      const healthy = unhealthy ? all.filter((m) => !unhealthy.has(m.owned_by ?? "")) : all
      const fetched = input.combosOnly ? healthy.filter((m) => m.owned_by === COMBO_CATEGORY) : healthy
      const skipped = all.length - fetched.length
      const modelConfig = Object.fromEntries(fetched.map((m) => [m.id, modelConfigEntry(m)]))

      await serverSDK().client.auth.set({
        providerID: OMNIROUTE_PROVIDER_ID,
        auth: { type: "api", key: input.apiKey },
      })

      const disabledProviders = serverSync().data.config.disabled_providers ?? []
      await serverSync().updateConfig({
        provider: {
          [OMNIROUTE_PROVIDER_ID]: {
            name: "Omniroute",
            npm: OMNIROUTE_NPM,
            options: { baseURL: input.baseURL },
            models: modelConfig,
          },
        },
        disabled_providers: disabledProviders.filter((id) => id !== OMNIROUTE_PROVIDER_ID),
      })

      models.setCategories(
        OMNIROUTE_PROVIDER_ID,
        fetched.map((m) => ({ id: m.id, category: m.owned_by ?? "other" })),
      )
      for (const model of fetched) {
        if (model.owned_by === COMBO_CATEGORY) continue
        models.setVisibility({ providerID: OMNIROUTE_PROVIDER_ID, modelID: model.id }, false)
      }

      await serverSync()
        .refreshProviders()
        .catch(() => undefined)

      return { count: fetched.length, skipped }
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: "Omniroute" }),
        description:
          result.skipped > 0
            ? language.t("provider.omniroute.toast.importedFiltered", {
                count: result.count,
                skipped: result.skipped,
              })
            : language.t("provider.omniroute.toast.imported", { count: result.count }),
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
    connectMutation.mutate({ ...result, combosOnly: form.combosOnly })
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

        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-14-medium text-text-strong">{language.t("provider.omniroute.field.combosOnly.label")}</span>
            <span class="text-13-regular text-text-weak">
              {language.t("provider.omniroute.field.combosOnly.description")}
            </span>
          </div>
          <SwitchV2 hideLabel checked={form.combosOnly} onChange={(checked) => setForm("combosOnly", checked)}>
            {language.t("provider.omniroute.field.combosOnly.label")}
          </SwitchV2>
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
