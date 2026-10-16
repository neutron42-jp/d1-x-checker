const serverEl = document.getElementById("server");
const statsEl = document.getElementById("stats");
const conditionsEl = document.getElementById("conditions");
const statusEl = document.getElementById("status");

function row(dl, term, value) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function renderServer() {
  serverEl.textContent = "判定サーバ確認中...";
  const res = await chrome.runtime.sendMessage({ type: "health" });
  if (res?.ok) {
    const name = res.modelPath ? res.modelPath.split("/").pop() : "unknown";
    serverEl.innerHTML = `<span class="ok">●</span> サーバ応答 ${res.ms}ms<br /><span style="opacity:.7">${name}</span>`;
  } else {
    serverEl.innerHTML = `<span class="bad">●</span> サーバに接続できません<br /><span style="opacity:.7">${res?.error || res?.status || ""}</span>`;
  }
}

async function pingTab(tabId) {
  if (!tabId) return { ok: false, reason: "no-tab" };
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return res?.ok ? res : { ok: false, reason: "no-content" };
  } catch {
    return { ok: false, reason: "no-content" };
  }
}

async function renderStats() {
  statsEl.innerHTML = "";
  const tabId = await activeTabId();
  const ping = await pingTab(tabId);

  if (!ping.ok) {
    row(
      statsEl,
      "状態",
      ping.reason === "no-tab"
        ? "タブが見つかりません"
        : "このタブでは動いていません (ページを再読み込みしてください)"
    );
    return;
  }
  if (!ping.active) {
    row(statsEl, "状態", "このページはフォロー中一覧ではありません");
    row(statsEl, "開く場所", "x.com/<自分>/following");
    return;
  }
  row(statsEl, "対象 (一方的フォロー)", String(ping.oneSided ?? 0));
  row(statsEl, "判定済み", String(ping.judged ?? 0));
  row(statsEl, "条件一致", String(ping.matched ?? 0));
  if (ping.missingInput > 0) {
    row(statsEl, "⚠ 入力不足", `${ping.missingInput} 件 (bio/数値が取れず)`);
  }
  if (ping.failures) row(statsEl, "失敗", String(ping.failures));
  if (ping.lastError) row(statsEl, "エラー", String(ping.lastError).slice(0, 60));
}

async function renderConditions() {
  conditionsEl.innerHTML = "";
  const res = await chrome.runtime.sendMessage({ type: "settings" });
  const list = res?.conditionsLabel || [];
  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = "条件が未設定です";
    conditionsEl.appendChild(li);
    return;
  }
  for (const c of list) {
    const li = document.createElement("li");
    li.textContent = `${c.label} (閾値 ${(c.threshold * 100).toFixed(0)}%)`;
    conditionsEl.appendChild(li);
  }
}

document.getElementById("rescan").addEventListener("click", async () => {
  const tabId = await activeTabId();
  if (!tabId) return;
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "rescan", force: true });
    statusEl.textContent = res?.ok
      ? `再判定を依頼しました (対象 ${res.oneSided ?? 0} 件)`
      : "再判定できませんでした";
  } catch {
    statusEl.textContent =
      "このタブでは動いていません。ページを再読み込みしてから押してください";
  }
});

document.getElementById("dump").addEventListener("click", async () => {
  const tabId = await activeTabId();
  if (!tabId) return;
  statusEl.textContent = "取得中...";
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, { type: "dump" });
  } catch {
    statusEl.textContent = "このタブでは動いていません (ページを再読み込み)";
    return;
  }
  if (!res?.ok) {
    statusEl.textContent = "取得できませんでした";
    return;
  }
  const blob = new Blob([JSON.stringify(res, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `d1x-dump-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = `保存しました: 行 ${res.cells?.length ?? 0} / GraphQL ${res.graphql ? "あり" : "なし"}`;
});

document.getElementById("clear").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "clearCache" });
  statusEl.textContent = `キャッシュを削除しました (${res?.removed ?? 0} 件)。表示中のページを再読み込みすると判定し直します。`;
});

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

renderServer();
renderStats();
renderConditions();
