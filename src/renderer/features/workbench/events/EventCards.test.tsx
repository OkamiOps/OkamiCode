import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CanonicalEvent,
  CanonicalEventKind,
} from "../../../../shared/contracts/event";
import { EventCardRegistry, type EventCardEvent } from "./EventCardRegistry";

const approvalId = "8f9663f5-bf19-4620-8d1c-166c00f50a2e";

afterEach(cleanup);

function event(
  kind: CanonicalEventKind,
  payload: Record<string, unknown>,
): CanonicalEvent {
  return {
    schemaVersion: 1,
    id: `event-${kind}`,
    taskId: "27ee79a7-d3c3-48dd-84c6-cb589a4cb606",
    laneId: "50df72f3-cc11-42d2-87be-c928a9ae2cbf",
    runId: "4d32d86d-3199-4327-9d0c-e283268ed239",
    sequence: 1,
    occurredAt: "2026-07-18T12:00:00.000Z",
    kind,
    nativeEventId: "native-event-1",
    payload,
  };
}

describe("EventCardRegistry", () => {
  it("renders an approval without granting it implicitly", async () => {
    const approvalResolve = vi.fn(async () => undefined);

    render(
      <EventCardRegistry
        event={event("approval_requested", {
          approvalId,
          command: "git push",
          risk: "external",
        })}
        onApprovalResolve={approvalResolve}
      />,
    );

    expect(screen.getByText("git push")).toBeVisible();
    expect(approvalResolve).toHaveBeenCalledTimes(0);
    await userEvent.click(
      screen.getByRole("button", { name: "Permitir uma vez" }),
    );
    expect(approvalResolve).toHaveBeenCalledWith({
      approvalId,
      decision: "allow_once",
    });
  });

  it("denies an approval only after the human clicks deny", async () => {
    const approvalResolve = vi.fn(async () => undefined);

    render(
      <EventCardRegistry
        event={event("approval_requested", {
          approvalId,
          command: "pnpm publish",
        })}
        onApprovalResolve={approvalResolve}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Negar" }));
    expect(approvalResolve).toHaveBeenCalledWith({
      approvalId,
      decision: "deny",
    });
  });

  it("uses the native diff renderer for file changes", () => {
    const { container } = render(
      <EventCardRegistry
        event={event("tool_call_updated", {
          diff: [
            "diff --git a/src/old.ts b/src/old.ts",
            "index 1111111..2222222 100644",
            "--- a/src/old.ts",
            "+++ b/src/old.ts",
            "@@ -1 +1 @@",
            "-export const state = 'old';",
            "+export const state = 'new';",
          ].join("\n"),
        })}
      />,
    );

    expect(container.querySelector(".d2h-wrapper")).not.toBeNull();
    expect(screen.getByText("src/old.ts")).toBeVisible();
  });

  it("shows browser evidence but keeps external opening lease-gated", () => {
    render(
      <EventCardRegistry
        event={event("tool_call_completed", {
          title: "Okami Design System",
          url: "https://okamiops.com/design-system/",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
        })}
      />,
    );

    expect(screen.getByText("Okami Design System")).toBeVisible();
    expect(
      screen.getByText("https://okamiops.com/design-system/"),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Captura de Okami Design System" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Abrir externamente" }),
    ).toBeDisabled();
    expect(screen.getByTitle("requer lease")).toBeInTheDocument();
  });

  it("collapses unknown events and redacts diagnostic secrets", async () => {
    const diagnostic = {
      ...event("tool_call_updated", {}),
      kind: "future_runtime_event",
      payload: {
        apiKey: "sk-live-super-secret",
        nested: { authorization: "Bearer raw-token-value" },
        summary: "unknown but safe",
      },
    } as EventCardEvent;

    render(<EventCardRegistry event={diagnostic} />);

    expect(screen.getByText("Evento não reconhecido")).toBeVisible();
    expect(screen.queryByText(/sk-live-super-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-token-value/)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Evento não reconhecido/ }),
    );
    expect(screen.getByText(/\[redacted\]/)).toBeVisible();
    expect(screen.getByText(/unknown but safe/)).toBeVisible();
  });
});
