// 経路の種類 gmail-api の認証のファイルを作る（本人が1回だけ、ブラウザでサインインする）。
//
// 使い方: case-screening-gmail-auth.ts --client <OAuth クライアントの JSON> --out <認証のファイル>
// クライアントの JSON は、Google Cloud の「OAuth クライアント ID（デスクトップ アプリ）」で落としたもの。
// 手元の 127.0.0.1 で応答を受け、読み取りだけのスコープ（gmail.readonly）のトークンを 0600 で書く。値は画面に出さない。
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function parseClient(text: string): { clientId: string; clientSecret: string } {
  const j = JSON.parse(text) as { installed?: { client_id?: string; client_secret?: string } };
  const c = j.installed;
  if (!c?.client_id || !c.client_secret) throw new Error("デスクトップ アプリの OAuth クライアントの JSON でない（installed がない）");
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

export function authUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function arg(args: string[], name: string): string {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || !args[i + 1]) throw new Error(`--${name} がない`);
  return args[i + 1];
}

async function main(argv: string[]): Promise<void> {
  const client = parseClient(readFileSync(arg(argv, "client"), "utf8"));
  const out = arg(argv, "out");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("受け口を開けない");
  const redirectUri = `http://127.0.0.1:${address.port}`;
  process.stdout.write(`ブラウザで開き、個人事業のアカウントでサインインして「許可」を押す:\n${authUrl(client.clientId, redirectUri)}\n`);
  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const c = url.searchParams.get("code");
      res.end(c ? "受け取った。この画面は閉じてよい。" : "許可されなかった。");
      if (c) resolve(c);
      else reject(new Error("許可されなかった"));
    });
  });
  server.close();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...{ client_id: client.clientId, client_secret: client.clientSecret }, code, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
  });
  const body = (await res.json()) as { refresh_token?: string; scope?: string };
  if (!res.ok || !body.refresh_token) throw new Error(`トークンを受け取れない（${res.status}）`);
  if (body.scope !== SCOPE) throw new Error("読み取りだけのスコープでない。許可の画面で、読み取り以外を足していないか確かめる");
  writeFileSync(out, `${JSON.stringify({ ...client, refreshToken: body.refresh_token })}\n`, { mode: 0o600 });
  process.stdout.write(`認証のファイルを書いた: ${out}\n`);
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (import.meta.url === invoked) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
