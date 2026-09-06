export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY = "firstLaunchOnboardingComplete"
export const OLD_LAYOUT_ELIGIBLE_KEY = "oldLayoutEligible"
export const WSL_SERVERS_KEY = "wslServers"
export const SSH_SERVERS_KEY = "sshServers"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"
export const WINDOW_IDS_KEY = "windowIds"
export const DEBUG_MODE_ENABLED_KEY = "debugModeEnabled"
export const COMPUTER_USE_ENABLED_KEY = "computerUseEnabled"
// Porta e senha do sidecar local — persistidas pra sobreviver a um
// restart do desktop. Sem isso, todo restart sorteava porta nova E senha
// nova, invalidando qualquer pareamento QR feito com um celular (a URL
// guardada lá aponta pra uma porta que não existe mais, com uma senha
// que também não vale mais) — o app mobile ficava "Offline" pra sempre
// até o usuário re-parear manualmente.
export const SIDECAR_PORT_KEY = "sidecarPort"
export const SIDECAR_PASSWORD_KEY = "sidecarPassword"
