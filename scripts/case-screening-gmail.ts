// 経路の種類 gmail-api: Gmail API（読み取りだけの認証）で案件のメールを手元のファイルへ取り込む。
//
// claude.ai の Gmail のコネクタは1つのアカウントにしかつながらないため、ほかのアカウント（個人事業の Gmail）は、
// このスクリプトが読み取り専用のトークンで取り込み、AI にはファイルとして読ませる。書き込みの権限は持たない。
// 認証のファイル（0600）は {"clientId", "clientSecret", "refreshToken"}。スコープは gmail.readonly だけにする。
//
// 使い方: case-screening-gmail.ts --token <認証のファイル> --query <検索> --after <UNIX時間> --out <フォルダ> [--select-label <ラベル>]
// 標準出力: {"threads": 取り込んだ件数, "selected": 選んだ印の件数}
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type Token = { clientId: string; clientSecret: string; refreshToken: string };
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
type Message = { id: string; internalDate?: string; payload?: Part };

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const MAX_THREADS = 50;
const MAX_BODY = 20000;

export function parseToken(text: string): Token {
  const t = JSON.parse(text) as Partial<Token>;
  if (!t.clientId || !t.clientSecret || !t.refreshToken) throw new Error("認証のファイルに clientId・clientSecret・refreshToken がない");
  return t as Token;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** HTML のタグを外して、読める文にする（案件の判断に要るのは文字だけ） */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** メッセージの本文を取り出す（text/plain を優先し、なければ text/html の文字だけ） */
export function bodyText(part: Part | undefined): string {
  if (!part) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: Part): void => {
    if (p.body?.data && p.mimeType === "text/plain") plain.push(decodeBase64Url(p.body.data));
    if (p.body?.data && p.mimeType === "text/html") html.push(stripHtml(decodeBase64Url(p.body.data)));
    for (const c of p.parts ?? []) walk(c);
  };
  walk(part);
  return (plain.length > 0 ? plain : html).join("\n\n");
}

const header = (p: Part | undefined, name: string): string =>
  p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** 1スレッドを、AI が読むファイルの中身にする */
export function renderThread(threadId: string, messages: Message[]): string {
  const blocks = messages.map((m) =>
    [
      `差出人: ${header(m.payload, "From")}`,
      `件名: ${header(m.payload, "Subject")}`,
      `日時: ${header(m.payload, "Date")}`,
      "",
      bodyText(m.payload).slice(0, MAX_BODY),
    ].join("\n"),
  );
  return [`スレッドID: ${threadId}`, "", ...blocks].join("\n\n---\n\n");
}

async function getJson(fetcher: Fetcher, url: string, accessToken: string): Promise<unknown> {
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail API が ${res.status} を返した`);
  return res.json();
}

export async function accessToken(fetcher: Fetcher, token: Token): Promise<string> {
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: token.clientId,
      client_secret: token.clientSecret,
      refresh_token: token.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`認証の更新に失敗した（${res.status}）。本人のサインインのやり直しが要る`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("認証の更新の応答にトークンがない");
  return body.access_token;
}

/** 検索に合うスレッド ID（最大 MAX_THREADS + 1 件。超えたかを呼び手が判断できるように） */
export async function listThreadIds(fetcher: Fetcher, access: string, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q, maxResults: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = (await getJson(fetcher, `${API}/threads?${params}`, access)) as { threads?: { id: string }[]; nextPageToken?: string };
    for (const t of page.threads ?? []) ids.push(t.id);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && ids.length <= MAX_THREADS);
  return ids;
}

export async function importThreads(
  fetcher: Fetcher,
  opts: { token: Token; query: string; after: number; out: string; selectLabel?: string },
): Promise<{ threads: number; selected: number; overflow: boolean }> {
  const access = await accessToken(fetcher, opts.token);
  const ids = await listThreadIds(fetcher, access, `after:${opts.after} ${opts.query}`);
  mkdirSync(opts.out, { recursive: true });
  const overflow = ids.length > MAX_THREADS;
  if (!overflow) {
    for (const id of ids) {
      const thread = (await getJson(fetcher, `${API}/threads/${id}?format=full`, access)) as { messages?: Message[] };
      writeFileSync(join(opts.out, `${id}.txt`), renderThread(id, thread.messages ?? []));
    }
  }
  const selected = opts.selectLabel ? await listThreadIds(fetcher, access, `label:${opts.selectLabel}`) : [];
  writeFileSync(join(opts.out, "selected.txt"), selected.map((s) => `${s}\n`).join(""));
  writeFileSync(join(opts.out, "threads.txt"), (overflow ? [] : ids).map((s) => `${s}\n`).join(""));
  return { threads: overflow ? 0 : ids.length, selected: selected.length, overflow };
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const tokenFile = arg(argv, "token");
  const query = arg(argv, "query");
  const after = Number(arg(argv, "after"));
  const out = arg(argv, "out");
  if (!tokenFile || !query || !out || !Number.isInteger(after)) {
    throw new Error("使い方: case-screening-gmail.ts --token <ファイル> --query <検索> --after <UNIX時間> --out <フォルダ>");
  }
  let token: Token;
  try {
    token = parseToken(readFileSync(tokenFile, "utf8"));
  } catch {
    throw new Error("認証のファイルがない・読めない。本人のサインインが要る（case-screening/README.md の「個人事業の Gmail」）");
  }
  const result = await importThreads(fetch as unknown as Fetcher, { token, query, after, out, selectLabel: arg(argv, "select-label") });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (import.meta.url === invoked) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
