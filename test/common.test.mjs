import test from "node:test";
import assert from "node:assert/strict";

import {
  buildState,
  buildQuestions,
  evaluateAnswers,
  cacheKeyFor,
  judgeAccount,
} from "../src/common.js";

const account = {
  handle: "sakura_cafe_love",
  name: "さくら🌸カフェ巡り",
  bio: "はじめまして！相互フォロー歓迎です！",
  following: 4820,
  followers: 312,
};

const settings = {
  endpoint: "http://127.0.0.1:8081/v1/systemone",
  cacheTtlDays: 7,
  autoJudge: true,
  showPanel: true,
  conditions: [
    {
      id: "spam",
      label: "スパム",
      question: "スパムや宣伝が主な目的か",
      threshold: 0.6,
      enabled: true,
    },
    {
      id: "followback",
      label: "フォロバ稼ぎ",
      question: "フォロバ目的で大量にフォローしているか",
      threshold: 0.5,
      enabled: true,
    },
    {
      id: "off",
      label: "無効な条件",
      question: "これは送られない",
      threshold: 0.5,
      enabled: false,
    },
  ],
};

test("buildState は名前/自己紹介/フォロー数/フォロワー数を並べる", () => {
  assert.equal(
    buildState(account),
    [
      "名前: さくら🌸カフェ巡り (@sakura_cafe_love)",
      "自己紹介: はじめまして！相互フォロー歓迎です！",
      "フォロー数: 4820",
      "フォロワー数: 312",
    ].join("\n")
  );
});

test("buildState は数値が無い項目を省き、bio 無しを (なし) にする", () => {
  assert.equal(
    buildState({ handle: "x", name: null, bio: "" }),
    ["名前: (不明) (@x)", "自己紹介: (なし)"].join("\n")
  );
});

test("buildQuestions は有効な条件だけを noul で送る", () => {
  const q = buildQuestions(settings);
  assert.deepEqual(Object.keys(q), ["spam", "followback"]);
  assert.equal(q.spam.type, "noul");
  assert.equal(q.spam.instructions, "スパムや宣伝が主な目的か");
  assert.equal(q.off, undefined);
});

test("evaluateAnswers は閾値以上を一致として返す", () => {
  const { matched, probs } = evaluateAnswers(
    { spam: { type: "noul", noul: 0.55 }, followback: { type: "noul", noul: 0.92 } },
    settings
  );
  assert.deepEqual(matched, ["followback"]);
  assert.deepEqual(probs, { spam: 0.55, followback: 0.92 });
});

test("キャッシュキーは bio/カウント/条件で変わる", () => {
  const base = cacheKeyFor(account, settings);
  assert.equal(base, cacheKeyFor({ ...account }, settings));
  assert.notEqual(base, cacheKeyFor({ ...account, bio: "別のbio" }, settings));
  assert.notEqual(base, cacheKeyFor({ ...account, followers: 313 }, settings));
  assert.notEqual(
    base,
    cacheKeyFor(account, {
      ...settings,
      conditions: [{ ...settings.conditions[0], threshold: 0.7 }, settings.conditions[1]],
    })
  );
  assert.equal(
    base,
    cacheKeyFor(account, {
      ...settings,
      conditions: [...settings.conditions, { ...settings.conditions[1], enabled: false }],
    }),
    "無効な条件はキーに影響しない"
  );
});

test("judgeAccount は state と noul 質問を POST し、応答を解釈する", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "d1-3B",
        answers: { spam: { type: "noul", noul: 0.91 }, followback: { type: "noul", noul: 0.3 } },
        usage: { input_tokens: 120, output_tokens: 0 },
      }),
    };
  };

  const verdict = await judgeAccount(account, settings, { fetchImpl: fakeFetch });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, settings.endpoint);
  assert.match(calls[0].body.state, /フォロー数: 4820/);
  assert.equal(calls[0].body.questions.spam.type, "noul");
  assert.deepEqual(verdict.matched, ["spam"]);
  assert.equal(verdict.model, "d1-3B");
  assert.equal(verdict.answers.followback, 0.3);
});

test("judgeAccount はサーバエラーを例外にする", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 501,
    text: async () => '{"error":"not a decision model"}',
  });
  await assert.rejects(
    () => judgeAccount(account, settings, { fetchImpl: fakeFetch }),
    /d1 server 501/
  );
});

test("条件が全部無効ならサーバを呼ばない", async () => {
  let called = false;
  const verdict = await judgeAccount(
    account,
    { ...settings, conditions: [{ ...settings.conditions[0], enabled: false }] },
    {
      fetchImpl: async () => {
        called = true;
        throw new Error("must not be called");
      },
    }
  );
  assert.equal(called, false);
  assert.equal(verdict.skipped, "no-conditions");
});
