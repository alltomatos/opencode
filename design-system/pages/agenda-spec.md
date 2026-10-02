# Especificação de Design: Sistema de Agenda, Lembretes e Toggles de Agente

Este documento consolida os mockups criados para validação da experiência de usuário (UI/UX), preservando estritamente a identidade visual do **OpenCode**.

---

## 1. Mockups Vetoriais Gerados (SVGs de Alta Fidelidade)

Os seguintes arquivos foram gerados e estão disponíveis para inspeção visual na pasta `design-system/mockups/`:

1. **`design-system/mockups/agenda-view-grid.svg`**
   - **Descrição:** Visão completa do app OpenCode com o novo item **📅 Agenda** posicionado acima de Mídia na barra lateral esquerda (`HomeUtilityNav`), exibindo a página de **Agenda no Modo Grid (Calendário Mensal)** com cards de lembretes categorizados por canal (ex.: *08:30 WhatsApp - Rodrigo Peixoto* e *10:00 AgentUI - Mix Cegás*).
2. **`design-system/mockups/agenda-view-list.svg`**
   - **Descrição:** Visão do aplicativo com a página de **Agenda no Modo Lista / Linha do Tempo**, com agrupamento por dias (*"Amanhã"*, *"Quinta-feira"*), badges de status (*Pendente*, *Agendado*), identificação do canal e botão rápido de *Cancelar*.
3. **`design-system/mockups/agent-tools-toggles-mockup.svg`**
   - **Descrição:** Tela de configuração do agente (**Editar Agente > Ferramentas**), demonstrando a inclusão fiel dos toggles com switches roxos:
     - *Acesso a Rotinas* (`routine`)
     - *Ferramentas de Agenda & Lembretes* (`reminder`)
     - *Memória Contínua & Compactação* (`memory_save` & `memory_search`)

---

## 2. Estrutura Visual e Comportamento dos Componentes

### A. Barra Lateral (Sidebar)
- **Localização:** Rodapé utilitário (`HomeUtilityNav`).
- **Ordem de exibição:**
  1. `📅 Agenda` *(Novo)*
  2. `🖼️ Mídia`
  3. `📊 KPIs e Estatísticas`
  4. `⚙️ Configurações`
  5. `❓ Ajuda`
  6. `v1.21.60`

### B. Barra Superior da Agenda (`/agenda`)
- **Título & Contador:** `📅 Agenda & Lembretes (2 Ativos)`
- **Navegador de Datas:** `[ ◀ ] Outubro 2026 [ ▶ ]`
- **Filtro de Canal:** `[ Canal: Todos ▾ ]` *(WhatsApp, Desktop, Telegram, AgentUI)*
- **Segmented Control:** `[ ▦ Grid | ☰ Lista ]` (com transição suave sem recarregar a tela)
- **Ação Primária:** Botão `+ Novo Lembrete`

### C. Toggles no Painel do Agente (`Editar Agente > Ferramentas`)
- Mantém o estilo nativo dos switches já existentes do OpenCode.
- Permite que o operador dê ao agente exatamente as ferramentas necessárias para agir de forma autônoma e segura nos canais de atendimento.
