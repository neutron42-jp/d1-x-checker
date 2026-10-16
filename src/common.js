// background (module service worker) と options/popup ページで共有するロジック。
// ブラウザ API に依存しない部分を中心にして、node からもテストできるようにしている。

export const DEFAULT_CONDITIONS = [
  {
    id: "spam",
    label: "スパム・宣伝・勧誘",
    question: "スパムや宣伝、勧誘が主な目的のアカウントか",
    threshold: 0.6,
    enabled: true,
  },
  {
    id: "followback",
    label: "フォロバ要求",
    question: "プロフィールでフォロバ(相互フォロー)やいいね周りを求めているか",
    threshold: 0.6,
    enabled: true,
  },
];

export const DEFAULT_SETTINGS = {
  endpoint: "http://127.0.0.1:8081/v1/systemone",
  conditions: DEFAULT_CONDITIONS,
  autoJudge: true,
  showPanel: true,
  cacheTtlDays: 7,
};

export const CACHE_TTL_MS = () => Date.now();

export function hashString(input) {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// 有効な条件だけを、閾値込みで 1 つの文字列にする (キャッシュの同一性判定用)。
export function conditionsSignature(settings) {
  const conds = (settings.conditions || [])
    .filter((c) => c.enabled && c.question.trim() !== "")
    .map((c) => `${c.id}:${c.threshold}:${c.question.trim()}`)
    .join("|");
  return hashString(conds);
}

export function activeConditions(settings) {
  return (settings.conditions || []).filter(
    (c) => c.enabled && c.question.trim() !== ""
  );
}

// 判定ログを後から読めるように、実行時の条件をそのまま残す。
export function conditionsMeta(settings) {
  return activeConditions(settings).map((c) => ({
    id: c.id,
    label: c.label,
    question: c.question,
    threshold: c.threshold,
  }));
}

// モデルに渡す state。実測で当たりが良かった日本語ラベル形式。
export function buildState(account) {
  const lines = [];
  const name = account.name ? account.name : "(不明)";
  lines.push(`名前: ${name}${account.handle ? ` (@${account.handle})` : ""}`);
  lines.push(`自己紹介: ${account.bio ? account.bio : "(なし)"}`);
  if (typeof account.following === "number") {
    lines.push(`フォロー数: ${account.following}`);
  }
  if (typeof account.followers === "number") {
    lines.push(`フォロワー数: ${account.followers}`);
  }
  return lines.join("\n");
}

export function hasCounts(account) {
  return (
    typeof account.following === "number" ||
    typeof account.followers === "number"
  );
}

// 条件 1 つ = noul 質問 1 つ。
export function buildQuestions(settings) {
  const questions = {};
  for (const c of activeConditions(settings)) {
    questions[c.id] = { type: "noul", instructions: c.question };
  }
  return questions;
}

export function evaluateAnswers(answers, settings) {
  const matched = [];
  const probs = {};
  for (const c of activeConditions(settings)) {
    const a = answers[c.id];
    if (!a || typeof a.noul !== "number") continue;
    probs[c.id] = a.noul;
    if (a.noul >= c.threshold) matched.push(c.id);
  }
  return { matched, probs };
}

export function cacheKeyFor(account, settings) {
  return [
    "v",
    hashString(
      [
        account.handle || "",
        account.bio || "",
        account.following ?? "",
        account.followers ?? "",
        conditionsSignature(settings),
      ].join("\u0000")
    ),
  ].join(":");
}

export async function judgeAccount(account, settings, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 20000;
  const conditions = activeConditions(settings);
  const state = buildState(account);

  if (conditions.length === 0) {
    return {
      handle: account.handle,
      ts: Date.now(),
      state,
      answers: {},
      matched: [],
      model: null,
      skipped: "no-conditions",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(settings.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, questions: buildQuestions(settings) }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`d1 server ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const answers = data.answers || {};
  const { matched, probs } = evaluateAnswers(answers, settings);
  return {
    handle: account.handle,
    ts: Date.now(),
    state,
    answers: probs,
    matched,
    sig: conditionsSignature(settings),
    counts: {
      following: typeof account.following === "number" ? account.following : null,
      followers: typeof account.followers === "number" ? account.followers : null,
      bio: account.bio ? account.bio.length : 0,
      bioSource: account.bioSource ?? null,
    },
    model: typeof data.model === "string" ? data.model : null,
    usage: data.usage || null,
  };
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get("settings");
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  if (!Array.isArray(settings.conditions) || settings.conditions.length === 0) {
    settings.conditions = DEFAULT_CONDITIONS;
  }
  return settings;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
