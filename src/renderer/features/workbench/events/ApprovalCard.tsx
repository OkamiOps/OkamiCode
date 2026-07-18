import { Button, Card } from "@heroui/react";
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
    <Card className="approval-card">
      <Card.Header className="approval-card__content">
        <ShieldAlert
          aria-hidden="true"
          className="approval-card__icon"
          size={16}
        />
        <div className="approval-card__body">
          <Card.Title className="approval-card__title">
            Aprovação necessária · ação externa
          </Card.Title>
          <p className="approval-card__description">
            Esta ação exige confirmação humana · risco: {risk}
          </p>
          <code className="approval-card__command">{command}</code>
          <div className="approval-card__actions">
            {!alreadyResolved && !resolution && (
              <>
                <Button
                  className="approval-card__allow"
                  isDisabled={!approvalId || isResolving}
                  size="sm"
                  onPress={() => void resolve("allow_once")}
                >
                  <Check aria-hidden="true" size={12} />
                  Permitir uma vez
                </Button>
                <Button
                  className="approval-card__deny"
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
              <span className="approval-card__resolved">
                <AlertTriangle aria-hidden="true" size={11} />
                {resolution === "allow_once"
                  ? "Permitido uma vez"
                  : "Resolvido"}
              </span>
            )}
          </div>
          {error && (
            <p className="approval-card__error" role="alert">
              Não foi possível resolver: {error}
            </p>
          )}
        </div>
      </Card.Header>
    </Card>
  );
}
