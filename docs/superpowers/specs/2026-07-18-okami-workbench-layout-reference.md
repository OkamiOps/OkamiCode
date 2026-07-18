# Okami Workbench — referência de layout

**Data:** 2026-07-18

**Status:** aprovado como referência estrutural obrigatória para as superfícies de UI

**Decisão:** a estrutura de layout segue o screenshot de referência (inbox estilo chat-panel); cores, tipografia e tokens seguem o design system Okami (`https://okamiops.com/design-system/`). O screenshot governa **estrutura, densidade e hierarquia**; ele não governa paleta nem identidade visual.

## 1. Origem

O usuário forneceu um screenshot de um painel de atendimento (inbox com sidebar seccionada, lista de conversas, conversa central e painel de detalhes). Essa estrutura foi aprovada como o esqueleto de todas as telas de conteúdo do Okami Workbench, combinada com os tokens Okami definidos no plano da Fase 1 (`src/styles/tokens.css`).

## 2. As cinco regiões canônicas

```text
┌────┬──────────────┬───────────────┬──────────────────────────┬───────────────┐
│Rail│   Sidebar    │  Lista/Fila   │      Conteúdo focal      │   Detalhes    │
│    │ (seccionada) │  (itens)      │ (conversa/editor/tabela) │ (contextual)  │
└────┴──────────────┴───────────────┴──────────────────────────┴───────────────┘
```

| Região | Largura base | Papel | Equivalente no screenshot |
|---|---|---|---|
| 1. Navigation rail | 64px fixa | Ícones das áreas: Início, Workbench, Inbox, Agenda, Kanban, Uso & limites, Memória, Automações, Conexões; avatar e configurações no rodapé | coluna de ícones à esquerda |
| 2. Sidebar seccionada | 240–280px, colapsável | Seções tituladas com contadores e filtros, específicas da área ativa | "Inbox / Agents / Team discussion / Team member / Filters" |
| 3. Lista | 300–340px, colapsável | Fila de itens: avatar/ícone, título, prévia de uma linha, badges de não-lido, indicadores de estado | lista de conversas com badges |
| 4. Conteúdo focal | flexível (mínimo 480px) | Conversa com bolhas + composer; ou diff/browser/tabela conforme a área | thread da conversa + "Type your message..." |
| 5. Painel de detalhes | 300–340px, colapsável | Metadados, atributos, links, tabs e ações do item selecionado | painel "Details / Combro" |

Nem toda área usa as cinco regiões: o Início usa 1+2+4; Uso & limites usa 1+2+4(+5 para detalhe da conta). Áreas de fila (Workbench, Inbox, Kanban em modo lista, Agenda em modo agenda) usam as cinco.

## 3. Mapeamento por área

### 3.1 Workbench (coding)

- **Sidebar:** seções `Tarefas` (abertas, aguardando aprovação, concluídas), `Lanes` (Claude Code, Codex — com indicador de estado e quota resumida, análogo à seção "Agents" do screenshot), `Filtros` salvos.
- **Lista:** tarefas com runtime ativo, último evento e badges de aprovação pendente.
- **Conteúdo focal:** conversa chat-native com cards de ferramenta recolhíveis e composer mostrando harness/provider/modelo/permissões.
- **Detalhes:** lane, sessão nativa, workspace, Git, uso da sessão, fontes de memória, permissões ativas (o "painel contextual" da spec, agora ancorado nesta região).

### 3.2 Inbox (email; depois WhatsApp)

- **Sidebar:** contas conectadas (Gmail, Zoho, Hostinger…), `Mentions`/`Não lidos`, `Delegados a agente`, `Spam`, filtros.
- **Lista:** threads com remetente, prévia e badges — espelho direto do screenshot.
- **Conteúdo focal:** thread com mensagens em bolhas; respostas do usuário vs. rascunhos de agente visualmente distintos; composer com modos (responder, pedir rascunho, delegar).
- **Detalhes:** dados do contato, atributos da conversa, links (tarefa vinculada, card, evento), histórico recente — como o painel "Details" do screenshot.

### 3.3 Kanban (Todoist)

- **Sidebar:** projetos Todoist, seções, filtros e labels.
- **Lista/Conteúdo:** o modo padrão é board (colunas ocupando as regiões 3+4); modo lista usa a fila padrão.
- **Detalhes:** card selecionado com responsável (Eu/Agente), política de ativação, lane associada, origem (email/conversa) e histórico.

### 3.4 Agenda

- **Sidebar:** calendários conectados com toggles de visibilidade por conta e cor.
- **Conteúdo focal:** visão combinada dia/semana/mês com sobreposição das três agendas e conflitos destacados.
- **Detalhes:** evento selecionado, participantes, conflitos, ação "virar tarefa".

### 3.5 Uso & limites

- **Sidebar:** visões `Assinaturas`, `Runtimes`, `Modelos`, `Alertas`.
- **Conteúdo focal:** tabelas e heatmaps do Usage Control Center.
- **Detalhes:** conta selecionada com janelas, resets, fonte e frescor.

## 4. Componentes recorrentes derivados do screenshot

Interpretados com HeroUI 3 + tokens Okami (nunca com a paleta creme do original):

- **Item de lista:** avatar/ícone 32px, título em uma linha, prévia truncada, badge numérico de não-lido, checkmarks de estado de entrega/leitura.
- **Seção de sidebar:** título em caixa alta discreta, itens com ícone + contador à direita, colapsável.
- **Bolhas de conversa:** entrada alinhada à esquerda em superfície neutra; saída (usuário/agente Okami) à direita em superfície de destaque; carimbo de hora e estado abaixo do grupo.
- **Painel de detalhes:** grupos `label: valor` em linhas densas, tabs no topo, ações `+ Add` inline.
- **Barra superior:** breadcrumb da área à esquerda; à direita, indicador de uso/quota (no lugar do botão "Upgrade" do original), notificações e conta.

## 5. Regras de aplicação

1. Cores, tipografia, raios, sombras e estados de foco vêm exclusivamente dos tokens Okami (`--ok-*`); nenhum valor de cor do screenshot é copiado.
2. Toda região 2, 3 e 5 é colapsável e redimensionável; os breakpoints do plano da Fase 1 continuam valendo (painel de detalhes vira drawer < 1100px; sidebar textual colapsa < 760px mantendo o rail).
3. A densidade do screenshot (listas compactas, painéis de metadados em linhas) é o alvo; não usar cards espaçosos de marketing.
4. Estados vazios, loading, erro e stale seguem a spec principal; cada região tem estado vazio próprio.
5. Tarefas de frontend devem carregar a skill `frontend-design`, este documento e o design system Okami antes de implementar qualquer superfície.

## 6. Relação com os demais documentos

- Complementa a seção 11 (Experiência desktop) da spec `2026-07-17-okami-workbench-unified-desktop-design.md`.
- Restringe as Tasks 11–13 e 18 do plano `2026-07-17-okami-workbench-phase-1.md`: o `AppShell` implementa as regiões 1, 2 e 5; Workbench implementa 3 e 4.
- Fases futuras (Inbox, Kanban/Todoist, Agenda) devem reutilizar os mesmos componentes de região em vez de criar layouts próprios.
