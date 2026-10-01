# Guia do Usuário: Agenda & Central de Lembretes do OpenCode

## 1. Visão Geral
A funcionalidade de **Lembretes e Agenda** permite que o usuário crie compromissos e lembretes diretamente conversando com qualquer Agente no Chat ou pelo painel visual de rotinas. O sistema suporta notificações no momento exato e alertas antecipados (ex.: 1 hora ou 1 dia antes).

---

## 2. Como Usar no Chat com o Agente (Linguagem Natural)

Você pode solicitar lembretes de forma natural em qualquer conversa:

- *"Me lembre de enviar o relatório financeiro dia 15 de outubro às 10h, e me avise 1 dia antes."*
- *"Agende um lembrete para amanhã às 14h sobre a reunião com o cliente."*
- *"Quais são os meus lembretes pendentes para esta semana?"*
- *"Cancele o lembrete da reunião de diretoria."*

O agente utilizará a ferramenta interna `reminder` para interpretar as datas, registrar o compromisso no banco local e confirmar o agendamento imediatamente.

---

## 3. Gestão Visual na Interface (Desktop & Web)

No menu lateral do OpenCode, a seção **Rotinas / Agenda** exibe a lista completa de lembretes ativos e recorrentes.

### Recursos Disponíveis na Tela:
1. **Filtro Rápido:** Alternar entre "Próximos", "Lembretes Antecipados", "Recorrentes" e "Concluídos/Histórico".
2. **Canais de Notificação:** Identificação visual de onde o alerta será emitido (Desktop OS, Chat, Telegram ou WhatsApp).
3. **Ações Rápidas:**
   - **Adiar (Snooze):** Postergar o lembrete por 15 minutos, 1 hora ou 1 dia.
   - **Concluir / Cancelar:** Desativar lembretes que não são mais necessários.
   - **Abrir Conversa:** Leva diretamente para a sessão/agente que gerou o lembrete.

---

## 4. Comportamento das Notificações

- **No Desktop:** Uma notificação nativa do sistema operacional (com som suave e botão de ação) aparece no canto da tela no horário exato.
- **Em Sessões Ativas:** Se você estiver com o OpenCode aberto, um banner sutil de alerta é inserido na visualização atual.
- **Canais Conectados (AgentUI):** Caso o lembrete tenha sido configurado em um bot do Telegram ou WhatsApp, a notificação será enviada proativamente na conversa correspondente.

---

## 5. Fluxos de Exceção e Tratamento de Falhas

- **Computador Desligado / Modo Sleep:** Se o horário do lembrete passar com o aplicativo fechado, o OpenCode disparará o alerta retroativo de "Lembrete Atrasado" assim que for inicializado.
- **Formato de Data Ambíguo:** Se o agente não tiver certeza sobre o fuso horário ou o dia solicitado, ele fará uma pergunta de confirmação antes de gravar o agendamento.
