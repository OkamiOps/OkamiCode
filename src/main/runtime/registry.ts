import type { RuntimeKind } from "../../shared/contracts/lane";
import type { RuntimeAdapter } from "./adapter";
import {
  builtInRuntimeManifests,
  runtimeManifestSchema,
  type RuntimeManifest,
} from "./manifest";
import {
  ClaudeAdapter,
  type ClaudeAdapterDependencies,
} from "./claude/adapter";
import { CodexAdapter, type CodexAdapterDependencies } from "./codex/adapter";
import {
  CursorAdapter,
  type CursorAdapterDependencies,
} from "./cursor/adapter";
import { AgyAdapter, type AgyAdapterDependencies } from "./agy/adapter";
import { GrokAdapter, type GrokAdapterDependencies } from "./grok/adapter";
import { MimoAdapter, type MimoAdapterDependencies } from "./mimo/adapter";
import {
  MiniMaxAdapter,
  type MiniMaxAdapterDependencies,
} from "./minimax/adapter";
import {
  OpenCodeAdapter,
  type OpenCodeAdapterDependencies,
} from "./opencode/adapter";

export class RuntimeRegistry {
  private readonly adapters = new Map<RuntimeKind, RuntimeAdapter>();
  private readonly runtimeManifests = new Map<RuntimeKind, RuntimeManifest>();

  register(adapter: RuntimeAdapter, manifest?: RuntimeManifest): void {
    this.adapters.set(adapter.kind, adapter);
    if (manifest) {
      if (manifest.runtimeId !== adapter.kind) {
        throw new Error(
          `Runtime manifest ${manifest.runtimeId} does not match adapter ${adapter.kind}`,
        );
      }
      this.runtimeManifests.set(
        adapter.kind,
        runtimeManifestSchema.parse(manifest),
      );
    }
  }

  lookup(kind: RuntimeKind): RuntimeAdapter | undefined {
    return this.adapters.get(kind);
  }

  manifest(kind: RuntimeKind): RuntimeManifest | undefined {
    return this.runtimeManifests.get(kind);
  }

  manifests(): RuntimeManifest[] {
    return [...this.runtimeManifests.values()];
  }
}

export interface RuntimeRegistryDependencies {
  claude: ClaudeAdapterDependencies;
  codex: CodexAdapterDependencies;
  cursor: CursorAdapterDependencies;
  agy: AgyAdapterDependencies;
  grok: GrokAdapterDependencies;
  mimo: MimoAdapterDependencies;
  minimax: MiniMaxAdapterDependencies;
  opencode: OpenCodeAdapterDependencies;
}

export function createRuntimeRegistry(
  dependencies: RuntimeRegistryDependencies,
): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.register(
    new ClaudeAdapter(dependencies.claude),
    builtInRuntimeManifests.claude,
  );
  registry.register(
    new CodexAdapter(dependencies.codex),
    builtInRuntimeManifests.codex,
  );
  registry.register(
    new CursorAdapter(dependencies.cursor),
    builtInRuntimeManifests.cursor,
  );
  registry.register(
    new AgyAdapter(dependencies.agy),
    builtInRuntimeManifests.agy,
  );
  registry.register(
    new GrokAdapter(dependencies.grok),
    builtInRuntimeManifests.grok,
  );
  registry.register(
    new MimoAdapter(dependencies.mimo),
    builtInRuntimeManifests.mimo,
  );
  registry.register(
    new MiniMaxAdapter(dependencies.minimax),
    builtInRuntimeManifests.minimax,
  );
  registry.register(
    new OpenCodeAdapter(dependencies.opencode),
    builtInRuntimeManifests.opencode,
  );
  return registry;
}
