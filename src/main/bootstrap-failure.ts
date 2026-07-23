export function bootstrapFailurePage(options: {
  code?: string;
  development: boolean;
}): string {
  const code = options.code ?? "STARTUP_FAILED";
  const action = options.development
    ? "Feche o app, execute pnpm rebuild:native e tente novamente."
    : "Feche o app e reinstale a versão mais recente. Seus projetos e conversas permanecem no perfil local.";
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
    <title>OkamiCode — falha ao iniciar</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        color: #f2f4f7; background: #0c0d12;
      }
      main {
        width: min(620px, calc(100vw - 48px)); padding: 30px;
        border: 1px solid #343641; border-radius: 18px;
        background: linear-gradient(145deg, #17191f, #111217);
        box-shadow: 0 24px 80px #0008;
      }
      i { display: block; width: 42px; height: 4px; margin-bottom: 24px; background: #ff7a1a; }
      h1 { margin: 0 0 12px; font-size: 26px; letter-spacing: -0.02em; }
      p { margin: 0 0 14px; color: #b5b8c3; line-height: 1.6; }
      code {
        display: inline-block; padding: 5px 8px; color: #76dce8;
        border: 1px solid #29434a; border-radius: 7px; background: #101c20;
      }
    </style>
  </head>
  <body>
    <main>
      <i></i>
      <h1>OkamiCode não conseguiu iniciar</h1>
      <p>O backend local falhou antes de abrir seus projetos. A interface normal foi bloqueada para não parecer que seus dados desapareceram.</p>
      <p>${action}</p>
      <code>${code}</code>
    </main>
  </body>
</html>`;
}
