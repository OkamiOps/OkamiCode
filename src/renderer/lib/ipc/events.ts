import {
  canonicalEventSchema,
  type CanonicalEvent,
} from "../../../shared/contracts/event";

export type RendererCanonicalEvent = CanonicalEvent;

export function subscribeToWorkbenchEvents(
  listener: (event: RendererCanonicalEvent) => void,
): () => void {
  return window.okami.onEvent((raw) => {
    listener(canonicalEventSchema.parse(raw));
  });
}
