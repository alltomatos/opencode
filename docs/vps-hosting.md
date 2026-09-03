# Rodando o OpenCode numa VPS

Guia para deixar o OpenCode rodando 24/7 num servidor remoto (VPS) e acessar
as sessões de dois jeitos: pelo navegador (UI web embutida) ou pelo
[app desktop](../README.md#app-desktop-produção) apontando pra esse servidor
remoto como mais um "servidor" na lista de projetos.

O core do servidor (`opencode serve` / `opencode web`) vem do projeto
original — este guia só documenta como usá-lo no contexto deste fork. Para a
referência completa de flags, veja [opencode.ai/docs/cli](https://opencode.ai/docs/cli#serve).

---

## 1. Escolha o modo

| Comando | O que faz | Quando usar |
| --- | --- | --- |
| `opencode web` | Sobe o servidor **e** serve a UI web (a mesma UI do desktop, no navegador) | Você quer acessar as sessões só pelo navegador, de qualquer lugar |
| `opencode serve` | Sobe **só** a API HTTP, sem UI web embutida | Você só vai acessar via [OpenCode Desktop](../README.md#app-desktop-produção) ou TUI, conectando nesse servidor como remoto |

Os dois aceitam as mesmas flags de rede (`--port`, `--hostname`, `--cors`,
`--mdns`).

## 2. Instalação na VPS

```bash
curl -fsSL https://opencode.ai/install | bash
# ou, se preferir gerenciar a versão via bun/npm:
bun install -g opencode-ai
```

> Este fork não publica um instalador Linux separado para o binário CLI —
> só o app desktop empacotado (`.deb`/`.rpm`/`.AppImage`) é buildado a
> partir de `prod`. Para o CLI puro numa VPS, use a instalação padrão do
> projeto original acima.

## 3. Suba o servidor

```bash
export OPENCODE_SERVER_PASSWORD="uma-senha-forte-aqui"
# opcional: export OPENCODE_SERVER_USERNAME="opencode" (esse já é o padrão)

opencode web --hostname 0.0.0.0 --port 4096
# ou, sem UI web:
opencode serve --hostname 0.0.0.0 --port 4096
```

**`OPENCODE_SERVER_PASSWORD` não é opcional numa VPS exposta.** Sem ela o
servidor fica sem autenticação (HTTP Basic) e qualquer um que descubra o IP
e a porta tem acesso total às suas sessões e ao shell do agente na máquina.
O CLI avisa no terminal se você esquecer.

### Rodando como serviço (systemd)

Pra manter o servidor no ar depois que a sessão SSH fecha:

```ini
# /etc/systemd/system/opencode.service
[Unit]
Description=OpenCode server
After=network.target

[Service]
Type=simple
User=opencode
Environment=OPENCODE_SERVER_PASSWORD=uma-senha-forte-aqui
ExecStart=/usr/bin/opencode web --hostname 0.0.0.0 --port 4096
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opencode
sudo systemctl status opencode
```

### TLS / proxy reverso

O OpenCode não faz HTTPS sozinho. Para expor a porta na internet com
segurança, coloque um proxy na frente (nginx, Caddy, Traefik) fazendo a
terminação TLS e repassando pra `127.0.0.1:4096`. Exemplo mínimo com Caddy:

```
opencode.seudominio.com {
  reverse_proxy 127.0.0.1:4096
}
```

Com o proxy, mantenha `--hostname 127.0.0.1` no `opencode` (só o proxy fica
exposto na 443) e libere apenas as portas 80/443 no firewall da VPS.

### Alternativa: túnel SSH em vez de expor a porta

Se você já tem acesso SSH (com chave) à VPS e prefere não abrir a porta do
`opencode` pra internet nem configurar TLS, dá pra rodar o servidor com
`--hostname 127.0.0.1` (sem liberar nada no firewall além da 22) e acessar
via túnel:

```bash
ssh -L 4096:127.0.0.1:4096 usuario@ip-da-vps
```

Com o túnel aberto, aponte o navegador ou o Desktop (Adicionar servidor)
pra `http://127.0.0.1:4096` — a autenticação forte nesse caminho é a sua
chave SSH; o usuário/senha do `OPENCODE_SERVER_PASSWORD` continua valendo
por trás como segunda camada. Os dois modelos de acesso (porta pública com
Basic Auth, ou túnel SSH) podem coexistir — o servidor não precisa escolher
um ou outro, quem decide é o cliente na hora de conectar.

**No app Desktop você não precisa abrir esse túnel manualmente.** Em
Configurações → Servidores → Adicionar servidor → **Adicionar túnel SSH**,
informe host, porta SSH, usuário, a chave (o app lista as chaves disponíveis
em `~/.ssh`), a porta remota do opencode e as credenciais do
`OPENCODE_SERVER_PASSWORD`. O app abre e mantém o túnel sozinho (reabrindo
automaticamente ao reiniciar), sem precisar de terminal aberto.

## 4. Acessando

### Pelo navegador (`opencode web`)

Abra `https://opencode.seudominio.com` (ou `http://<ip-da-vps>:4096` sem
proxy) e faça login com o usuário/senha do `OPENCODE_SERVER_PASSWORD`.

### Pelo OpenCode Desktop (`opencode serve` ou `opencode web`)

No app desktop: **Configurações → Servidores → Adicionar servidor**, informe
a URL (`https://opencode.seudominio.com` ou `http://<ip>:4096`) e as
credenciais. O servidor remoto passa a aparecer como mais uma opção na
troca de projetos/sessões — igual ao servidor local, só que os arquivos e o
agente rodam na VPS.

### Pelo TUI, anexando a um servidor já rodando

```bash
opencode attach https://opencode.seudominio.com
```

## O que funciona igual, e o que é só do desktop

Todo o trabalho de UI (correções de renderização de sessão, reconexão de
eventos, etc.) vive no pacote compartilhado (`packages/app`) e roda igual
tanto no navegador quanto dentro do Electron — não é preciso nenhuma
adaptação extra pra usar via VPS.

Ficam de fora, por serem conceitos específicos de janela desktop:

- O toggle **"Modo debug"** e o botão **"Abrir DevTools"** (Configurações →
  Avançado) — no navegador você já tem o DevTools nativo.
- O ajuste de **zoom por pinça/Ctrl+scroll** — é um recurso da janela do
  Electron, não da UI em si.

## 5. Bot do Telegram numa VPS

O bot do Telegram (Configurações → Integrações) é um serviço do próprio
servidor `opencode` (`packages/opencode`), não do app desktop — funciona
idêntico rodando local ou numa VPS, sem nenhuma configuração extra além de
alcançar a UI onde estiver rodando:

1. Suba o servidor na VPS normalmente (seção 3 acima, `opencode web` ou
   `opencode serve`).
2. Acesse **Configurações → Integrações** — pela **web UI**
   (`opencode web`) direto no navegador, ou pelo **desktop conectado como
   servidor remoto** (seção 4, "Pelo OpenCode Desktop"). As duas telas
   batem no mesmo servidor, então tanto faz por qual delas você conecta o
   bot.
3. Cole o token do bot (criado com [@BotFather](https://t.me/BotFather)) e
   conecte.

A partir daí o servidor mantém um loop de long-polling (`getUpdates`) ativo
enquanto estiver no ar — não precisa de porta extra aberta nem HTTPS
público, o próprio `opencode` puxa as mensagens do Telegram. Cada
conversa do Telegram vira uma sessão do opencode no projeto/diretório que
estava ativo quando você conectou o bot; a próxima mensagem da mesma
conversa reaproveita a mesma sessão (o mapeamento é persistido em disco,
sobrevive a um restart do processo).

**Rodando como serviço (systemd)**: nenhuma unidade extra é necessária — o
bot vive dentro do mesmo processo `opencode` da seção 3; reiniciar o
serviço reconecta o bot automaticamente se havia um token salvo.

## Segurança — checklist rápido

- [ ] `OPENCODE_SERVER_PASSWORD` definido (senha forte, não reaproveitada)
- [ ] Acesso pela internet só via proxy reverso com TLS, nunca a porta do
      `opencode` exposta diretamente
- [ ] Firewall da VPS liberando só 22 (SSH) e 80/443 (proxy)
- [ ] `opencode` rodando como usuário sem privilégios de root
- [ ] Token do bot do Telegram tratado como credencial sensível — quem
      tiver o token consegue conversar com o agente na sua VPS
