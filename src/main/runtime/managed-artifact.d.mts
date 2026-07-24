/// <reference types="node" />

export interface ManagedArtifactOptions {
  runtimeDirectory: string;
  targetDirectory: string;
  executableName: string;
  label: string;
  payload: Buffer;
}

export function materializeVerifiedArtifactSync(
  options: ManagedArtifactOptions,
): string;
