import { ParentProps, Show, ErrorBoundary, createEffect, createMemo } from "solid-js";
import { useLanguage } from "@/context/language";
import { useServer, ServerConnection, serverName } from "@/context/server";
import { useTabs } from "@/context/tabs";
import { useSettings } from "@/context/settings";
import { useNotification } from "@/context/notification";
import { ErrorPage } from "@/pages/error";
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2";
import { TerminalProvider } from "@/context/terminal";
import { FileProvider } from "@/context/file";
import { PromptProvider } from "@/context/prompt";
import { CommentsProvider } from "@/context/comments";
import { ModelsProvider } from "@/context/models";
import { useSettingsCommand } from "@/components/settings-dialog";
import { useParams } from "@solidjs/router";
import { useServerSync } from "@/context/server-sync";
import { requireServerKey } from "@/utils/session-route";
import { createSessionLineage } from "./session/session-lineage";
import { SDKProvider } from "@/context/sdk";
import { DirectoryDataProvider } from "@/pages/directory-layout";
import { useServerSDK } from "@/context/server-sdk";
import { useSDK } from "@/context/sdk";
import { isLocalSessionNotFoundError, isSessionNotFoundError } from "@/utils/server-errors";

export function isCurrentSessionNotFoundError(error: unknown, sessionID: string | undefined) {
  if (!sessionID) return false;
  return isSessionNotFoundError(error, sessionID) || isLocalSessionNotFoundError(error, sessionID);
}

export const TargetSessionRouteContent = () => {
  const params = useParams<{ serverKey: string; id: string }>()
  const serverSync = useServerSync()
  const directory = createMemo(() => serverSync().session.lineage.peek(params.id)?.session.directory)
  return (
    <TargetServerScopedProviders directory={directory} sessionID={() => params.id}>
      <TargetSessionSettingsCommand />
      <SessionRouteErrorBoundary sessionID={params.id} serverKey={requireServerKey(params.serverKey)} padded>
        <ResolvedTargetSessionRoute />
      </SessionRouteErrorBoundary>
    </TargetServerScopedProviders>
  )
}

function TargetSessionSettingsCommand() {
  useSettingsCommand()
  return null
}

export const SessionRouteErrorBoundary = (
  props: ParentProps<{ sessionID?: string; serverKey?: ServerConnection.Key; padded?: boolean }>,
) => {
  const settings = useSettings()
  return (
    <ErrorBoundary
      fallback={(error) =>
        settings.general.newLayoutDesigns() ? (
          <SessionRouteFrame padded={props.padded}>
            <SessionPanelFrame newLayout raised={!!props.sessionID}>
              <SessionErrorFallback error={error} sessionID={props.sessionID} serverKey={props.serverKey} />
            </SessionPanelFrame>
          </SessionRouteFrame>
        ) : (
          <ErrorPage error={error} />
        )
      }
    >
      {props.children}
    </ErrorBoundary>
  )
}

export const SessionErrorFallback = (props: { error: unknown; sessionID?: string; serverKey?: ServerConnection.Key }) => {
  const language = useLanguage()
  const server = useServer()
  const tabs = useTabs()
  const displayServer = createMemo(() => {
    const key = props.serverKey ?? server.key
    const conn = server.list.find((item) => ServerConnection.key(item) === key)
    return conn ? serverName(conn) : key
  })
  const closeTab = () => {
    if (!props.sessionID) return
    tabs.removeSessionTab({ server: props.serverKey ?? server.key, sessionId: props.sessionID })
  }
  if (isCurrentSessionNotFoundError(props.error, props.sessionID)) {
    return (
      <div class="flex-1 min-h-0 overflow-hidden">
        <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
          <div class="flex flex-col items-center gap-2">
            <div class="text-16-medium text-text max-w-md">{language.t("session.error.notFound")}</div>
            <div class="text-13-regular text-text-weak max-w-md">
              {language.t("session.error.notFound.description")}
            </div>
          </div>
          <Show when={props.sessionID}>
            {(sessionID) => (
              <div class="max-w-full flex flex-col items-center gap-1">
                <div class="max-w-full text-11-regular text-text-faint break-all">{displayServer()}</div>
                <code class="max-w-full rounded-[4px] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-text-base break-all bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)]">
                  {sessionID()}
                </code>
              </div>
            )}
          </Show>
          <ButtonV2 variant="neutral" size="normal" icon="xmark-small" onClick={closeTab}>
            {language.t("session.error.notFound.closeTab")}
          </ButtonV2>
        </div>
      </div>
    )
  }
  return <ErrorPage error={props.error} />
}

function ResolvedTargetSessionRoute() {
  // Re-importing or re-implementing these if needed by session.tsx
  return null
}

function TargetSessionPage() {
  return null
}

function TargetServerScopedProviders(
  props: ParentProps<{ directory?: () => string | undefined; sessionID?: () => string | undefined }>,
) {
  return (
    <>
      <MarkSessionNotificationsViewed sessionID={props.sessionID} />
      <ModelsProvider directory={props.directory}>{props.children}</ModelsProvider>
    </>
  )
}

function MarkSessionNotificationsViewed(props: { sessionID?: () => string | undefined }) {
  const notification = useNotification()
  createEffect(() => {
    const sessionID = props.sessionID?.()
    if (!notification.ready() || !sessionID) return
    if (notification.session.unseenCount(sessionID) === 0) return
    notification.session.markViewed(sessionID)
  })
  return null
}

export const SessionProviders = (props: ParentProps) => {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

export const SessionRouteFrame = (props: ParentProps<{ padded?: boolean }>) => {
  return (
    <div class="relative size-full overflow-hidden flex flex-col" classList={{ "p-2": props.padded }}>
      {props.children}
    </div>
  )
}

export const SessionPanelFrame = (props: ParentProps<{ newLayout: boolean; raised?: boolean }>) => {
  return (
    <div
      classList={{
        "flex-1 min-h-0 flex flex-col": true,
        "bg-v2-background-bg-base": props.newLayout,
        "bg-background-stronger": !props.newLayout,
        "rounded-[10px] overflow-hidden": props.newLayout,
        "shadow-[var(--v2-elevation-raised)]": props.newLayout && props.raised,
      }}
    >
      {props.children}
    </div>
  )
}
