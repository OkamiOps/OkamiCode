export interface CredentialSource {
  get(): Promise<string | null>;
  describe(): {
    available: boolean;
    source: "environment" | "vault";
    reference: string;
  };
}

export class EnvironmentCredentialSource implements CredentialSource {
  constructor(
    private readonly name: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  get(): Promise<string | null> {
    return Promise.resolve(normalize(this.environment[this.name]));
  }

  describe(): {
    available: boolean;
    source: "environment";
    reference: string;
  } {
    return {
      available: normalize(this.environment[this.name]) !== null,
      source: "environment",
      reference: this.name,
    };
  }
}

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
