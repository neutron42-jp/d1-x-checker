// service worker: 判定の実行、キャッシュ、popup への状態提供。
import {
  loadSettings,
  judgeAccount,
  cacheKeyFor,
  activeConditions,
  conditionsMeta,
} from "./common.js";

const CACHE_MAX_ENTRIES = 2000;

/** @type {Map<number, {detected:number, judged:number, matched:number, oneSided:number, lastError:string|null, updatedAt:number}>} */
const statsByTab = new Map();

let queue = Promise.resolve();
const inFlight = new Map(); // cacheKey -> Promise<verdict>

async function getVerdict(cacheKey, force) {
  if (force) return null;
  const stored = await chrome.storage.local.get(cacheKey);
  const entry = stored[cacheKey];
  if (!entry) return null;
  const settings = await loadSettings();
  const ttl = (settings.cacheTtlDays ?? 7) * 24 * 60 * 60 * 1000;
  if (Date.now() - entry.ts > ttl) return null;
  return entry;
}

async function putVerdict(cacheKey, verdict) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("v:"));
  if (keys.length >= CACHE_MAX_ENTRIES) {
    keys
      .sort((a, b) => (all[a]?.ts || 0) - (all[b]?.ts || 0))
      .slice(0, keys.length - CACHE_MAX_ENTRIES + 1)
      .forEach((k) => chrome.storage.local.remove(k));
  }
  await chrome.storage.local.set({ [cacheKey]: verdict });
}

async function judge(account, force) {
  const settings = await loadSettings();
  const cacheKey = cacheKeyFor(account, settings);
  const cached = await getVerdict(cacheKey, force);
  if (cached) return { ...cached, cached: true };

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const task = queue.then(async () => {
    const verdict = await judgeAccount(account, settings);
    const metaKey = `m:${verdict.sig}`;
    const known = await chrome.storage.local.get(metaKey);
    if (!known[metaKey]) {
      await chrome.storage.local.set({
        [metaKey]: {
          ts: Date.now(),
          endpoint: settings.endpoint,
          conditions: conditionsMeta(settings),
        },
      });
    }
    await putVerdict(cacheKey, { ...verdict, cached: false });
    return { ...verdict, cached: false };
  });
  queue = task.then(
    () => undefined,
    () => undefined
  );
  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
}

function updateBadge(tabId) {
  const s = statsByTab.get(tabId);
  const text = s && s.matched > 0 ? String(s.matched) : "";
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#1d9bf0" }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "judge") {
        const verdict = await judge(msg.account, Boolean(msg.force));
        sendResponse({ ok: true, verdict });
        return;
      }
      if (msg?.type === "stats") {
        const tabId = sender.tab?.id;
        if (typeof tabId === "number") {
          statsByTab.set(tabId, { ...msg.stats, updatedAt: Date.now() });
          updateBadge(tabId);
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "getStats") {
        const tabId = msg.tabId ?? sender.tab?.id;
        sendResponse({ ok: true, stats: statsByTab.get(tabId) || null });
        return;
      }
      if (msg?.type === "settings") {
        const settings = await loadSettings();
        sendResponse({
          ok: true,
          settings,
          conditionsLabel: activeConditions(settings).map((c) => ({
            id: c.id,
            label: c.label,
            threshold: c.threshold,
          })),
        });
        return;
      }
      if (msg?.type === "health") {
        const settings = await loadSettings();
        const base = settings.endpoint.replace(/\/v1\/systemone$/, "");
        const startedAt = Date.now();
        const res = await fetch(`${base}/props`, { cache: "no-store" });
        const props = res.ok ? await res.json().catch(() => null) : null;
        sendResponse({
          ok: res.ok,
          status: res.status,
          ms: Date.now() - startedAt,
          modelPath: props?.model_path ?? null,
        });
        return;
      }
      if (msg?.type === "clearCache") {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter((k) => k.startsWith("v:"));
        if (keys.length > 0) await chrome.storage.local.remove(keys);
        sendResponse({ ok: true, removed: keys.length });
        return;
      }
      sendResponse({ ok: false, error: `unknown message: ${msg?.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // 非同期応答
});

chrome.tabs.onRemoved.addListener((tabId) => statsByTab.delete(tabId));
