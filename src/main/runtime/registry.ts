import type { RuntimeKind } from "../../shared/contracts/lane";
import type { RuntimeAdapter, RuntimeHealth } from "./adapter";
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
import {
  ProviderRuntimeAdapter,
  type RuntimeTransportCandidate,
} from "./sdk/provider-runtime";
import {
  ResponsesTransportAdapter,
  type ResponsesTransportDependencies,
} from "./sdk/responses-transport";
import {
  ChatCompletionsTransportAdapter,
  type ChatCompletionsTransportDependencies,
} from "./sdk/chat-completions-transport";

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

  async health(kind: RuntimeKind): Promise<{
    manifest: RuntimeManifest;
    health: RuntimeHealth;
  }> {
    const adapter = this.lookup(kind);
    const manifest = this.manifest(kind);
    if (!adapter || !manifest) throw new Error(`Unknown runtime ${kind}`);
    return { manifest, health: await adapter.detect() };
  }

  async healthAll(): Promise<
    Array<{ manifest: RuntimeManifest; health: RuntimeHealth }>
  > {
    return Promise.all(
      this.manifests().map((manifest) =>
        this.health(manifest.runtimeId as RuntimeKind),
      ),
    );
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
  responses?: {
    mimo?: ResponsesTransportDependencies;
  };
  chatCompletions?: {
    minimax?: ChatCompletionsTransportDependencies;
  };
}

export function createRuntimeRegistry(
  dependencies: RuntimeRegistryDependencies,
): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registerProvider(registry, builtInRuntimeManifests.claude, [
    ["claude-cli", new ClaudeAdapter(dependencies.claude)],
  ]);
  registerProvider(registry, builtInRuntimeManifests.codex, [
    ["codex-managed", new CodexAdapter(dependencies.codex)],
  ]);
  registerProvider(registry, builtInRuntimeManifests.cursor, [
    ["cursor-agent", new CursorAdapter(dependencies.cursor)],
  ]);
  registerProvider(registry, builtInRuntimeManifests.agy, [
    ["agy-cli", new AgyAdapter(dependencies.agy)],
  ]);
  registerProvider(registry, builtInRuntimeManifests.grok, [
    ["grok-managed", new GrokAdapter(dependencies.grok)],
  ]);
  registerProvider(registry, builtInRuntimeManifests.mimo, [
    ...(dependencies.responses?.mimo
      ? [
          [
            "mimo-token-plan",
            new ResponsesTransportAdapter(dependencies.responses.mimo),
          ] as const,
        ]
      : []),
    ["mimo-cli", new MimoAdapter(dependencies.mimo)],
  ]);
  registerProvider(registry, builtInRuntimeManifests.minimax, [
    ...(dependencies.chatCompletions?.minimax
      ? [
          [
            "minimax-token-plan",
            new ChatCompletionsTransportAdapter(
              dependencies.chatCompletions.minimax,
            ),
          ] as const,
        ]
      : []),
    ["minimax-cli", new MiniMaxAdapter(dependencies.minimax)],
  ]);
  registerProvider(registry, builtInRuntimeManifests.opencode, [
    ["opencode-acp", new OpenCodeAdapter(dependencies.opencode)],
  ]);
  return registry;
}

function registerProvider(
  registry: RuntimeRegistry,
  manifest: RuntimeManifest,
  transports: ReadonlyArray<
    readonly [transportId: string, adapter: RuntimeAdapter]
  >,
): void {
  const candidates: RuntimeTransportCandidate[] = transports.map(
    ([transportId, adapter]) => {
      const descriptor = manifest.transports.find(
        (transport) => transport.id === transportId,
      );
      if (!descriptor) {
        throw new Error(
          `Manifest ${manifest.runtimeId} does not declare transport ${transportId}`,
        );
      }
      return { descriptor, adapter };
    },
  );
  registry.register(
    new ProviderRuntimeAdapter(manifest.runtimeId as RuntimeKind, candidates),
    manifest,
  );
}
