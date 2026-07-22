# Changelog

Todas as mudanças relevantes do OkamiCode são documentadas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/) com identificadores de pré-lançamento.

Versão principal em inglês: [CHANGELOG.md](CHANGELOG.md)

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

[1.0.0-beta.1]: https://github.com/OkamiOps/OkamiCode/releases/tag/v1.0.0-beta.1
