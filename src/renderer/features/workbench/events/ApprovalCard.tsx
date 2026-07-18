import { Button, Card, Chip } from "@heroui/react";
import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import type { IpcRequest } from "../../../../shared/contracts/ipc";
import type { EventCardEvent } from "./EventCardRegistry";

export type ApprovalResolveRequest = IpcRequest<"approval:resolve">;
export type ApprovalResolver = (
  request: ApprovalResolveRequest,
) => Promise<unknown> | unknown;

interface ApprovalCardProps {
  event: EventCardEvent;
  onResolve: ApprovalResolver;
}

function nestedText(
  value: unknown,
  keys: readonly string[],
  seen = new WeakSet<object>(),
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  for (const nested of Object.values(record)) {
    const result = nestedText(nested, keys, seen);
    if (result) return result;
  }
  return undefined;
}

export function ApprovalCard({ event, onResolve }: ApprovalCardProps) {
  const approvalId = nestedText(event.payload, ["approvalId"]);
  const command =
    nestedText(event.payload, ["command", "resource", "reason"]) ??
    "Ação privilegiada";
  const risk = nestedText(event.payload, ["risk"]) ?? "não informado";
  const alreadyResolved = event.kind === "approval_resolved";
  const [resolution, setResolution] = useState<"allow_once" | "deny" | null>(
    alreadyResolved ? "deny" : null,
  );
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(decision: "allow_once" | "deny") {
    if (!approvalId || alreadyResolved || isResolving || resolution) return;
    setIsResolving(true);
    setError(null);
    try {
      await onResolve({ approvalId, decision });
      setResolution(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao resolver");
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <Card className="rounded-[var(--ok-radius-md)] border border-[color-mix(in_srgb,var(--ok-yellow)_36%,var(--ok-border))] border-l-2 border-l-[var(--ok-yellow)] bg-[var(--ok-surface-1)]">
      <Card.Header className="flex items-start gap-2 px-3 py-2.5">
        <ShieldAlert
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[var(--ok-yellow)]"
          size={16}
        />
        <div className="min-w-0 flex-1">
          <Card.Title className="text-xs font-semibold">
            Aprovação humana necessária
          </Card.Title>
          <code className="mt-1.5 block overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--ok-text)]">
            {command}
          </code>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip
              className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[10px] text-[var(--ok-yellow)]"
              size="sm"
              variant="secondary"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mr-1 inline"
                size={10}
              />
              risco: {risk}
            </Chip>
            {!alreadyResolved && !resolution && (
              <>
                <Button
                  className="h-7 bg-[var(--ok-orange)] px-2.5 text-[10px] font-semibold text-black"
                  isDisabled={!approvalId || isResolving}
                  size="sm"
                  onPress={() => void resolve("allow_once")}
                >
                  <Check aria-hidden="true" size={12} />
                  Permitir uma vez
                </Button>
                <Button
                  className="h-7 border border-[var(--ok-border)] bg-[var(--ok-surface-2)] px-2.5 text-[10px] text-[var(--ok-text)]"
                  isDisabled={!approvalId || isResolving}
                  size="sm"
                  variant="secondary"
                  onPress={() => void resolve("deny")}
                >
                  <X aria-hidden="true" size={12} />
                  Negar
                </Button>
              </>
            )}
            {(alreadyResolved || resolution) && (
              <span className="text-[10px] text-[var(--ok-text-muted)]">
                {resolution === "allow_once"
                  ? "Permitido uma vez"
                  : "Resolvido"}
              </span>
            )}
          </div>
          {error && (
            <p className="mt-2 text-[10px] text-[var(--ok-red)]" role="alert">
              Não foi possível resolver: {error}
            </p>
          )}
        </div>
      </Card.Header>
    </Card>
  );
}
