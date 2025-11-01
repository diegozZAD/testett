# YouTube Multi-Session (Electron)

Aplicativo Electron completo para abrir várias abas independentes do YouTube com sessões persistentes e isoladas, perfeito para usar contas diferentes simultaneamente.

## Requisitos

- Node.js LTS (18.x ou superior recomendado)
- NPM (instalado junto com o Node)

## Instalação e execução

```bash
npm install
npm start
```

> Dica: para desabilitar a aceleração de hardware utilize `npm start -- --disable-gpu`. O código já possui o trecho comentado chamando `app.disableHardwareAcceleration()` antes do `app.whenReady()` para evitar o erro clássico.

### Rodando em modo headless

Para ativar o modo headless sem usar o terminal, abra o menu **Modo → Ativar Modo Headless**. O aplicativo será reiniciado automaticamente com todas as janelas ocultas, mantendo os BrowserViews carregados em segundo plano e exibindo um aviso visual na interface (quando estiver visível).

Para voltar à interface normal basta usar **Modo → Desativar Modo Headless**. Também há um script auxiliar `npm run start:headless` e a flag `npm start -- --headless` caso queira iniciar direto nesse modo.

Nesse modo nenhuma janela é exibida: a aplicação se mantém em segundo plano, o Chromium roda sem interface visível e o áudio é silenciado. As sessões continuam funcionando com as mesmas partitions persistentes — perfeito para manter várias contas logadas consumindo o mínimo possível. Configure ou edite as abas previamente (com a interface normal) e depois reinicie em headless para reaproveitar as mesmas sessões.

## Como funciona

- Cada aba utiliza uma `BrowserView` com uma partition exclusiva (`session.fromPartition('persist:perfil_<UUID>')`), garantindo isolamento de cookies, logins e storage — o comportamento é equivalente a várias janelas anônimas, porém com os logins do Google preservados em disco para reutilização.
- As informações das abas são persistidas em `profiles.json` dentro da pasta `userData` do Electron (`%APPDATA%` no Windows, `~/Library/Application Support` no macOS, `~/.config` no Linux). O arquivo incluído na raiz do projeto é apenas um template vazio.
- Ao iniciar, o app recria as abas registradas em `profiles.json` (sem navegar automaticamente caso `lastUrl` esteja vazio).
- Alterações como navegação, renomear, limpar sessão ou trocar User-Agent são salvas imediatamente.

### Privacidade e isolamento

- Cada partition recebe uma configuração endurecida (`setPermissionRequestHandler`) bloqueando permissões invasivas (notificações, geolocalização, captura de mídia), mantendo o ambiente mais “anônimo”.
- O corretor ortográfico é desabilitado e capturas de tela/aplicações externas são negadas para reduzir vazamento de dados.
- Áudio é silenciado automaticamente quando o modo headless está ativo, evitando ruídos ao executar várias sessões em segundo plano.

## Interface

- **Sidebar**
  - Formulário para criar novas abas informando nome (opcional) e URL do YouTube.
  - Lista de perfis/abas, com seleção por clique e menu de contexto (botão direito) para limpar a sessão daquela aba.
- **Painel superior** (acima do player)
  - Campos para editar o nome da aba, navegar para uma URL, definir User-Agent customizado, limpar sessão e fechar a aba.
  - Mensagens de status para indicar erros de navegação, confirmações e avisos.
- **Área principal**
  - O player do YouTube ocupa o espaço à direita da sidebar abaixo do painel de controles, redimensionando automaticamente com a janela.

## Fluxo sugerido

1. Clique em **Nova Aba** e informe a URL do YouTube desejada (por padrão já vem `https://www.youtube.com`).
2. Selecione a aba na lista da sidebar para carregá-la.
3. Faça login na conta Google desejada dentro do player — a sessão fica restrita àquela aba.
4. Use o campo **URL** para navegar para outro vídeo/canal/shorts.
5. Para renomear a aba, edite o campo **Nome** e clique em **Salvar Nome**.
6. Para limpar apenas a sessão dessa aba, use o botão **Apagar Sessão desta Aba** ou clique com o botão direito na aba e escolha a mesma opção.
7. Para fechar a aba (mantendo a sessão no disco), clique em **Fechar Aba** e confirme no diálogo. A sessão permanece armazenada na partition correspondente até que seja limpa manualmente.

## Localização do arquivo `profiles.json`

- Windows: `%APPDATA%/YouTube Multi-Session/profiles.json`
- macOS: `~/Library/Application Support/YouTube Multi-Session/profiles.json`
- Linux: `~/.config/YouTube Multi-Session/profiles.json`

Apague esse arquivo para resetar todas as sessões.

## Auto-teste manual

Ao iniciar o app, o console exibe um roteiro de verificação rápida:

1. Criar aba A, abrir YouTube, logar; fechar o app; reabrir → sessão A mantida.
2. Criar aba B, abrir outro link, logar com outra conta → sessões isoladas.
3. Usar **Apagar Sessão desta Aba** na B → limpa apenas a B.
4. Fechar aba não apaga a sessão — apenas remove do `profiles.json` quando confirmado.
5. Redimensionar a janela mantém o player ajustado.

Basta seguir esses passos para validar o funcionamento.

## Estrutura de pastas

```
.
├── main.js
├── preload.js
├── profiles.json
├── renderer
│   ├── index.html
│   ├── renderer.js
│   └── styles.css
├── package.json
└── README.md
```

O projeto está pronto para ser zipado e distribuído. Basta rodar os comandos informados e aproveitar.
