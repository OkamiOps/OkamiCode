# Changelog

Todas as mudanças relevantes do OkamiCode são documentadas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/) com identificadores de pré-lançamento.

Versão em inglês: [CHANGELOG.md](CHANGELOG.md)

## [1.0.1-beta] - 2026-07-23

### Adicionado

- Histórico compartilhado entre providers, com handoff explícito do estado da tarefa e compactação determinística do contexto.
- Integração do OpenCode pelo servidor ACP oficial, incluindo prontidão, ciclo de vida, cancelamento, descoberta de modelos e eventos de ocupação do contexto.
- Manifestos autoritativos de runtime, descoberta de capacidades, resolução de binários no aplicativo empacotado, cobertura de conformidade e apresentação da saúde da lane.
- Indicadores de atividade dos projetos com animação de execução, badge de conclusão não lida, identidade de cor mais forte, fixação e feedback ao trocar de projeto.
- Backup e recuperação automática do banco criptografado antes de caminhos arriscados de inicialização ou migração.

### Alterado

- Redesenho do workspace Code com composer mais discreto, atividade compacta e expansível, painéis recolhíveis, apresentação mais rica de Markdown/HTML e estados de execução mais claros.
- O contexto compartilhado agora envia um estado de tarefa limitado e neutro ao provider, em vez de tratar cada lane como uma conversa vazia e isolada.
- A contabilidade de uso normaliza sinais específicos de entrada, cache, saída e total de tokens em um único modelo canônico.
- A análise das assinaturas agora destaca o custo equivalente observado no período e mantém a projeção mensal como informação secundária.
- Disponibilidade e limitações dos runtimes passam a vir das capacidades detectadas, não de defaults otimistas.

### Corrigido

- Preservação de projetos, tarefas, conversas, worktrees e referências de sessões nativas ao abrir o aplicativo renomeado com sua identidade local anterior.
- Manutenção do acesso às credenciais já protegidas no Keychain após a renomeação do produto.
- Descoberta de executáveis no aplicativo empacotado para runtimes de assinatura, incluindo caminhos do Cursor Agent, MiniMax, OpenCode, Claude e Codex.
- Restauração do histórico de tokens por provider que havia sido excluído da visualização de custos.
- Separação entre ocupação de contexto, totais acumulados e uso por turno para evitar números de tokens enganosos.
- Correção do abre/fecha dos painéis, empilhamento de modais, fixação de projetos e indicadores travados de carregamento ou execução.

### Limitações conhecidas do beta

- O pacote suporta apenas macOS Apple Silicon, sem assinatura e sem notarização.
- Capacidades ainda dependem da versão do CLI instalado e da conta autenticada.
- Alguns runtimes não expõem tokens por turno ou cota nativa da assinatura com confiabilidade.
- O custo equivalente de API é uma estimativa baseada no OpenRouter, não uma fatura do provider.
- Recomenda-se ao menos sete dias observados antes de tratar a projeção mensal como base confiável para decisão.

## [1.0.0-beta.1] - 2026-07-23

### Adicionado

- Aplicação desktop Electron local-first com Início, Code, Chat independente, Inbox, Agenda, Kanban, Uso, Memória, Agentes, Modelos, Conexões, Gestão e Configurações.
- Adapters nativos para Claude Code, Codex, Cursor Agent, Antigravity, Grok CLI, MiMo Code e MiniMax `mmx`.
- Lanes persistentes por workspace, sessões nativas, seleção de provider/modelo/effort, aprovações, cancelamento e projeção de eventos canônicos.
- Status e diff do Git, visualizador de arquivos, terminal, navegador e tarefas em segundo plano integrados.
- Inbox IMAP/SMTP para várias contas e OAuth do Google, HTML de e-mail, aliases, imagens remotas, ações em massa, resposta/encaminhamento, análise com IA, revisão de rascunho e e-mail para tarefa.
- Agenda em dia/semana/mês com fontes locais e conectadas, detalhes estruturados, links de reunião, participantes, fusos e locais.
- Kanban operacional com responsabilidade manual/delegada, contexto de origem, diretriz, workspace e ativação do agente apenas quando existe mudança relevante.
- Coleta de cotas nativas e atividade por modelo quando o provider oferece dados confiáveis.
- Simulação de custo equivalente via OpenRouter com de/para explícito, entrada/cache/saída, cobertura e frescor.
- SQLite criptografado, memória FTS5, indexação explícita de Obsidian/Markdown, watcher, proveniência, redação de conteúdo sensível e detecção do GBrain.
- Favoritos, catálogos de modelos, capacidades de CLI, ações de atualização e diagnóstico dos runtimes.
- Interface do produto em português e documentação pública bilíngue.

### Segurança

- Contratos IPC validados e isolamento dos privilégios do renderer.
- Leases de capacidade, expiração de aprovação, correspondência de recursos, auditoria persistente e exportação.
- Proteção local de segredos com `safeStorage` do Electron e SQLite criptografado.
- Remoção de credenciais em diagnósticos, sanitização de HTML, indexação de memória limitada por caminho e bloqueio de escape por symlink.

### Limitações conhecidas do beta

- O pacote suporta apenas macOS Apple Silicon, sem assinatura e sem notarização.
- A paridade depende do CLI instalado e da assinatura autenticada.
- Telemetria ausente de modelos, tokens, cotas ou preço permanece indisponível.
- O CLI atual do MiMo não expõe a cota nativa.
- Conectores dependem das políticas OAuth e de conta de cada provedor.

[1.0.1-beta]: https://github.com/OkamiOps/OkamiCode/releases/tag/v1.0.1-beta
[1.0.0-beta.1]: https://github.com/OkamiOps/OkamiCode/releases/tag/v1.0.0-beta.1
