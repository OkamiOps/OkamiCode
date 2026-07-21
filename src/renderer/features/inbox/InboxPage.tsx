import {
  AlertDialog,
  Badge,
  Button,
  Drawer,
  Spinner,
  Tooltip,
  useOverlayState,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  AtSign,
  Bot,
  CircleAlert,
  ExternalLink,
  Inbox as InboxIcon,
  Mail,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { InboxAccountModal } from "./InboxAccountModal";
import { InboxOutgoingSettingsModal } from "./InboxOutgoingSettingsModal";
import { InboxReplyModal } from "./InboxReplyModal";
import { InboxTaskModal } from "./InboxTaskModal";

type InboxAccount = IpcResponse<"inbox:accounts:list">[number];
type InboxThread = IpcResponse<"inbox:threads:list">["threads"][number];
type InboxThreadDetail = IpcResponse<"inbox:thread:get">;

export interface InboxApi {
  listAccounts(): Promise<IpcResponse<"inbox:accounts:list">>;
  addAccount(
    request: IpcRequest<"inbox:account:add">,
  ): Promise<IpcResponse<"inbox:account:add">>;
  removeAccount(
    request: IpcRequest<"inbox:account:remove">,
  ): Promise<IpcResponse<"inbox:account:remove">>;
  syncAccount(
    request: IpcRequest<"inbox:account:sync">,
  ): Promise<IpcResponse<"inbox:account:sync">>;
  getOutgoingSettings(
    request: IpcRequest<"inbox:account:outgoing:get">,
  ): Promise<IpcResponse<"inbox:account:outgoing:get">>;
  setOutgoingSettings(
    request: IpcRequest<"inbox:account:outgoing:set">,
  ): Promise<IpcResponse<"inbox:account:outgoing:set">>;
  listThreads(
    request: IpcRequest<"inbox:threads:list">,
  ): Promise<IpcResponse<"inbox:threads:list">>;
  getThread(
    request: IpcRequest<"inbox:thread:get">,
  ): Promise<IpcResponse<"inbox:thread:get">>;
  markThreadRead(
    request: IpcRequest<"inbox:thread:markRead">,
  ): Promise<IpcResponse<"inbox:thread:markRead">>;
  listLanes(
    request: IpcRequest<"lane:list">,
  ): Promise<IpcResponse<"lane:list">>;
  createTask(
    request: IpcRequest<"inbox:thread:createTask">,
  ): Promise<IpcResponse<"inbox:thread:createTask">>;
  createReplyDraft(
    request: IpcRequest<"inbox:thread:createReplyDraft">,
  ): Promise<IpcResponse<"inbox:thread:createReplyDraft">>;
}

const defaultApi: InboxApi = {
  listAccounts: workbenchClient.inboxAccountsList,
  addAccount: workbenchClient.inboxAccountAdd,
  removeAccount: workbenchClient.inboxAccountRemove,
  syncAccount: workbenchClient.inboxAccountSync,
  getOutgoingSettings: workbenchClient.inboxAccountOutgoingGet,
  setOutgoingSettings: workbenchClient.inboxAccountOutgoingSet,
  listThreads: workbenchClient.inboxThreadsList,
  getThread: workbenchClient.inboxThreadGet,
  markThreadRead: workbenchClient.inboxThreadMarkRead,
  listLanes: workbenchClient.laneList,
  createTask: workbenchClient.inboxThreadCreateTask,
  createReplyDraft: workbenchClient.inboxThreadCreateReplyDraft,
};

type AccountFilter = "all" | "unread" | string;

export function InboxPage({ api = defaultApi }: { api?: InboxApi }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [taskCreatedForThreadId, setTaskCreatedForThreadId] = useState<
    string | null
  >(null);
  const [replySavedForThreadId, setReplySavedForThreadId] = useState<
    string | null
  >(null);
  const markedRead = useRef(new Set<string>());
  const detailsDrawer = useOverlayState();
  const accounts = useQuery({
    queryKey: ["inbox", "accounts"],
    queryFn: api.listAccounts,
  });
  const threadRequest = useMemo<IpcRequest<"inbox:threads:list">>(() => {
    if (filter === "unread") return { unreadOnly: true, limit: 100 };
    if (filter === "all") return { limit: 100 };
    return { accountIds: [filter], limit: 100 };
  }, [filter]);
  const threads = useQuery({
    queryKey: ["inbox", "threads", threadRequest],
    queryFn: () => api.listThreads(threadRequest),
  });
  const detail = useQuery({
    queryKey: ["inbox", "thread", selectedThreadId],
    queryFn: () => api.getThread({ threadId: selectedThreadId! }),
    enabled: selectedThreadId !== null,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["inbox", "accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox", "threads"] });
  };
  const addAccount = useMutation({
    mutationFn: api.addAccount,
    onSuccess: refresh,
  });
  const syncAccount = useMutation({
    mutationFn: api.syncAccount,
    onSuccess: refresh,
  });
  const removeAccount = useMutation({
    mutationFn: api.removeAccount,
    onSuccess: (_result, request) => {
      if (filter === request.accountId) setFilter("all");
      const activeThread =
        detail.data?.thread ??
        threadById(threads.data?.threads, selectedThreadId);
      if (activeThread?.accountId === request.accountId) {
        if (selectedThreadId) {
          queryClient.removeQueries({
            queryKey: ["inbox", "thread", selectedThreadId],
          });
        }
        setSelectedThreadId(null);
        detailsDrawer.close();
      }
      refresh();
    },
  });
  const markRead = useMutation({
    mutationFn: api.markThreadRead,
    onError: (_error, request) => {
      markedRead.current.delete(request.threadId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<IpcResponse<"inbox:threads:list">>(
        ["inbox", "threads", threadRequest],
        (current) =>
          current
            ? {
                ...current,
                threads: threadRequest.unreadOnly
                  ? current.threads.filter((item) => item.id !== updated.id)
                  : current.threads.map((item) =>
                      item.id === updated.id
                        ? { ...item, unreadCount: updated.unreadCount }
                        : item,
                    ),
              }
            : current,
      );
      queryClient.setQueryData<IpcResponse<"inbox:thread:get">>(
        ["inbox", "thread", updated.id],
        (current) => (current ? { ...current, thread: updated } : current),
      );
    },
  });
  const createTask = useMutation({
    mutationFn: api.createTask,
    onSuccess: (result) => {
      setTaskCreatedForThreadId(result.sourceThreadId);
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
  const createReplyDraft = useMutation({
    mutationFn: api.createReplyDraft,
    onSuccess: (result) => {
      setReplySavedForThreadId(result.sourceThreadId);
    },
  });

  const selectedThread =
    detail.data?.thread ?? threadById(threads.data?.threads, selectedThreadId);
  const visibleUnreadCount = threads.data?.threads.filter(
    (thread) => thread.unreadCount > 0,
  ).length;
  const markThreadRead = markRead.mutate;

  useEffect(() => {
    if (
      !selectedThreadId ||
      !selectedThread ||
      selectedThread.unreadCount === 0
    )
      return;
    if (markedRead.current.has(selectedThreadId)) return;
    markedRead.current.add(selectedThreadId);
    markThreadRead({ threadId: selectedThreadId });
  }, [markThreadRead, selectedThread, selectedThreadId]);

  function selectThread(thread: InboxThread) {
    setSelectedThreadId(thread.id);
  }

  return (
    <section aria-label="Inbox" className="inbox-page">
      <InboxSidebar
        accounts={accounts.data ?? []}
        activeFilter={filter}
        accountsError={accounts.isError ? errorMessage(accounts.error) : null}
        isAdding={addAccount.isPending}
        isLoading={accounts.isLoading}
        onAdd={(request) => addAccount.mutateAsync(request)}
        onFilterChange={setFilter}
        onRemove={(accountId) => removeAccount.mutate({ accountId })}
        onSync={(accountId) => syncAccount.mutate({ accountId })}
        getOutgoingSettings={api.getOutgoingSettings}
        setOutgoingSettings={api.setOutgoingSettings}
        pendingAccountId={
          syncAccount.isPending ? syncAccount.variables?.accountId : null
        }
        removingAccountId={
          removeAccount.isPending ? removeAccount.variables?.accountId : null
        }
        unreadCount={visibleUnreadCount}
      />
      <ThreadList
        activeFilter={filter}
        error={threads.isError ? errorMessage(threads.error) : null}
        isLoading={threads.isLoading}
        onSelect={selectThread}
        selectedThreadId={selectedThreadId}
        threads={threads.data?.threads ?? []}
      />
      <Conversation
        detail={detail.data}
        error={detail.isError ? errorMessage(detail.error) : null}
        isSavingReply={createReplyDraft.isPending}
        isLoading={detail.isLoading}
        isCreatingTask={createTask.isPending}
        onCreateReplyDraft={(request) => createReplyDraft.mutateAsync(request)}
        onOpenDetails={detailsDrawer.open}
        onCreateTask={(request) => createTask.mutateAsync(request)}
        replySaved={replySavedForThreadId === detail.data?.thread.id}
        taskCreated={taskCreatedForThreadId === detail.data?.thread.id}
        listLanes={api.listLanes}
      />
      <aside className="inbox-details-region" aria-label="Detalhes da conversa">
        <InboxDetails
          account={accountForThread(accounts.data ?? [], selectedThread)}
          thread={selectedThread}
        />
      </aside>
      <DetailsDrawer
        account={accountForThread(accounts.data ?? [], selectedThread)}
        state={detailsDrawer}
        thread={selectedThread}
      />
    </section>
  );
}

function InboxSidebar({
  accounts,
  accountsError,
  activeFilter,
  isAdding,
  isLoading,
  getOutgoingSettings,
  onAdd,
  onFilterChange,
  onRemove,
  onSync,
  setOutgoingSettings,
  pendingAccountId,
  removingAccountId,
  unreadCount,
}: {
  accounts: InboxAccount[];
  accountsError: string | null;
  activeFilter: AccountFilter;
  isAdding: boolean;
  isLoading: boolean;
  getOutgoingSettings: InboxApi["getOutgoingSettings"];
  onAdd: (request: IpcRequest<"inbox:account:add">) => Promise<unknown>;
  onFilterChange: (filter: AccountFilter) => void;
  onRemove: (accountId: string) => void;
  onSync: (accountId: string) => void;
  setOutgoingSettings: InboxApi["setOutgoingSettings"];
  pendingAccountId: string | null | undefined;
  removingAccountId: string | null | undefined;
  unreadCount: number | undefined;
}) {
  return (
    <aside className="inbox-sidebar-region" aria-label="Contas e filtros">
      <header className="inbox-sidebar-header">
        <div>
          <p className="inbox-eyebrow">Comunicação local</p>
          <h1>Inbox</h1>
        </div>
        <InboxAccountModal isPending={isAdding} onSubmit={onAdd} />
      </header>
      <div className="inbox-sidebar-scroll">
        <section className="inbox-nav-section" aria-label="Caixas de entrada">
          <p className="inbox-section-label">Caixas</p>
          <FilterButton
            active={activeFilter === "all"}
            icon={<InboxIcon size={15} />}
            label="Todas as caixas"
            onPress={() => onFilterChange("all")}
          />
          <FilterButton
            active={activeFilter === "unread"}
            count={unreadCount || undefined}
            icon={<Mail size={15} />}
            label="Não lidos"
            onPress={() => onFilterChange("unread")}
          />
          {isLoading && <p className="inbox-state-small">Carregando contas…</p>}
          {accountsError && (
            <p
              className="inbox-state-small inbox-state-small--error"
              role="alert"
            >
              {accountsError}
            </p>
          )}
          {accounts.map((entry) => {
            const account = entry.account;
            const syncing =
              pendingAccountId === account.id || account.status === "syncing";
            return (
              <div
                className="inbox-account-row"
                data-active={activeFilter === account.id || undefined}
                data-syncing={syncing || undefined}
                key={account.id}
              >
                <button
                  className="inbox-account-row__select"
                  onClick={() => onFilterChange(account.id)}
                  type="button"
                >
                  <span
                    className={`inbox-account-status inbox-account-status--${account.status}`}
                  />
                  <span className="inbox-account-row__copy">
                    <strong>{account.displayName}</strong>
                    <small>{account.address}</small>
                  </span>
                </button>
                <div className="inbox-account-row__actions">
                  <InboxOutgoingSettingsModal
                    account={account}
                    getOutgoingSettings={getOutgoingSettings}
                    setOutgoingSettings={setOutgoingSettings}
                  />
                  <Button
                    aria-label={`Sincronizar ${account.displayName}`}
                    className="inbox-account-action"
                    isDisabled={syncing}
                    isIconOnly
                    onPress={() => onSync(account.id)}
                    size="sm"
                    variant="ghost"
                  >
                    {syncing ? (
                      <Spinner size="sm" />
                    ) : (
                      <RefreshCw aria-hidden="true" size={13} />
                    )}
                  </Button>
                  <RemoveAccountAction
                    account={account}
                    isPending={removingAccountId === account.id}
                    onRemove={onRemove}
                  />
                </div>
              </div>
            );
          })}
          {!isLoading && !accountsError && accounts.length === 0 && (
            <div className="inbox-empty-accounts">
              <MailPlusIcon />
              <strong>Conecte a primeira caixa</strong>
              <span>Gmail, Zoho, Hostinger ou qualquer IMAP.</span>
            </div>
          )}
        </section>
        <section
          className="inbox-nav-section inbox-nav-section--muted"
          aria-label="Filtros futuros"
        >
          <p className="inbox-section-label">Fluxos</p>
          <FilterButton disabled icon={<AtSign size={15} />} label="Menções" />
          <FilterButton
            disabled
            icon={<Bot size={15} />}
            label="Delegados a agente"
          />
          <FilterButton disabled icon={<Archive size={15} />} label="Spam" />
        </section>
      </div>
    </aside>
  );
}

function FilterButton({
  active = false,
  count,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  count?: number;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="inbox-filter-button"
      data-active={active || undefined}
      isDisabled={disabled}
      onPress={onPress}
      variant="ghost"
    >
      <span className="inbox-filter-button__icon">{icon}</span>
      <span>{label}</span>
      {count ? (
        <Badge className="inbox-count" size="sm">
          {count}
        </Badge>
      ) : null}
    </Button>
  );
}

function RemoveAccountAction({
  account,
  isPending,
  onRemove,
}: {
  account: InboxAccount["account"];
  isPending: boolean;
  onRemove: (accountId: string) => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        aria-label={`Remover ${account.displayName}`}
        className="inbox-account-action inbox-account-action--danger"
      >
        <Trash2 aria-hidden="true" size={13} />
      </AlertDialog.Trigger>
      <AlertDialog.Backdrop className="inbox-modal-backdrop">
        <AlertDialog.Container
          className="inbox-confirm-dialog"
          placement="center"
        >
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                Remover {account.displayName}?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                A caixa e as credenciais locais serão removidas. As mensagens já
                indexadas deixam de aparecer nesta área.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <AlertDialog.CloseTrigger className="inbox-confirm-cancel">
                Cancelar
              </AlertDialog.CloseTrigger>
              <AlertDialog.CloseTrigger
                aria-label="Remover conta"
                className="inbox-confirm-remove"
                isDisabled={isPending}
                onPress={() => onRemove(account.id)}
              />
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog.Root>
  );
}

function ThreadList({
  activeFilter,
  error,
  isLoading,
  onSelect,
  selectedThreadId,
  threads,
}: {
  activeFilter: AccountFilter;
  error: string | null;
  isLoading: boolean;
  onSelect: (thread: InboxThread) => void;
  selectedThreadId: string | null;
  threads: InboxThread[];
}) {
  return (
    <section className="inbox-thread-list" aria-label="Lista de conversas">
      <header className="inbox-thread-list__header">
        <div>
          <p className="inbox-eyebrow">
            {activeFilter === "unread" ? "Não lidos" : "Conversas"}
          </p>
          <h2>{isLoading ? "Carregando" : `${threads.length} abertas`}</h2>
        </div>
        <Button
          aria-label="Mais filtros em breve"
          className="inbox-list-menu"
          isDisabled
          isIconOnly
          size="sm"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" size={16} />
        </Button>
      </header>
      <div className="inbox-thread-list__scroll">
        {isLoading && (
          <ListState
            icon={<Spinner size="sm" />}
            text="Carregando conversas…"
          />
        )}
        {error && (
          <ListState error icon={<CircleAlert size={16} />} text={error} />
        )}
        {!isLoading && !error && threads.length === 0 && (
          <ListState
            icon={<Mail size={16} />}
            text="Nenhuma conversa nesta fila."
          />
        )}
        {threads.map((thread) => (
          <button
            aria-label={`${thread.subject} — ${thread.snippet}`}
            className="inbox-thread-row"
            data-selected={thread.id === selectedThreadId || undefined}
            key={thread.id}
            onClick={() => onSelect(thread)}
            type="button"
          >
            <span className="inbox-thread-avatar">
              {initials(primaryParticipant(thread))}
            </span>
            <span className="inbox-thread-row__body">
              <span className="inbox-thread-row__heading">
                <strong>{primaryParticipant(thread)}</strong>
                <time>{shortDate(thread.lastMessageAt)}</time>
              </span>
              <span className="inbox-thread-row__subject">
                {thread.subject || "(sem assunto)"}
              </span>
              <span className="inbox-thread-row__preview">
                {thread.snippet}
              </span>
            </span>
            {thread.unreadCount > 0 && (
              <Badge className="inbox-unread-badge" size="sm">
                {thread.unreadCount}
              </Badge>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function ListState({
  error = false,
  icon,
  text,
}: {
  error?: boolean;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <p
      className={`inbox-list-state${error ? " inbox-list-state--error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {icon}
      {text}
    </p>
  );
}

function Conversation({
  detail,
  error,
  isLoading,
  isSavingReply,
  isCreatingTask,
  listLanes,
  onCreateReplyDraft,
  onCreateTask,
  onOpenDetails,
  replySaved,
  taskCreated,
}: {
  detail: InboxThreadDetail | undefined;
  error: string | null;
  isLoading: boolean;
  isSavingReply: boolean;
  isCreatingTask: boolean;
  listLanes: InboxApi["listLanes"];
  onCreateReplyDraft: InboxApi["createReplyDraft"];
  onCreateTask: InboxApi["createTask"];
  onOpenDetails: () => void;
  replySaved: boolean;
  taskCreated: boolean;
}) {
  if (!detail && !isLoading && !error)
    return (
      <section className="inbox-conversation inbox-conversation--empty">
        <div>
          <span className="inbox-empty-mark">
            <InboxIcon aria-hidden="true" size={19} />
          </span>
          <h2>Selecione uma conversa</h2>
          <p>Leia e organize suas caixas sem iniciar nenhum agente.</p>
        </div>
      </section>
    );
  return (
    <section className="inbox-conversation" aria-label="Conversa selecionada">
      <header className="inbox-conversation__header">
        <div className="inbox-conversation__heading">
          <p className="inbox-eyebrow">
            {detail?.thread.subject || "Conversa"}
          </p>
          <h2>
            {detail?.thread.participants.map(displayName).join(", ") ||
              "Carregando conversa"}
          </h2>
        </div>
        <Button
          aria-label="Abrir detalhes"
          className="inbox-details-drawer-trigger"
          isIconOnly
          onPress={onOpenDetails}
          size="sm"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" size={16} />
        </Button>
      </header>
      <div className="inbox-conversation__scroll">
        {isLoading && (
          <ListState
            icon={<Spinner size="sm" />}
            text="Carregando mensagens…"
          />
        )}
        {error && (
          <ListState error icon={<CircleAlert size={16} />} text={error} />
        )}
        {detail && (
          <div className="inbox-message-stack">
            {detail.messages.map((message) => (
              <article
                className={`inbox-message inbox-message--${message.direction}`}
                key={message.id}
              >
                <div className="inbox-message__meta">
                  <strong>{displayName(message.sender)}</strong>
                  <time>
                    {shortDate(
                      message.receivedAt ?? message.sentAt ?? message.createdAt,
                      true,
                    )}
                  </time>
                </div>
                <div className="inbox-message__body">{message.body}</div>
                {message.bodyFormat === "html" && (
                  <p className="inbox-untrusted">
                    <ExternalLink aria-hidden="true" size={11} /> Conteúdo HTML
                    exibido como texto
                  </p>
                )}
                {message.attachments.length > 0 && (
                  <div className="inbox-attachments">
                    {message.attachments.map((attachment, index) => (
                      <span key={`${attachment.filename ?? "anexo"}-${index}`}>
                        <Paperclip aria-hidden="true" size={11} />
                        {attachment.filename ?? "Anexo"}
                        {attachment.size
                          ? ` · ${formatBytes(attachment.size)}`
                          : ""}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
      {taskCreated && (
        <p className="inbox-task-created" role="status">
          Tarefa criada no Kanban. Nenhum agente foi iniciado.
        </p>
      )}
      {replySaved && (
        <p className="inbox-reply-saved" role="status">
          Resposta salva para aprovação. Nenhum email foi enviado.
        </p>
      )}
      <FutureActions
        detail={detail}
        isCreatingTask={isCreatingTask}
        isSavingReply={isSavingReply}
        listLanes={listLanes}
        onCreateReplyDraft={onCreateReplyDraft}
        onCreateTask={onCreateTask}
        thread={detail?.thread}
      />
    </section>
  );
}

function FutureActions({
  detail,
  isCreatingTask,
  isSavingReply,
  listLanes,
  onCreateReplyDraft,
  onCreateTask,
  thread,
}: {
  detail: InboxThreadDetail | undefined;
  isCreatingTask: boolean;
  isSavingReply: boolean;
  listLanes: InboxApi["listLanes"];
  onCreateReplyDraft: InboxApi["createReplyDraft"];
  onCreateTask: InboxApi["createTask"];
  thread: InboxThread | undefined;
}) {
  const actions = [{ label: "Pedir rascunho", icon: <Sparkles size={14} /> }];
  return (
    <footer className="inbox-future-actions">
      <InboxTaskModal
        isCreating={isCreatingTask}
        listLanes={listLanes}
        onCreateTask={onCreateTask}
        thread={thread}
      />
      <InboxReplyModal
        detail={detail}
        isSaving={isSavingReply}
        onCreateReplyDraft={onCreateReplyDraft}
      />
      {actions.map((action) => (
        <Tooltip.Root closeDelay={0} delay={250} key={action.label}>
          <Button
            aria-label={action.label}
            className="inbox-future-action"
            isDisabled
            size="sm"
            variant="ghost"
          >
            {action.icon}
            {action.label}
          </Button>
          <Tooltip.Content className="ok-tooltip" placement="top">
            Em breve
          </Tooltip.Content>
        </Tooltip.Root>
      ))}
    </footer>
  );
}

function InboxDetails({
  account,
  thread,
}: {
  account: InboxAccount | undefined;
  thread: InboxThread | undefined;
}) {
  if (!thread)
    return (
      <div className="inbox-details-empty">
        <Tag aria-hidden="true" size={18} />
        <p>Detalhes aparecem ao abrir uma conversa.</p>
      </div>
    );
  return (
    <div className="inbox-details">
      <header>
        <p className="inbox-eyebrow">Detalhes</p>
        <h2>{thread.subject || "Sem assunto"}</h2>
      </header>
      <DetailsGroup
        title="Conversa"
        rows={[
          [
            "Status",
            thread.unreadCount > 0
              ? `${thread.unreadCount} não lida${thread.unreadCount > 1 ? "s" : ""}`
              : "Lida",
          ],
          ["Conta", account?.account.displayName ?? "Conta removida"],
          ["Data", shortDate(thread.lastMessageAt, true)],
        ]}
      />
      <DetailsGroup
        title="Participantes"
        rows={thread.participants.map((participant) => ["", participant])}
      />
      <DetailsGroup
        title="Labels"
        rows={
          thread.labels.length
            ? thread.labels.map((label) => ["", label])
            : [["", "Sem labels"]]
        }
      />
      <DetailsGroup
        title="Origem"
        rows={[
          ["Conteúdo", "externo e não confiável"],
          ["Thread", thread.externalThreadId],
        ]}
      />
    </div>
  );
}

function DetailsGroup({
  rows,
  title,
}: {
  rows: Array<[string, string]>;
  title: string;
}) {
  return (
    <section className="inbox-details-group">
      <h3>{title}</h3>
      {rows.map(([label, value], index) => (
        <div key={`${label}-${value}-${index}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </section>
  );
}

function DetailsDrawer({
  account,
  state,
  thread,
}: {
  account: InboxAccount | undefined;
  state: ReturnType<typeof useOverlayState>;
  thread: InboxThread | undefined;
}) {
  return (
    <Drawer.Root state={state}>
      <Drawer.Backdrop className="inbox-details-backdrop">
        <Drawer.Content className="inbox-details-drawer" placement="right">
          <Drawer.Dialog className="inbox-details-drawer__dialog">
            <Drawer.Header className="inbox-details-drawer__header">
              <Drawer.Heading className="inbox-details-drawer__heading">
                Detalhes
              </Drawer.Heading>
              <Drawer.CloseTrigger
                aria-label="Fechar detalhes"
                className="inbox-details-drawer__close"
              />
            </Drawer.Header>
            <Drawer.Body className="inbox-details-drawer__body">
              <InboxDetails account={account} thread={thread} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  );
}

function accountForThread(
  accounts: InboxAccount[],
  thread: InboxThread | undefined,
) {
  return accounts.find((entry) => entry.account.id === thread?.accountId);
}
function threadById(threads: InboxThread[] | undefined, id: string | null) {
  return threads?.find((thread) => thread.id === id);
}
function primaryParticipant(thread: InboxThread) {
  return displayName(thread.participants[0] ?? "Remetente externo");
}
function displayName(value: string) {
  return value.replace(/\s*<[^>]+>/, "") || value;
}
function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}
function shortDate(value: string, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(
    "pt-BR",
    includeTime
      ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short" },
  ).format(date);
}
function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : `${Math.round(value / 1024)} KB`;
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível carregar esta área.";
}
function MailPlusIcon() {
  return <Mail aria-hidden="true" size={17} />;
}
