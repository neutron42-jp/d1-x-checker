// ISOLATED world (x.com のページ上)。DOM を読み、service worker に判定を依頼する。
// X は SPA なので、URL が「フォロー中一覧」に変わった時点で動き始める。
(() => {
  "use strict";

  if (globalThis.__d1xContentLoaded) return; // 二重注入よけ
  globalThis.__d1xContentLoaded = true;

  const parse = window.__d1xParse;
  if (!parse) return;

  const apiUsers = new Map(); // handle -> {handle,name,bio,following,followers,followedBy}
  const verdictByHandle = new Map(); // handle -> verdict
  const cellHandles = new Map(); // handle -> Set<HTMLElement>
  const oneSidedHandles = new Set();
  const pendingJudges = new Set();
  const attempts = new Map(); // handle -> 失敗回数
  const JUDGE_TIMEOUT_MS = 15000;
  const MAX_ATTEMPTS = 3;

  let judgeFailures = 0;
  let lastError = null;
  let forceNext = false;
  let panel = null;
  let scanTimer = null;
  let observer = null;
  let activeFor = null; // 最後に処理した pathname
  let settingsCache = null;
  let missingInput = 0; // bio もカウントも無いまま判定した件数

  function isFollowingPath() {
    return /^\/[^/]+\/following(?:\/|$|\?)/.test(location.pathname);
  }

  // ---------- service worker とのやりとり ----------

  async function getSettings(refresh) {
    if (settingsCache && !refresh) return settingsCache;
    try {
      const res = await chrome.runtime.sendMessage({ type: "settings" });
      settingsCache = res?.settings || null;
    } catch {
      settingsCache = null;
    }
    return settingsCache;
  }

  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} タイムアウト (${ms}ms)`)),
          ms
        );
      }),
    ]);
  }

  async function judgeHandle(account, force) {
    if (pendingJudges.has(account.handle)) return;
    pendingJudges.add(account.handle);
    try {
      const res = await withTimeout(
        chrome.runtime.sendMessage({ type: "judge", account, force }),
        JUDGE_TIMEOUT_MS,
        "判定"
      );
      if (!res?.ok) throw new Error(res?.error || "judge failed");
      attempts.delete(account.handle);
      verdictByHandle.set(account.handle, res.verdict);
      const settings = await getSettings();
      for (const cell of cellHandles.get(account.handle) || []) {
        applyHighlight(cell, res.verdict, settings);
      }
    } catch (err) {
      const n = (attempts.get(account.handle) || 0) + 1;
      attempts.set(account.handle, n);
      lastError = String(err?.message || err);
      judgeFailures++;
      if (n < MAX_ATTEMPTS) {
        // service worker の再起動など一時的な失敗は、次のスキャンで再挑戦する。
        scheduleScan();
      } else {
        const verdict = { handle: account.handle, error: lastError };
        verdictByHandle.set(account.handle, verdict);
        for (const cell of cellHandles.get(account.handle) || []) {
          applyHighlight(cell, verdict, null);
        }
      }
    } finally {
      pendingJudges.delete(account.handle);
      renderPanel();
      publishStats();
    }
  }

  // ---------- 表示 ----------

  function describeConditions(verdict, settings) {
    const conds = settings?.conditions || [];
    const lines = conds
      .filter((c) => typeof verdict.answers?.[c.id] === "number")
      .map(
        (c) =>
          `${c.label}: ${(verdict.answers[c.id] * 100).toFixed(0)}% (閾値 ${(
            c.threshold * 100
          ).toFixed(0)}%)`
      );
    return lines.join("\n");
  }

  // 同じ状態を何度も書き込むと MutationObserver が回り続けるので、
  // 変化があるときだけ DOM を触る。
  function applyHighlight(cell, verdict, settings) {
    if (!verdict || !cell.isConnected) return;
    const desired = verdict.error
      ? "d1x-error"
      : (verdict.matched || []).length > 0
        ? "d1x-match"
        : "d1x-unmatched";

    for (const cls of ["d1x-match", "d1x-unmatched", "d1x-error"]) {
      if (cls !== desired && cell.classList.contains(cls)) {
        cell.classList.remove(cls);
      }
    }
    if (!cell.classList.contains(desired)) cell.classList.add(desired);

    const existing = cell.querySelector(":scope > .d1x-badge");
    if (desired !== "d1x-match") {
      if (existing) existing.remove();
      return;
    }
    const best = Math.max(
      ...(verdict.matched || []).map((id) => verdict.answers?.[id] ?? 0)
    );
    const text = `条件一致 ${(best * 100).toFixed(0)}%`;
    const title = describeConditions(verdict, settings) || "";
    if (existing) {
      if (existing.textContent !== text) existing.textContent = text;
      if (existing.title !== title) existing.title = title;
      return;
    }
    const el = document.createElement("div");
    el.className = "d1x-badge";
    el.textContent = text;
    el.title = title;
    cell.appendChild(el);
  }

  function clearHighlights() {
    document
      .querySelectorAll(".d1x-match, .d1x-unmatched, .d1x-error")
      .forEach((el) => {
        el.classList.remove("d1x-match", "d1x-unmatched", "d1x-error");
        const badge = el.querySelector(":scope > .d1x-badge");
        if (badge) badge.remove();
      });
  }

  function currentStats() {
    const matched = [...verdictByHandle.values()].filter(
      (v) => (v.matched || []).length > 0
    ).length;
    return {
      oneSided: oneSidedHandles.size,
      judged: verdictByHandle.size,
      matched,
      failures: judgeFailures,
      missingInput,
      lastError,
      active: isFollowingPath(),
    };
  }

  function publishStats() {
    chrome.runtime
      .sendMessage({ type: "stats", stats: currentStats() })
      .catch(() => {});
  }

  function renderPanel() {
    if (!panel) return;
    const s = currentStats();
    panel.querySelector('[data-d1x="counts"]').textContent =
      `対象 ${s.oneSided} / 判定 ${s.judged} / 一致 ${s.matched}`;
    const status = panel.querySelector('[data-d1x="status"]');
    if (s.lastError) status.textContent = `エラー: ${s.lastError}`;
    else if (s.missingInput > 0)
      status.textContent = `bio/数値が取れない行あり (${s.missingInput}) — X の仕様変更かも`;
    else status.textContent = s.matched > 0 ? "一致した行をハイライト中" : "該当なし";
  }

  function buildPanel() {
    const el = document.createElement("div");
    el.id = "d1x-panel";
    el.innerHTML = `
      <span class="d1x-title">d1 X checker</span>
      <span data-d1x="counts"></span>
      <span data-d1x="status" class="d1x-status"></span>
      <button data-d1x="rescan" type="button">再スキャン</button>
    `;
    el.querySelector('[data-d1x="rescan"]').addEventListener("click", () => {
      judgeFailures = 0;
      lastError = null;
      forceNext = true;
      verdictByHandle.clear();
      clearHighlights();
      scan();
    });
    document.body.appendChild(el);
    return el;
  }

  // ---------- 走査 ----------

  async function scan() {
    const settings = await getSettings();
    const cells = document.querySelectorAll('[data-testid="UserCell"]');
    cellHandles.clear();
    oneSidedHandles.clear();

    const toJudge = [];
    for (const cell of cells) {
      const dom = parse.parseCell(cell);
      if (!dom.handle) continue;
      const api = apiUsers.get(dom.handle) || null;
      const oneSided = parse.isOneSided(dom, api);
      let set = cellHandles.get(dom.handle);
      if (!set) {
        set = new Set();
        cellHandles.set(dom.handle, set);
      }
      set.add(cell);
      if (!oneSided) continue;
      oneSidedHandles.add(dom.handle);
      if (verdictByHandle.has(dom.handle) || pendingJudges.has(dom.handle)) {
        continue;
      }
      const account = parse.mergeAccount(dom, api);
      if (!account.handle) continue;
      if (!account.bio && !api) {
        // bio の手がかりが何も無いうちは判定しない (次で GraphQL 応答が来る)
        continue;
      }
      toJudge.push(account);
    }

    highlightAll(settings);
    renderPanel();

    const force = forceNext;
    forceNext = false;
    if (settings?.autoJudge === false && !force) return;
    for (const account of toJudge) {
      if (!account.bio && account.following === null && account.followers === null) {
        missingInput++;
      }
      judgeHandle(account, force);
    }
    publishStats();
  }

  function highlightAll(settings) {
    for (const [handle, cells] of cellHandles) {
      const verdict = verdictByHandle.get(handle);
      if (!verdict) continue;
      for (const cell of cells) applyHighlight(cell, verdict, settings);
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      syncWithLocation();
    }, 250);
  }

  // X は SPA。URL がフォロー中一覧に変わったら動き出し、離れたら後片付けする。
  function syncWithLocation() {
    const path = location.pathname;
    if (path === activeFor) {
      if (isFollowingPath()) scan();
      return;
    }
    activeFor = path;
    if (!isFollowingPath()) {
      if (panel) removePanel();
      clearHighlights();
      publishStats();
      return;
    }
    settingsCache = null;
    missingInput = 0;
    if (!panel) panel = buildPanel();
    getSettings(true).then(() => {
      renderPanel();
      scan();
    });
  }

  function removePanel() {
    panel.remove();
    panel = null;
  }

  // ---------- 起動 ----------

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__d1x === undefined) return;
    if (data.__d1x === "navigate") {
      scheduleScan();
      return;
    }
    if (data.__d1x !== "users" || !Array.isArray(data.users)) return;
    for (const u of data.users) {
      if (!u || typeof u.handle !== "string") continue;
      const prev = apiUsers.get(u.handle) || {};
      apiUsers.set(u.handle, {
        handle: u.handle,
        name: u.name ?? prev.name ?? null,
        bio: u.bio ?? prev.bio ?? null,
        following: u.following ?? prev.following ?? null,
        followers: u.followers ?? prev.followers ?? null,
        followedBy: u.followedBy ?? prev.followedBy ?? null,
      });
    }
    scheduleScan();
  });

  // MAIN world (inject.js) が持っている直近の GraphQL 応答を取り出す。解析用。
  function requestGraphQLDump(timeoutMs = 2000) {
    return new Promise((resolve) => {
      const onMessage = (event) => {
        if (event.source !== window || event.data?.__d1x !== "graphqlDump") return;
        window.removeEventListener("message", onMessage);
        resolve(event.data.data ?? null);
      };
      window.addEventListener("message", onMessage);
      try {
        window.postMessage({ __d1x: "dumpRequest" }, "*");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, timeoutMs);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "ping") {
      sendResponse({ ok: true, ...currentStats() });
      return false;
    }
    if (msg?.type === "dump") {
      requestGraphQLDump().then((graphql) => {
        const cells = Array.from(
          document.querySelectorAll('[data-testid="UserCell"]')
        )
          .slice(0, 3)
          .map((cell) => ({
            parsed: parse.parseCell(cell),
            html: cell.outerHTML.slice(0, 20000),
          }));
        sendResponse({
          ok: true,
          url: location.href,
          cells,
          api: Array.from(apiUsers.values()).slice(0, 10),
          apiCount: apiUsers.size,
          graphql,
          stats: currentStats(),
        });
      });
      return true;
    }
    if (msg?.type === "rescan") {
      if (msg.force) {
        verdictByHandle.clear();
        attempts.clear();
        forceNext = true;
        clearHighlights();
      }
      judgeFailures = 0;
      lastError = null;
      scan().then(() => sendResponse({ ok: true, ...currentStats() }));
      return true;
    }
    return false;
  });

  function start() {
    observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", scheduleScan);
    syncWithLocation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
