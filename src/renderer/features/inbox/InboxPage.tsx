import {
  AlertDialog,
  Badge,
  Button,
  Drawer,
  Spinner,
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
  Send,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { InboxAccountModal } from "./InboxAccountModal";
import { InboxOutgoingSettingsModal } from "./InboxOutgoingSettingsModal";
import { InboxReplyApprovalCard } from "./InboxReplyApprovalCard";
import { InboxAgentReplyModal } from "./InboxAgentReplyModal";
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
  listModels(): Promise<IpcResponse<"models:list">>;
  generateReplyDraft(
    request: IpcRequest<"inbox:thread:generateReplyDraft">,
  ): Promise<IpcResponse<"inbox:thread:generateReplyDraft">>;
  listReplyActions(
    request: IpcRequest<"inbox:thread:replyActions:list">,
  ): Promise<IpcResponse<"inbox:thread:replyActions:list">>;
  approveReply(
    request: IpcRequest<"inbox:reply:approveAndSend">,
  ): Promise<IpcResponse<"inbox:reply:approveAndSend">>;
  discardReply(
    request: IpcRequest<"inbox:reply:discard">,
  ): Promise<IpcResponse<"inbox:reply:discard">>;
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
  listModels: workbenchClient.modelsList,
  generateReplyDraft: workbenchClient.inboxThreadGenerateReplyDraft,
  listReplyActions: workbenchClient.inboxThreadReplyActionsList,
  approveReply: workbenchClient.inboxReplyApproveAndSend,
  discardReply: workbenchClient.inboxReplyDiscard,
};

type AccountFilter = "all" | "unread" | string;

export function InboxPage({ api = defaultApi }: { api?: InboxApi }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [taskCreatedForThreadId, setTaskCreatedForThreadId] = useState<
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
  const replyActions = useQuery({
    queryKey: ["inbox", "reply-actions", selectedThreadId],
    queryFn: () => api.listReplyActions({ threadId: selectedThreadId! }),
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
      const queryKey = ["inbox", "reply-actions", result.sourceThreadId];
      queryClient.setQueryData<IpcResponse<"inbox:thread:replyActions:list">>(
        queryKey,
        (current = []) => [replyActionFromDraft(result), ...current],
      );
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const generateReplyDraft = useMutation({
    mutationFn: api.generateReplyDraft,
    onSuccess: async (result) => {
      const queryKey = ["inbox", "reply-actions", result.sourceThreadId];
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<IpcResponse<"inbox:thread:replyActions:list">>(
        queryKey,
        (current = []) => [replyActionFromDraft(result), ...current],
      );
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    },
  });
  const approveReply = useMutation({
    mutationFn: ({ outboxId }: { outboxId: string; threadId: string }) =>
      api.approveReply({ outboxId, confirmation: "approve_and_send" }),
    onSuccess: (result, variables) => {
      const queryKey = ["inbox", "reply-actions", variables.threadId];
      queryClient.setQueryData<IpcResponse<"inbox:thread:replyActions:list">>(
        queryKey,
        (current = []) =>
          current.map((action) =>
            action.id === result.id
              ? {
                  ...action,
                  status: result.status,
                  attempts: result.attempts,
                  approvedAt: result.approvedAt,
                  lastError: result.lastError,
                }
              : action,
          ),
      );
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const discardReply = useMutation({
    mutationFn: ({
      outboxId,
      threadId,
    }: {
      outboxId: string;
      threadId: string;
    }) =>
      api.discardReply({
        outboxId,
        threadId,
        confirmation: "discard_unsent_draft",
      }),
    onSuccess: (result) => {
      const queryKey = ["inbox", "reply-actions", result.sourceThreadId];
      queryClient.setQueryData<IpcResponse<"inbox:thread:replyActions:list">>(
        queryKey,
        (current = []) =>
          current.filter((action) => action.id !== result.outboxId),
      );
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
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
        isGeneratingReply={generateReplyDraft.isPending}
        isLoading={detail.isLoading}
        isCreatingTask={createTask.isPending}
        replyActions={replyActions.data ?? []}
        replyActionsError={
          replyActions.isError ? errorMessage(replyActions.error) : null
        }
        onApproveReply={(outboxId, actionThreadId) =>
          approveReply.mutateAsync({ outboxId, threadId: actionThreadId })
        }
        onDiscardReply={(outboxId, actionThreadId) =>
          discardReply.mutateAsync({ outboxId, threadId: actionThreadId })
        }
        onCreateReplyDraft={(request) => createReplyDraft.mutateAsync(request)}
        onGenerateReplyDraft={(request) =>
          generateReplyDraft.mutateAsync(request)
        }
        onOpenDetails={detailsDrawer.open}
        onCreateTask={(request) => createTask.mutateAsync(request)}
        taskCreated={taskCreatedForThreadId === detail.data?.thread.id}
        listLanes={api.listLanes}
        listModels={api.listModels}
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

function replyActionFromDraft(
  draft: IpcResponse<"inbox:thread:createReplyDraft">,
): IpcResponse<"inbox:thread:replyActions:list">[number] {
  return {
    ...draft,
    approvedAt: null,
    lastError: null,
  };
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
            data-unread={thread.unreadCount > 0 || undefined}
            key={thread.id}
            onClick={() => onSelect(thread)}
            type="button"
          >
            <span
              className="inbox-thread-avatar"
              data-tone={participantTone(primaryParticipant(thread))}
            >
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
  isGeneratingReply,
  isCreatingTask,
  listLanes,
  listModels,
  onApproveReply,
  onDiscardReply,
  onCreateReplyDraft,
  onGenerateReplyDraft,
  onCreateTask,
  onOpenDetails,
  replyActions,
  replyActionsError,
  taskCreated,
}: {
  detail: InboxThreadDetail | undefined;
  error: string | null;
  isLoading: boolean;
  isSavingReply: boolean;
  isGeneratingReply: boolean;
  isCreatingTask: boolean;
  listLanes: InboxApi["listLanes"];
  listModels: InboxApi["listModels"];
  onApproveReply: (
    outboxId: string,
    threadId: string,
  ) => Promise<IpcResponse<"inbox:reply:approveAndSend">>;
  onDiscardReply: (
    outboxId: string,
    threadId: string,
  ) => Promise<IpcResponse<"inbox:reply:discard">>;
  onCreateReplyDraft: InboxApi["createReplyDraft"];
  onGenerateReplyDraft: InboxApi["generateReplyDraft"];
  onCreateTask: InboxApi["createTask"];
  onOpenDetails: () => void;
  replyActions: IpcResponse<"inbox:thread:replyActions:list">;
  replyActionsError: string | null;
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
        <footer className="inbox-future-actions">
          <InboxAgentReplyModal
            isGenerating={isGeneratingReply}
            listModels={listModels}
            onGenerate={onGenerateReplyDraft}
            thread={undefined}
          />
        </footer>
      </section>
    );
  return (
    <section className="inbox-conversation" aria-label="Conversa selecionada">
      <header className="inbox-conversation__header">
        <div className="inbox-conversation__heading">
          <p className="inbox-conversation__participant">
            {detail?.thread.participants.map(displayName).join(", ") ||
              "Carregando conversa"}
          </p>
          <h2>{detail?.thread.subject || "(sem assunto)"}</h2>
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
                <header className="inbox-message__meta">
                  <span
                    className="inbox-message__avatar"
                    data-tone={participantTone(displayName(message.sender))}
                  >
                    {initials(displayName(message.sender))}
                  </span>
                  <span className="inbox-message__sender">
                    <strong>{displayName(message.sender)}</strong>
                    <small>{directionLabel(message.direction)}</small>
                  </span>
                  <time>
                    {shortDate(
                      message.receivedAt ?? message.sentAt ?? message.createdAt,
                      true,
                    )}
                  </time>
                </header>
                <div className="inbox-message__body">
                  {readableMessageBody(message.body, message.bodyFormat)}
                </div>
                {message.bodyFormat === "html" && (
                  <p className="inbox-untrusted">
                    <ExternalLink aria-hidden="true" size={11} /> Conteúdo
                    convertido para leitura segura
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
            {replyActions
              .filter((action) => action.sourceThreadId === detail.thread.id)
              .slice(0, 1)
              .map((action) => (
                <InboxReplyApprovalCard
                  action={action}
                  key={action.id}
                  onApprove={(outboxId) =>
                    onApproveReply(outboxId, action.sourceThreadId)
                  }
                  onDiscard={(outboxId) =>
                    onDiscardReply(outboxId, action.sourceThreadId)
                  }
                />
              ))}
            {replyActionsError && (
              <p className="inbox-reply-actions-error" role="alert">
                {replyActionsError}
              </p>
            )}
          </div>
        )}
      </div>
      {taskCreated && (
        <p className="inbox-task-created" role="status">
          Tarefa criada no Kanban. Nenhum agente foi iniciado.
        </p>
      )}
      <FutureActions
        detail={detail}
        isCreatingTask={isCreatingTask}
        isGeneratingReply={isGeneratingReply}
        isSavingReply={isSavingReply}
        listLanes={listLanes}
        listModels={listModels}
        onCreateReplyDraft={onCreateReplyDraft}
        onGenerateReplyDraft={onGenerateReplyDraft}
        onCreateTask={onCreateTask}
        thread={detail?.thread}
      />
    </section>
  );
}

function FutureActions({
  detail,
  isCreatingTask,
  isGeneratingReply,
  isSavingReply,
  listLanes,
  listModels,
  onCreateReplyDraft,
  onGenerateReplyDraft,
  onCreateTask,
  thread,
}: {
  detail: InboxThreadDetail | undefined;
  isCreatingTask: boolean;
  isGeneratingReply: boolean;
  isSavingReply: boolean;
  listLanes: InboxApi["listLanes"];
  listModels: InboxApi["listModels"];
  onCreateReplyDraft: InboxApi["createReplyDraft"];
  onGenerateReplyDraft: InboxApi["generateReplyDraft"];
  onCreateTask: InboxApi["createTask"];
  thread: InboxThread | undefined;
}) {
  return (
    <footer className="inbox-future-actions">
      <div className="inbox-action-dock__intro">
        <span className="inbox-action-dock__mark">
          <Send aria-hidden="true" size={15} />
        </span>
        <span>
          <strong>Próximo passo</strong>
          <small>Nada é enviado sem sua aprovação.</small>
        </span>
      </div>
      <div className="inbox-action-dock__buttons">
        <InboxTaskModal
          isCreating={isCreatingTask}
          listLanes={listLanes}
          onCreateTask={onCreateTask}
          thread={thread}
        />
        <InboxAgentReplyModal
          isGenerating={isGeneratingReply}
          listModels={listModels}
          onGenerate={onGenerateReplyDraft}
          thread={thread}
        />
        <InboxReplyModal
          detail={detail}
          isSaving={isSavingReply}
          onCreateReplyDraft={onCreateReplyDraft}
        />
      </div>
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
        <p className="inbox-details__subject">
          {thread.subject || "Sem assunto"}
        </p>
      </header>
      <DetailsGroup
        icon={<Mail aria-hidden="true" size={14} />}
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
        icon={<Users aria-hidden="true" size={14} />}
        title="Participantes"
        rows={thread.participants.map((participant) => [
          "",
          participantSummary(participant),
        ])}
      />
      <DetailsGroup
        icon={<Tag aria-hidden="true" size={14} />}
        title="Labels"
        rows={
          thread.labels.length
            ? thread.labels.map((label) => ["", label])
            : [["", "Sem labels"]]
        }
      />
      <DetailsGroup
        icon={<ShieldCheck aria-hidden="true" size={14} />}
        title="Origem"
        rows={[
          ["Conteúdo", "externo e não confiável"],
          ["Thread", compactIdentifier(thread.externalThreadId)],
        ]}
      />
    </div>
  );
}

function DetailsGroup({
  icon,
  rows,
  title,
}: {
  icon: React.ReactNode;
  rows: Array<[string, string]>;
  title: string;
}) {
  return (
    <section className="inbox-details-group">
      <h3>
        {icon}
        {title}
      </h3>
      {rows.map(([label, value], index) => (
        <div data-label={label || undefined} key={`${label}-${value}-${index}`}>
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
function participantTone(value: string) {
  const tones = ["cyan", "orange", "violet", "green", "pink"] as const;
  const hash = [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[hash % tones.length];
}
function directionLabel(direction: string) {
  if (direction === "outgoing") return "Enviado por você";
  if (direction === "draft") return "Rascunho";
  return "Recebido";
}
function participantSummary(value: string) {
  const email = value.match(/<([^>]+)>/u)?.[1];
  return email ? `${displayName(value)}\n${email}` : value;
}
function compactIdentifier(value: string) {
  return value.length > 26 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}
function readableMessageBody(body: string, format: string) {
  const safe = format === "html" ? stripHtml(body) : body;
  const lines = safe.replace(/\r\n?/gu, "\n").split("\n");
  let hiddenLink = false;
  const readable = lines.flatMap((line) => {
    const candidate = line.trim().replace(/^\[|\]$/gu, "");
    if (/^https?:\/\/\S{120,}$/iu.test(candidate)) {
      if (hiddenLink) return [];
      hiddenLink = true;
      return ["[Link técnico ocultado para facilitar a leitura]"];
    }
    return [line];
  });
  return readable
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
function stripHtml(value: string) {
  return value
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/p\s*>/giu, "\n\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
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
