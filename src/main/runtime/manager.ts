import type { RuntimeAdapter, RuntimeHealth } from "./adapter";
import { runtimeManifestSchema, type RuntimeManifest } from "./manifest";

export interface RuntimePlugin {
  manifest: RuntimeManifest;
  adapter: RuntimeAdapter;
}

export interface RuntimeHealthSnapshot {
  manifest: RuntimeManifest;
  health: RuntimeHealth;
  checkedAt: string;
}

export class RuntimeManager {
  private readonly plugins = new Map<string, RuntimePlugin>();
  private readonly clock: () => Date;

  constructor(options?: { clock?: () => Date }) {
    this.clock = options?.clock ?? (() => new Date());
  }

  register(plugin: RuntimePlugin): void {
    const manifest = runtimeManifestSchema.parse(plugin.manifest);
    if (manifest.runtimeId !== plugin.adapter.kind) {
      throw new Error(
        `Runtime manifest ${manifest.runtimeId} does not match adapter ${plugin.adapter.kind}`,
      );
    }
    if (this.plugins.has(manifest.runtimeId)) {
      throw new Error(`Runtime ${manifest.runtimeId} is already registered`);
    }
    this.plugins.set(manifest.runtimeId, {
      manifest,
      adapter: plugin.adapter,
    });
  }

  lookup(runtimeId: string): RuntimeAdapter | undefined {
    return this.plugins.get(runtimeId)?.adapter;
  }

  manifests(): RuntimeManifest[] {
    return [...this.plugins.values()].map(({ manifest }) => manifest);
  }

  async health(runtimeId: string): Promise<RuntimeHealthSnapshot> {
    const plugin = this.plugins.get(runtimeId);
    if (!plugin) throw new Error(`Unknown runtime ${runtimeId}`);
    return {
      manifest: plugin.manifest,
      health: await plugin.adapter.detect(),
      checkedAt: this.clock().toISOString(),
    };
  }

  async healthAll(): Promise<RuntimeHealthSnapshot[]> {
    return Promise.all(
      [...this.plugins.keys()].map((runtimeId) => this.health(runtimeId)),
    );
  }
}
