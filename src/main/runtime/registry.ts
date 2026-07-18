import type { RuntimeKind } from "../../shared/contracts/lane";
import type { RuntimeAdapter } from "./adapter";
import {
  ClaudeAdapter,
  type ClaudeAdapterDependencies,
} from "./claude/adapter";
import { CodexAdapter, type CodexAdapterDependencies } from "./codex/adapter";

export class RuntimeRegistry {
  private readonly adapters = new Map<RuntimeKind, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  lookup(kind: RuntimeKind): RuntimeAdapter | undefined {
    return this.adapters.get(kind);
  }
}

export interface RuntimeRegistryDependencies {
  claude: ClaudeAdapterDependencies;
  codex: CodexAdapterDependencies;
}

export function createRuntimeRegistry(
  dependencies: RuntimeRegistryDependencies,
): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.register(new ClaudeAdapter(dependencies.claude));
  registry.register(new CodexAdapter(dependencies.codex));
  return registry;
}
