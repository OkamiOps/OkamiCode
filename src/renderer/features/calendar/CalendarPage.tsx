import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  MapPin,
  Plus,
  Radio,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";

type CalendarSource = IpcResponse<"calendar:sources:list">[number];
type CalendarEvent = IpcResponse<"calendar:events:list">[number];

export interface CalendarApi {
  listSources(): Promise<IpcResponse<"calendar:sources:list">>;
  createSource(
    request: IpcRequest<"calendar:source:createLocal">,
  ): Promise<IpcResponse<"calendar:source:createLocal">>;
  listEvents(
    request: IpcRequest<"calendar:events:list">,
  ): Promise<IpcResponse<"calendar:events:list">>;
  createEvent(
    request: IpcRequest<"calendar:event:createLocal">,
  ): Promise<IpcResponse<"calendar:event:createLocal">>;
}

const defaultApi: CalendarApi = {
  listSources: workbenchClient.calendarSourcesList,
  createSource: workbenchClient.calendarSourceCreateLocal,
  listEvents: workbenchClient.calendarEventsList,
  createEvent: workbenchClient.calendarEventCreateLocal,
};

const remoteSources = ["Google", "Outlook", "CalDAV", "ICS"] as const;

export function CalendarPage({
  api = defaultApi,
  displayTimezone = defaultTimezone(),
}: {
  api?: CalendarApi;
  displayTimezone?: string;
}) {
  const queryClient = useQueryClient();
  const sourceModal = useOverlayState();
  const eventModal = useOverlayState();
  const [weekAnchor, setWeekAnchor] = useState(() =>
    startOfWeekDate(dateInTimezone(new Date(), displayTimezone)),
  );
  const [sourceFilter, setSourceFilter] = useState<Set<string> | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceColor, setSourceColor] = useState("#FF7A1A");
  const [sourceTimezone, setSourceTimezone] = useState(defaultTimezone);
  const [eventTitle, setEventTitle] = useState("");
  const [eventSourceId, setEventSourceId] = useState("");
  const [eventTimezone, setEventTimezone] = useState(defaultTimezone);
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(() =>
    dateInTimezone(new Date(), displayTimezone),
  );
  const [endDate, setEndDate] = useState(() =>
    dateInTimezone(new Date(), displayTimezone),
  );
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [eventInputError, setEventInputError] = useState<string | null>(null);

  const week = useMemo(
    () => weekBounds(weekAnchor, displayTimezone),
    [displayTimezone, weekAnchor],
  );
  const sources = useQuery({
    queryKey: ["calendar", "sources"],
    queryFn: api.listSources,
  });
  const localSources = useMemo(
    () =>
      (sources.data ?? []).filter(
        (source) => source.kind === "local" && source.status === "active",
      ),
    [sources.data],
  );
  const localSourceIds = useMemo(
    () => localSources.map((source) => source.id),
    [localSources],
  );
  const events = useQuery({
    queryKey: [
      "calendar",
      "events",
      week.startDate,
      week.endDate,
      localSourceIds,
    ],
    enabled: sources.isSuccess && localSourceIds.length > 0,
    queryFn: () =>
      api.listEvents({
        sourceIds: localSourceIds,
        startsAt: week.startsAt,
        endsAt: week.endsAt,
        startDate: week.startDate,
        endDate: week.endDate,
      }),
  });
  const visibleEvents = useMemo(() => {
    const localSourceIdSet = new Set(localSourceIds);
    const visibleSourceIds = sourceFilter;
    return (events.data ?? []).filter(
      (event) =>
        localSourceIdSet.has(event.sourceId) &&
        (!visibleSourceIds || visibleSourceIds.has(event.sourceId)),
    );
  }, [events.data, localSourceIds, sourceFilter]);
  const selectedEvent = visibleEvents.find(
    (event) => event.id === selectedEventId,
  );
  const sourceById = useMemo(
    () => new Map(localSources.map((source) => [source.id, source])),
    [localSources],
  );

  const refreshSources = () =>
    queryClient.invalidateQueries({ queryKey: ["calendar", "sources"] });
  const refreshEvents = () =>
    queryClient.invalidateQueries({ queryKey: ["calendar", "events"] });
  const createSource = useMutation({
    mutationFn: (request: IpcRequest<"calendar:source:createLocal">) =>
      api.createSource(request),
    onSuccess: () => {
      sourceModal.close();
      setSourceName("");
      void refreshSources();
    },
  });
  const createEvent = useMutation({
    mutationFn: (request: IpcRequest<"calendar:event:createLocal">) =>
      api.createEvent(request),
    onSuccess: () => {
      eventModal.close();
      setEventTitle("");
      void refreshEvents();
    },
  });

  function toggleSource(sourceId: string) {
    const selected = new Set(
      sourceFilter ?? (sources.data ?? []).map((source) => source.id),
    );
    if (selected.has(sourceId)) selected.delete(sourceId);
    else selected.add(sourceId);
    setSourceFilter(selected);
  }

  function submitSource(event: FormEvent) {
    event.preventDefault();
    if (!sourceName.trim()) return;
    createSource.mutate({
      displayName: sourceName.trim(),
      color: sourceColor.trim(),
      timezone: sourceTimezone.trim(),
    });
  }

  function openEventModal() {
    if (!eventSourceId && localSources[0]) {
      setEventSourceId(localSources[0].id);
      setEventTimezone(localSources[0].timezone);
    }
    setEventInputError(null);
    eventModal.open();
  }

  function submitEvent(event: FormEvent) {
    event.preventDefault();
    if (!eventTitle.trim() || !eventSourceId) return;
    if (allDay) {
      createEvent.mutate({
        sourceId: eventSourceId,
        title: eventTitle.trim(),
        timezone: eventTimezone.trim(),
        allDay: true,
        startDate,
        endDate,
      });
      return;
    }
    try {
      const timezone = eventTimezone.trim();
      const startsAt = zonedDateTimeToIso(startDate, startTime, timezone);
      const endsAt = zonedDateTimeToIso(endDate, endTime, timezone);
      if (endsAt <= startsAt) throw new Error("invalid event range");
      setEventInputError(null);
      createEvent.mutate({
        sourceId: eventSourceId,
        title: eventTitle.trim(),
        timezone,
        allDay: false,
        startsAt,
        endsAt,
      });
    } catch {
      setEventInputError(
        "Data ou horário inválido para o fuso horário escolhido.",
      );
    }
  }

  return (
    <section aria-label="Agenda" className="calendar-page">
      <aside className="calendar-sources" aria-label="Agendas e filtros">
        <header className="calendar-sources__header">
          <div>
            <span className="calendar-eyebrow">CALENDÁRIOS</span>
            <h1>Agenda</h1>
          </div>
          <Button
            aria-label="Nova agenda"
            className="calendar-icon-action"
            isIconOnly
            onPress={sourceModal.open}
            variant="ghost"
          >
            <Plus aria-hidden="true" size={17} />
          </Button>
        </header>
        <div className="calendar-sources__scroll">
          {sources.isLoading && <State label="Carregando agendas locais…" />}
          {sources.isError && (
            <p
              aria-label="Erro ao carregar agendas"
              className="calendar-state"
              role="alert"
            >
              Não foi possível carregar as agendas locais.
            </p>
          )}
          {!sources.isLoading &&
            !sources.isError &&
            localSources.length === 0 && (
              <State label="Nenhuma agenda local criada ainda." />
            )}
          <div className="calendar-source-list">
            {localSources.map((source) => {
              const active = !sourceFilter || sourceFilter.has(source.id);
              return (
                <button
                  aria-pressed={active}
                  className="calendar-source-row"
                  data-active={active}
                  key={source.id}
                  onClick={() => toggleSource(source.id)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="calendar-source-row__dot"
                    style={{ backgroundColor: source.color }}
                  />
                  <span>{source.displayName}</span>
                  {active && <Check aria-hidden="true" size={14} />}
                </button>
              );
            })}
          </div>
          <section className="calendar-remote" aria-label="Provedores remotos">
            <span className="calendar-eyebrow">REMOTOS</span>
            {remoteSources.map((source) => (
              <p key={source}>{source} · não configurado</p>
            ))}
          </section>
        </div>
      </aside>

      <main className="calendar-main">
        <header className="calendar-toolbar">
          <div className="calendar-toolbar__week">
            <Button
              aria-label="Semana anterior"
              className="calendar-icon-action"
              isIconOnly
              onPress={() => setWeekAnchor(addDateDays(weekAnchor, -7))}
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={17} />
            </Button>
            <Button
              aria-label="Hoje"
              className="calendar-today"
              onPress={() =>
                setWeekAnchor(
                  startOfWeekDate(dateInTimezone(new Date(), displayTimezone)),
                )
              }
              variant="ghost"
            >
              Hoje
            </Button>
            <Button
              aria-label="Próxima semana"
              className="calendar-icon-action"
              isIconOnly
              onPress={() => setWeekAnchor(addDateDays(weekAnchor, 7))}
              variant="ghost"
            >
              <ArrowRight aria-hidden="true" size={17} />
            </Button>
            <span className="calendar-week-label">{week.label}</span>
          </div>
          <Button className="calendar-primary-action" onPress={openEventModal}>
            <Plus aria-hidden="true" size={16} />
            Novo evento
          </Button>
        </header>

        {events.isError && (
          <p
            aria-label="Erro ao carregar eventos"
            className="calendar-state"
            role="alert"
          >
            Não foi possível carregar os eventos locais.
          </p>
        )}
        {events.isLoading ? (
          <State label="Carregando semana…" />
        ) : (
          <div className="calendar-week" aria-label="Semana selecionada">
            {week.days.map((day) => {
              const dayEvents = visibleEvents.filter((event) =>
                occursOn(event, day, displayTimezone),
              );
              const isToday =
                day === dateInTimezone(new Date(), displayTimezone);
              return (
                <section
                  aria-label={`Agenda de ${weekdayLabel(day, displayTimezone)} ${day.slice(-2)}`}
                  className="calendar-day"
                  data-today={isToday}
                  key={day}
                >
                  <header className="calendar-day__header">
                    <span>{weekdayLabel(day, displayTimezone)}</span>
                    <strong>{day.slice(-2)}</strong>
                  </header>
                  {isToday && (
                    <span
                      aria-hidden="true"
                      className="calendar-day__filament"
                    />
                  )}
                  <div className="calendar-day__events">
                    {dayEvents.map((event) => (
                      <button
                        aria-label={`${event.title}, ${event.allDay ? "dia inteiro" : timeRange(event, displayTimezone)}`}
                        className={`calendar-event calendar-event--${event.allDay ? "all-day" : "timed"}`}
                        data-selected={event.id === selectedEventId}
                        key={event.id}
                        onClick={() => setSelectedEventId(event.id)}
                        style={
                          {
                            "--event-color":
                              sourceById.get(event.sourceId)?.color ??
                              "#68DDEB",
                          } as React.CSSProperties
                        }
                        type="button"
                      >
                        <span>
                          {event.allDay
                            ? "Dia inteiro"
                            : timeRange(event, displayTimezone)}
                        </span>
                        <strong>{event.title}</strong>
                      </button>
                    ))}
                    {dayEvents.length === 0 && (
                      <span className="calendar-day__empty">—</span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {!events.isLoading && !events.isError && visibleEvents.length === 0 && (
          <p className="calendar-empty-week">Nenhum evento nesta semana.</p>
        )}
      </main>

      <aside
        className="calendar-inspector calendar-inspector--drawer"
        aria-label="Detalhes do evento"
      >
        {selectedEvent ? (
          <EventInspector
            event={selectedEvent}
            source={sourceById.get(selectedEvent.sourceId)}
          />
        ) : (
          <div className="calendar-inspector__empty">
            <CalendarDays aria-hidden="true" size={22} />
            <strong>Selecione um evento</strong>
            <span>Os detalhes ficam aqui sem tirar você da semana.</span>
          </div>
        )}
      </aside>

      <SourceModal
        color={sourceColor}
        error={createSource.isError}
        name={sourceName}
        onColorChange={setSourceColor}
        onNameChange={setSourceName}
        onSubmit={submitSource}
        onTimezoneChange={setSourceTimezone}
        state={sourceModal}
        timezone={sourceTimezone}
      />
      <EventModal
        allDay={allDay}
        endDate={endDate}
        endTime={endTime}
        error={createEvent.isError || Boolean(eventInputError)}
        errorMessage={
          eventInputError ?? "Não foi possível criar o evento local."
        }
        onAllDayChange={(value) => {
          setAllDay(value);
          setEventInputError(null);
        }}
        onEndDateChange={setEndDate}
        onEndTimeChange={setEndTime}
        onSourceChange={(value) => {
          setEventSourceId(value);
          const source = sourceById.get(value);
          if (source) setEventTimezone(source.timezone);
        }}
        onStartDateChange={setStartDate}
        onStartTimeChange={setStartTime}
        onSubmit={submitEvent}
        onTimezoneChange={setEventTimezone}
        onTitleChange={setEventTitle}
        sourceId={eventSourceId}
        sources={localSources}
        startDate={startDate}
        startTime={startTime}
        state={eventModal}
        timezone={eventTimezone}
        title={eventTitle}
      />
    </section>
  );
}

function State({ label }: { label: string }) {
  return (
    <p className="calendar-state">
      <Spinner aria-label={label} size="sm" />
      {label}
    </p>
  );
}

function EventInspector({
  event,
  source,
}: {
  event: CalendarEvent;
  source?: CalendarSource;
}) {
  return (
    <div className="calendar-inspector__content">
      <span className="calendar-eyebrow">DETALHES</span>
      <h2>{event.title}</h2>
      <p className="calendar-inspector__status">{event.status}</p>
      <dl>
        <div>
          <dt>
            <Clock3 aria-hidden="true" size={14} /> Quando
          </dt>
          <dd>
            {event.allDay
              ? `${event.startDate} — ${event.endDate}`
              : timeRange(event, event.timezone)}
          </dd>
        </div>
        <div>
          <dt>
            <Radio aria-hidden="true" size={14} /> Fuso horário
          </dt>
          <dd>{event.timezone}</dd>
        </div>
        <div>
          <dt>Agenda</dt>
          <dd>{source?.displayName ?? "Agenda local"}</dd>
        </div>
        {event.location && (
          <div>
            <dt>
              <MapPin aria-hidden="true" size={14} /> Local
            </dt>
            <dd>{event.location}</dd>
          </div>
        )}
      </dl>
      {event.joinUrl && (
        <a
          className="calendar-join-link"
          href={event.joinUrl}
          rel="noreferrer"
          target="_blank"
        >
          Abrir chamada <ExternalLink aria-hidden="true" size={14} />
        </a>
      )}
      {event.description && (
        <p className="calendar-inspector__description">{event.description}</p>
      )}
    </div>
  );
}

function SourceModal({
  state,
  name,
  color,
  timezone,
  error,
  onNameChange,
  onColorChange,
  onTimezoneChange,
  onSubmit,
}: {
  state: ReturnType<typeof useOverlayState>;
  name: string;
  color: string;
  timezone: string;
  error: boolean;
  onNameChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal.Root state={state}>
      <Modal.Backdrop className="calendar-modal-backdrop">
        <Modal.Container className="calendar-modal" placement="center">
          <Modal.Dialog>
            <form onSubmit={onSubmit}>
              <Modal.Header className="calendar-modal__header">
                <div>
                  <Modal.Heading>Nova agenda local</Modal.Heading>
                  <p>Dados guardados apenas neste Mac.</p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar"
                  className="calendar-icon-action"
                >
                  ×
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="calendar-modal__body">
                <label>
                  Nome da agenda
                  <input
                    aria-label="Nome da agenda"
                    onChange={(event) => onNameChange(event.target.value)}
                    value={name}
                  />
                </label>
                <label>
                  Cor da agenda
                  <input
                    aria-label="Cor da agenda"
                    onChange={(event) => onColorChange(event.target.value)}
                    value={color}
                  />
                </label>
                <label>
                  Fuso horário
                  <input
                    aria-label="Fuso horário"
                    onChange={(event) => onTimezoneChange(event.target.value)}
                    value={timezone}
                  />
                </label>
                {error && (
                  <p className="calendar-modal__error" role="alert">
                    Não foi possível criar a agenda local.
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="calendar-modal__footer">
                <Button
                  className="calendar-primary-action"
                  isDisabled={!name.trim()}
                  type="submit"
                >
                  Criar agenda
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function EventModal({
  state,
  sources,
  sourceId,
  title,
  timezone,
  allDay,
  startDate,
  endDate,
  startTime,
  endTime,
  error,
  errorMessage,
  onSourceChange,
  onTitleChange,
  onTimezoneChange,
  onAllDayChange,
  onStartDateChange,
  onEndDateChange,
  onStartTimeChange,
  onEndTimeChange,
  onSubmit,
}: {
  state: ReturnType<typeof useOverlayState>;
  sources: CalendarSource[];
  sourceId: string;
  title: string;
  timezone: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  error: boolean;
  errorMessage: string;
  onSourceChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onAllDayChange: (value: boolean) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal.Root state={state}>
      <Modal.Backdrop className="calendar-modal-backdrop">
        <Modal.Container className="calendar-modal" placement="center">
          <Modal.Dialog>
            <form onSubmit={onSubmit}>
              <Modal.Header className="calendar-modal__header">
                <div>
                  <Modal.Heading>Novo evento</Modal.Heading>
                  <p>Crie um evento na agenda local selecionada.</p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar"
                  className="calendar-icon-action"
                >
                  ×
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="calendar-modal__body">
                <label>
                  Título do evento
                  <input
                    aria-label="Título do evento"
                    onChange={(event) => onTitleChange(event.target.value)}
                    value={title}
                  />
                </label>
                <label>
                  Agenda
                  <select
                    aria-label="Agenda do evento"
                    onChange={(event) => onSourceChange(event.target.value)}
                    value={sourceId}
                  >
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fuso horário
                  <input
                    aria-label="Fuso horário do evento"
                    onChange={(event) => onTimezoneChange(event.target.value)}
                    value={timezone}
                  />
                </label>
                <label className="calendar-modal__checkbox">
                  <input
                    aria-label="Dia inteiro"
                    checked={allDay}
                    onChange={(event) => onAllDayChange(event.target.checked)}
                    type="checkbox"
                  />{" "}
                  Dia inteiro
                </label>
                <div className="calendar-modal__split">
                  <label>
                    Data inicial
                    <input
                      aria-label="Data inicial"
                      onChange={(event) =>
                        onStartDateChange(event.target.value)
                      }
                      type="date"
                      value={startDate}
                    />
                  </label>
                  <label>
                    Data final
                    <input
                      aria-label="Data final"
                      onChange={(event) => onEndDateChange(event.target.value)}
                      type="date"
                      value={endDate}
                    />
                  </label>
                </div>
                {!allDay && (
                  <div className="calendar-modal__split">
                    <label>
                      Hora inicial
                      <input
                        aria-label="Hora inicial"
                        onChange={(event) =>
                          onStartTimeChange(event.target.value)
                        }
                        type="time"
                        value={startTime}
                      />
                    </label>
                    <label>
                      Hora final
                      <input
                        aria-label="Hora final"
                        onChange={(event) =>
                          onEndTimeChange(event.target.value)
                        }
                        type="time"
                        value={endTime}
                      />
                    </label>
                  </div>
                )}
                {error && (
                  <p className="calendar-modal__error" role="alert">
                    {errorMessage}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="calendar-modal__footer">
                <Button
                  className="calendar-primary-action"
                  isDisabled={!title.trim() || !sourceId}
                  type="submit"
                >
                  Salvar evento
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function weekBounds(anchor: string, timezone: string) {
  const start = startOfWeekDate(anchor);
  const end = addDateDays(start, 7);
  const lastDay = addDateDays(start, 6);
  return {
    days: Array.from({ length: 7 }, (_, index) => addDateDays(start, index)),
    startDate: start,
    endDate: end,
    startsAt: zonedDateTimeToIso(start, "00:00", timezone),
    endsAt: zonedDateTimeToIso(end, "00:00", timezone),
    label:
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: timezone,
        day: "2-digit",
        month: "short",
      }).format(new Date(zonedDateTimeToIso(start, "12:00", timezone))) +
      ` — ${new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(zonedDateTimeToIso(lastDay, "12:00", timezone)))}`,
  };
}

function weekdayLabel(day: string, timezone = defaultTimezone()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "short",
  })
    .format(new Date(zonedDateTimeToIso(day, "12:00", timezone)))
    .replace(".", "");
}

function occursOn(event: CalendarEvent, day: string, displayTimezone: string) {
  if (event.allDay) return event.startDate <= day && event.endDate > day;
  return dateInTimezone(new Date(event.startsAt), displayTimezone) === day;
}

function timeRange(
  event: Extract<CalendarEvent, { allDay: false }>,
  displayTimezone: string,
) {
  return `${formatTime(event.startsAt, displayTimezone)} — ${formatTime(event.endsAt, displayTimezone)}`;
}

function startOfWeekDate(day: string) {
  const date = parseDate(day);
  const weekday =
    (Date.UTC(date.year, date.month - 1, date.day) / 86_400_000 + 3) % 7;
  return addDateDays(day, -weekday);
}

function addDateDays(day: string, count: number) {
  const date = parseDate(day);
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + count));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function dateInTimezone(instant: Date, timezone: string) {
  const parts = zonedParts(instant, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function zonedDateTimeToIso(day: string, time: string, timezone: string) {
  const date = parseDate(day);
  const clock = parseTime(time);
  const target = { ...date, ...clock };
  const wallTime = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );
  const candidates = [...timezoneOffsets(day, timezone)]
    .map((offsetMinutes) => new Date(wallTime - offsetMinutes * 60_000))
    .filter((candidate) =>
      sameZonedDateTime(zonedParts(candidate, timezone), target),
    );

  if (candidates.length !== 1) {
    throw new Error("invalid or ambiguous zoned date time");
  }
  return candidates[0].toISOString();
}

function timezoneOffsets(day: string, timezone: string) {
  const date = parseDate(day);
  const center = Date.UTC(date.year, date.month - 1, date.day, 12);
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 1) {
    offsets.add(
      timezoneOffsetMinutes(new Date(center + hour * 3_600_000), timezone),
    );
  }
  return offsets;
}

function timezoneOffsetMinutes(instant: Date, timezone: string) {
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = zoneName?.match(
    /^GMT(?:(?<sign>[+-])(?<hour>\d{1,2})(?::?(?<minute>\d{2}))?)?$/,
  );
  if (!match) throw new Error("unsupported timezone offset");
  const sign = match.groups?.sign === "-" ? -1 : 1;
  return (
    sign *
    (Number(match.groups?.hour ?? 0) * 60 + Number(match.groups?.minute ?? 0))
  );
}

function zonedParts(instant: Date, timezone: string) {
  if (Number.isNaN(instant.getTime())) throw new Error("invalid instant");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value);
  const result = {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
  if (Object.values(result).some(Number.isNaN))
    throw new Error("invalid timezone parts");
  return result;
}

function sameZonedDateTime(
  left: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
  right: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
) {
  return Object.entries(right).every(
    ([key, value]) => left[key as keyof typeof left] === value,
  );
}

function parseDate(value: string) {
  const match = value.match(/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/);
  const date = {
    year: Number(match?.groups?.year),
    month: Number(match?.groups?.month),
    day: Number(match?.groups?.day),
  };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    Object.values(date).some(Number.isNaN) ||
    check.getUTCFullYear() !== date.year ||
    check.getUTCMonth() + 1 !== date.month ||
    check.getUTCDate() !== date.day
  ) {
    throw new Error("invalid date");
  }
  return date;
}

function parseTime(value: string) {
  const match = value.match(/^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/);
  if (!match) throw new Error("invalid time");
  return {
    hour: Number(match.groups?.hour),
    minute: Number(match.groups?.minute),
  };
}
