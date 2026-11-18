import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { bodyText, type Fetcher, importThreads, parseToken, renderThread, stripHtml } from "./case-screening-gmail.ts";
import { tempDir } from "./test-helpers.ts";

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

/** URL ごとに決めた応答を返す、Gmail API の代わり */
function fakeFetcher(routes: Record<string, unknown>, calls: string[] = []): Fetcher {
  return async (url) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (key === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[key] };
  };
}

const THREAD = {
  messages: [
    {
      id: "m1",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "紹介 <a@example.com>" },
          { name: "Subject", value: "案件のご紹介" },
          { name: "Date", value: "Mon, 17 Nov 2026 09:00:00 +0900" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Laravel の案件です") } },
          { mimeType: "text/html", body: { data: b64("<p>Laravel の案件です</p>") } },
        ],
      },
    },
  ],
};

describe("parseToken", () => {
  test("3つの項目がそろわなければ失敗にする", () => {
    const actual = () => parseToken('{"clientId":"id"}');
    assert.throws(actual, /refreshToken/);
  });
});

describe("stripHtml", () => {
  test("タグを外し、段落を改行にする", () => {
    const actual = stripHtml("<p>一行目</p><p>二行目&amp;</p>");
    const expected = "一行目\n二行目&";
    assert.equal(actual, expected);
  });
});

describe("bodyText", () => {
  test("text/plain があれば text/html を使わない", () => {
    const actual = bodyText(THREAD.messages[0].payload);
    const expected = "Laravel の案件です";
    assert.equal(actual, expected);
  });

  test("text/html しかなければ文字だけを使う", () => {
    const actual = bodyText({ mimeType: "text/html", body: { data: b64("<div>Go の案件</div>") } });
    const expected = "Go の案件";
    assert.equal(actual, expected);
  });
});

describe("renderThread", () => {
  test("差出人・件名・本文を並べる", () => {
    const actual = renderThread("t1", THREAD.messages).includes("件名: 案件のご紹介");
    const expected = true;
    assert.equal(actual, expected);
  });
});

describe("importThreads", () => {
  const routes = {
    "oauth2.googleapis.com/token": { access_token: "access" },
    "threads?q=after": { threads: [{ id: "t1" }] },
    "threads?q=label": { threads: [{ id: "t9" }] },
    "threads/t1?format=full": THREAD,
  };

  test("スレッドをファイルに書く", async () => {
    const out = tempDir();
    await importThreads(fakeFetcher(routes), { token: TOKEN, query: "from:a@example.com", after: 1, out });
    const actual = readFileSync(join(out, "t1.txt"), "utf8").includes("Laravel の案件です");
    const expected = true;
    assert.equal(actual, expected);
  });

  test("選んだ印のスレッドを selected.txt に書く", async () => {
    const out = tempDir();
    await importThreads(fakeFetcher(routes), { token: TOKEN, query: "q", after: 1, out, selectLabel: "選んだ" });
    const actual = readFileSync(join(out, "selected.txt"), "utf8");
    const expected = "t9\n";
    assert.equal(actual, expected);
  });

  test("読み取りの要求だけを送る（送信・ラベルの変更の URL を呼ばない）", async () => {
    const calls: string[] = [];
    await importThreads(fakeFetcher(routes, calls), { token: TOKEN, query: "q", after: 1, out: tempDir(), selectLabel: "選んだ" });
    const actual = calls.some((u) => /\/(send|modify|trash|drafts)/.test(u));
    const expected = false;
    assert.equal(actual, expected);
  });

  test("上限を超えたら本文を読まずに overflow にする", async () => {
    const many = { threads: Array.from({ length: 51 }, (_, i) => ({ id: `x${i}` })) };
    const result = await importThreads(fakeFetcher({ ...routes, "threads?q=after": many }), { token: TOKEN, query: "q", after: 1, out: tempDir() });
    const actual = result.overflow;
    const expected = true;
    assert.equal(actual, expected);
  });

  test("認証の更新に失敗したら止める", async () => {
    const actual = importThreads(fakeFetcher({}), { token: TOKEN, query: "q", after: 1, out: tempDir() });
    await assert.rejects(actual, /サインインのやり直し/);
  });
});

describe("認証のファイルを作る", () => {
  test("読み取りだけのスコープを求める", async () => {
    const { authUrl } = await import("./case-screening-gmail-auth.ts");
    const actual = new URL(authUrl("id", "http://127.0.0.1:1")).searchParams.get("scope");
    const expected = "https://www.googleapis.com/auth/gmail.readonly";
    assert.equal(actual, expected);
  });

  test("デスクトップ アプリのクライアントでなければ止める", async () => {
    const { parseClient } = await import("./case-screening-gmail-auth.ts");
    const actual = () => parseClient('{"web":{}}');
    assert.throws(actual, /installed/);
  });
});
