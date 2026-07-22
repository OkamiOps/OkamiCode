export interface SelectableLane {
  laneId: string;
  model: string;
  providerAccountLabel: string;
  runtimeKind: string;
  workspacePath: string | null;
}

export interface LaneSelectionOption {
  id: string;
  label: string;
}

export function realWorkspaceLanes<T extends SelectableLane>(lanes: T[]): T[] {
  return lanes.filter(
    (lane) =>
      lane.workspacePath !== null &&
      !/(?:^|\/)okami-inbox-(?:analysis|reply)-/u.test(lane.workspacePath),
  );
}

export function providerOptions(
  lanes: SelectableLane[],
): LaneSelectionOption[] {
  return uniqueOptions(
    lanes.map((lane) => ({
      id: providerId(lane),
      label: lane.providerAccountLabel,
    })),
  );
}

export function modelOptions(
  lanes: SelectableLane[],
  selectedProvider: string,
): LaneSelectionOption[] {
  return uniqueOptions(
    lanes
      .filter((lane) => providerId(lane) === selectedProvider)
      .map((lane) => ({ id: lane.model, label: lane.model })),
  );
}

export function workspaceOptions(
  lanes: SelectableLane[],
  selectedProvider: string,
  selectedModel: string,
): LaneSelectionOption[] {
  return uniqueOptions(
    lanes
      .filter(
        (lane) =>
          providerId(lane) === selectedProvider &&
          lane.model === selectedModel &&
          lane.workspacePath,
      )
      .map((lane) => ({
        id: lane.workspacePath!,
        label: workspaceLabel(lane.workspacePath!),
      })),
  );
}

export function resolveLane(
  lanes: SelectableLane[],
  selectedProvider: string,
  selectedModel: string,
  selectedWorkspace: string,
): SelectableLane | null {
  return (
    lanes.find(
      (lane) =>
        providerId(lane) === selectedProvider &&
        lane.model === selectedModel &&
        lane.workspacePath === selectedWorkspace,
    ) ?? null
  );
}

function providerId(lane: SelectableLane): string {
  return `${lane.runtimeKind}:${lane.providerAccountLabel}`;
}

function workspaceLabel(workspacePath: string): string {
  const parts = workspacePath.split("/").filter(Boolean);
  const folder = parts.at(-1) ?? workspacePath;
  return `${folder} · ${workspacePath}`;
}

function uniqueOptions(options: LaneSelectionOption[]): LaneSelectionOption[] {
  return [
    ...new Map(options.map((option) => [option.id, option])).values(),
  ].sort((left, right) => left.label.localeCompare(right.label));
}
