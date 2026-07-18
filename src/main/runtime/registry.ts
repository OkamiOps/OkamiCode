import type { RuntimeKind } from "../../shared/contracts/lane";
import type { RuntimeAdapter } from "./adapter";

export class RuntimeRegistry {
  private readonly adapters = new Map<RuntimeKind, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  lookup(kind: RuntimeKind): RuntimeAdapter | undefined {
    return this.adapters.get(kind);
  }
}
