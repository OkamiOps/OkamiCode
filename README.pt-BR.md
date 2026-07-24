# OkamiCode

<p align="center">
  <img src="src/renderer/assets/okami-logo.png" alt="OkamiCode" width="180" />
</p>

<p align="center">
  Um cockpit desktop local-first para agentes de código, comunicação, planejamento, inteligência de uso e memória durável.
</p>

<p align="center">
  <a href="README.md">English (principal)</a> · <strong>Português do Brasil</strong>
</p>

> **Software beta.** O OkamiCode `1.0.1-beta` pode ser usado para avaliação local e desenvolvimento ativo, mas a paridade entre providers, configuração de credenciais, coleta de cotas, conectores de conta e empacotamento ainda variam conforme o transporte e o serviço.

## Por que o OkamiCode existe

Quem já paga várias assinaturas de IA não deveria manter cinco terminais e aplicativos abertos — nem pagar uma segunda conta de API — só para usar o modelo certo em cada trabalho.

O OkamiCode oferece um único ambiente visual em volta de um runtime multiprovider próprio, APIs documentadas dos providers e transportes opcionais ligados às assinaturas. Cada projeto permanece vinculado à sua pasta, cada sessão fica presa ao transporte que a criou e trocar de modelo não faz silenciosamente um agente pago controlar outro agente pago.

O restante do trabalho também entra no mesmo cockpit local: chat independente, múltiplas caixas de e-mail, agendas, tarefas Kanban, análise de uso e custo equivalente de API, memória local, diagnóstico dos runtimes, alterações Git, arquivos, terminais, navegador e processos em segundo plano.

## Novidades do 1.0.1 Beta

- **Contexto que sobrevive à troca de provider:** histórico compartilhado, handoff explícito do estado da tarefa e compactação determinística preservam o que importa sem reenviar a conversa inteira para cada modelo.
- **Continuidade local mais segura:** backup e recuperação automática do banco, descoberta dos dados da identidade anterior do aplicativo e compatibilidade com o Keychain protegem projetos, tarefas, conversas e credenciais durante atualizações.
- **Workspace Code mais calmo:** atividade compacta do agente, detalhes expansíveis, composer e painéis refinados, cores de projeto mais fortes, fixação, animação de execução, badge de conclusão não lida e feedback visível de carregamento.
- **OpenCode via ACP:** o OpenCode entra no catálogo pelo servidor ACP oficial, mas continua sendo uma opção de provider — não o dono de todas as threads do OkamiCode.
- **Verdade do runtime no lugar de adivinhação otimista:** manifestos autoritativos, descoberta de binários no aplicativo empacotado, testes de conformidade, saúde da lane e limitações explícitas por provider.
- **Economia de uso honesta:** telemetria normalizada, histórico restaurado e custo equivalente via OpenRouter agora priorizam o consumo observado e deixam a projeção mensal como informação secundária.

Leia as [notas completas do 1.0.1 Beta em PT-BR](docs/releases/v1.0.1-beta.pt-BR.md) ou a [versão em inglês](docs/releases/v1.0.1-beta.md).

## Principais recursos

### Code por workspace

- Projetos vinculados a pastas, com lanes persistentes por provider e continuidade da sessão nativa.
- Seleção de runtime e modelo diretamente no composer.
- Renderização estruturada de Markdown, atividades de ferramentas, aprovações, erros, duração e tokens.
- Alterações e diff do Git, explorador de arquivos, terminal, navegador e tarefas em segundo plano integrados.
- Modos explícitos de permissão: o OkamiCode não amplia o acesso de um agente silenciosamente.

### Chat independente

- Conversas sem workspace para pesquisa, escrita, tradução e perguntas rápidas.
- Histórico separado para não poluir projetos de desenvolvimento.
- Contexto e memória opcionais.
- Provider, modelo, effort, execução e origem da resposta continuam visíveis.

### Inbox e agenda unificados

- Várias contas IMAP/SMTP e OAuth oficial do Google para Gmail.
- Renderização de e-mail HTML com controle de imagens remotas.
- Lido/não lido, spam, lixeira, resposta, encaminhamento, aliases, ações em massa, análise com IA, revisão de rascunho e transformação de e-mail em tarefa.
- Agenda em dia, semana e mês, com fontes locais e conectadas.
- Detalhes de evento separam links de reunião, participantes, fuso horário, local e observações em blocos fáceis de ler.

### Tarefas e delegação

- Kanban para tarefas manuais ou assumidas por agentes.
- Cada tarefa guarda objetivo, diretriz, contexto de origem, workspace, provider, modelo e política de ativação.
- Tarefas delegadas a partir de e-mails continuam ligadas à conversa e só acordam a lane quando existe uma mudança relevante.

### Uso e retorno das assinaturas

- Janelas de cota nativas quando o provider fornece dados confiáveis.
- Entrada, cache de entrada, saída, reasoning e chamadas registrados por provider e modelo quando disponíveis.
- Simulação de custo equivalente de API usando preços do OpenRouter e um de/para explícito de modelos.
- Comparação assinatura versus API com fonte, frescor e cobertura.

> Os custos são estimativas, não faturas. Quando um CLI não fornece contador de tokens, o dado permanece indisponível; o OkamiCode não inventa uso zero.

### Memória local

- SQLite local criptografado com busca full-text FTS5.
- Indexação explícita e somente leitura de pastas Markdown/Obsidian selecionadas.
- Monitoramento de arquivos, proveniência, contexto limitado e remoção de linhas sensíveis.
- Detecção local da instalação e do estado do GBrain. O vault indexado não é enviado para uma memória hospedada.

## Runtimes suportados

| Runtime             | Transporte                    | Direito de uso                       |
| ------------------- | ----------------------------- | ------------------------------------ |
| OpenAI / Codex      | app-server oficial empacotado | assinatura ChatGPT via OAuth/device  |
| xAI / Grok          | agent oficial empacotado      | assinatura Grok via OAuth/device     |
| Xiaomi MiMo         | Responses do Okami            | chave e URL exclusivos do Token Plan |
| MiniMax             | Chat Completions do Okami     | chave exclusiva do Token Plan        |
| Claude Code         | Claude CLI                    | login da assinatura Anthropic        |
| Cursor Agent        | Cursor Agent                  | login da assinatura Cursor           |
| Antigravity (`agy`) | adapter local nativo          | login da assinatura Google AI        |
| OpenCode            | ACP                           | conta escolhida no OpenCode          |

A tela de Configurações mostra tanto o transporte quanto o direito de uso. Codex
e Grok são distribuídos dentro do aplicativo e não dependem de uma instalação
global. MiMo e MiniMax aceitam somente credenciais de Token Plan no cofre
criptografado. Não existe fallback automático para API pay-as-you-go.

O OpenCode entra pelo servidor ACP oficial. O BB é uma referência arquitetural
para threads persistentes, direcionáveis e handoff explícito; ele não é
embutido como um segundo orquestrador. Consulte
[Fronteira de runtimes e harnesses](docs/architecture/runtime-harness-boundary.md).

## Arquitetura

```mermaid
flowchart LR
  UI["Renderer React\nsuperfícies visuais"] -->|"IPC tipado + Zod"| PRELOAD["preload isolado"]
  PRELOAD --> MAIN["processo principal Electron"]
  MAIN --> POLICY["políticas\naprovações + leases + auditoria"]
  MAIN --> DATA["SQLite criptografado\nFTS5 + repositórios locais"]
  MAIN --> ORCH["orquestração de lanes\nsessões + eventos"]
  ORCH --> SDK["Okami Runtime SDK\nseleção de transporte + vínculo de sessão"]
  SDK --> MANAGED["Runtimes oficiais empacotados\nCodex · Grok"]
  SDK --> TOKEN["Transportes Token Plan\nMiMo · MiniMax"]
  SDK --> OPTIONAL["Transportes de compatibilidade\nClaude · Cursor · AGY · OpenCode ACP"]
  MAIN --> CONNECTORS["IMAP/SMTP · OAuth Google\nagenda · memória local"]
```

A saída de cada provider é normalizada em eventos canônicos para apresentação e persistência. O OkamiCode controla streaming de API, continuação de contexto, ferramentas de workspace, política, aprovações, cancelamento e normalização de uso nos transportes próprios. O OpenRouter continua sendo metadado de preço, não a camada padrão de inferência.

## Segurança e privacidade

- Armazenamento local-first. Conversas, índices, atividade e conectores ficam no Mac.
- SQLite criptografado com chave protegida pelo `safeStorage` do Electron.
- O renderer não acessa Node.js diretamente; ações privilegiadas usam contratos IPC validados.
- Leases de capacidade, aprovações, auditoria, expiração e correspondência de recursos limitam ações dos agentes.
- Segredos de conectores ficam fora do repositório, no diretório de dados do aplicativo.
- HTML de e-mail é sanitizado; imagens remotas têm controle separado.
- A memória só lê raízes explicitamente escolhidas e bloqueia escape por caminho ou symlink.
- Diagnósticos removem bearer tokens e valores com formato de credencial.

Nenhuma barreira é mágica: um agente autenticado localmente ainda pode alterar arquivos que você autorizou. Revise permissões e diffs antes de aprovar trabalhos sensíveis.

## Requisitos

- macOS Apple Silicon para o pacote beta.
- Node.js `24.17.0` (veja `.nvmrc`).
- pnpm `11.5.2` via Corepack.
- Xcode Command Line Tools para módulos nativos.
- Pelo menos uma assinatura autenticada ou um Token Plan configurado.

## Executar pelo código-fonte

```bash
git clone https://github.com/OkamiOps/OkamiCode.git
cd OkamiCode
nvm use
corepack enable
pnpm install
pnpm rebuild:native
pnpm dev
```

Banco e credenciais ficam no diretório de dados do Electron no macOS. Para desenvolvimento ou testes isolados, defina `OKAMI_USER_DATA_DIR` para uma pasta local exclusiva.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
pnpm check
```

`pnpm check` é o gate obrigatório. O empacotamento recompila módulos nativos para Electron; se os testes reportarem incompatibilidade de ABI do `better-sqlite3-multiple-ciphers`, recompile a dependência para o Node ativo:

```bash
pnpm rebuild better-sqlite3-multiple-ciphers
pnpm check
```

## Empacotar para macOS

```bash
pnpm package
```

O comando produz tanto o aplicativo descompactado quanto o instalador para Apple Silicon:

- `release/mac-arm64/OkamiCode.app`
- `release/OkamiCode-v1.0.1-beta-macOS-arm64.dmg`

Abra o DMG, arraste o **OkamiCode** para **Aplicativos** e execute-o pela pasta Aplicativos. O artefato `1.0.1-beta` não é assinado nem notarizado, então o macOS pode exigir aprovação em **Privacidade e Segurança**. Este beta não alega assinatura ou notarização de produção.

## Notas de configuração

- **Google:** crie um cliente OAuth do tipo Desktop e autorize Gmail/Agenda pelo navegador oficial. O OkamiCode não pede sua senha normal do Google.
- **IMAP/SMTP:** os requisitos são definidos pelo provedor. Prefira OAuth ou credencial específica de aplicativo quando exigida.
- **OpenRouter:** fornece metadados de preço para a simulação, não é o provider padrão de inferência.
- **Memória:** selecione exatamente as pastas Obsidian/Markdown; nenhuma pasta é importada automaticamente.
- **Codex e Grok:** reutilizam a sessão oficial da assinatura; o binário compatível é empacotado pelo OkamiCode.
- **MiMo e MiniMax:** informe nas Configurações apenas as credenciais exclusivas do Token Plan. Chaves comuns de API são recusadas e o segredo nunca volta ao renderer.
- **Atualizações:** capacidades de runtime e transporte são detectadas separadamente. Faça uma nova detecção depois de alterar credenciais ou atualizar um CLI opcional.

## Limitações do beta

- Apenas macOS Apple Silicon tem pacote nesta versão.
- As capacidades dos providers não são idênticas. Dados ausentes de saída estruturada, cota, tokens ou modelos aparecem como indisponíveis.
- OAuth e o comportamento de e-mail/agenda dependem da configuração e política da conta.
- As function tools do MiniMax ainda não foram implementadas no transporte Chat Completions do Okami.
- O custo equivalente pode variar até a próxima atualização dos preços do OpenRouter.
- O beta não é assinado, não é notarizado e ainda não passou por auditoria de segurança independente.

## Documentação

- [Changelog em inglês](CHANGELOG.md) · [PT-BR](CHANGELOG.pt-BR.md)
- [Release 1.0.1 Beta em inglês](docs/releases/v1.0.1-beta.md) · [PT-BR](docs/releases/v1.0.1-beta.pt-BR.md)
- [Release 1.0.0 Beta em inglês](docs/releases/v1.0.0-beta.1.md) · [PT-BR](docs/releases/v1.0.0-beta.1.pt-BR.md)
- [Princípios do produto](PRODUCT.md)

## Estado do projeto

O OkamiCode está em desenvolvimento ativo pela OkamiOps. Issues devem informar versão do OkamiCode, versão do macOS, provider/CLI, área afetada e logs sanitizados. Nunca publique tokens, JSON OAuth, senhas de caixa ou conteúdo privado de mensagens em uma issue pública.
