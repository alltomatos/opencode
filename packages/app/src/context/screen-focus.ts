import { createSignal } from "solid-js"

// Sinal global simples (não é um contexto Solid — não precisa de provider) que
// componentes com foco temporário (diálogos, principalmente) usam pra anunciar
// "isso é o que está realmente na tela agora". A rota (useParams) não muda
// quando um diálogo abre por cima, então o Breniac (context/breniac.tsx) fica
// cego pra diálogos sem essa ponte — currentScreen() lê isso primeiro e só cai
// pra descrição baseada em rota se nada estiver com foco.
const [label, setLabel] = createSignal<string | undefined>(undefined)

export const screenFocus = {
  label,
  set: setLabel,
  clear: () => setLabel(undefined),
}
