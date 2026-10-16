import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./common.js";

const tbody = document.querySelector("#conditions tbody");
const status = document.getElementById("status");

function rowTemplate(condition) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" data-field="label" /></td>
    <td><input type="text" data-field="question" /></td>
    <td><input type="number" data-field="threshold" min="0" max="1" step="0.05" /></td>
    <td style="text-align:center"><input type="checkbox" data-field="enabled" /></td>
    <td class="row-actions"><button type="button" data-action="remove">削除</button></td>
  `;
  tr.dataset.id = condition.id;
  tr.querySelector('[data-field="label"]').value = condition.label;
  tr.querySelector('[data-field="question"]').value = condition.question;
  tr.querySelector('[data-field="threshold"]').value = condition.threshold;
  tr.querySelector('[data-field="enabled"]').checked = condition.enabled;
  tr.querySelector('[data-action="remove"]').addEventListener("click", () =>
    tr.remove()
  );
  return tr;
}

function renderConditions(conditions) {
  tbody.innerHTML = "";
  for (const c of conditions) tbody.appendChild(rowTemplate(c));
}

function readForm() {
  const conditions = [];
  for (const tr of tbody.querySelectorAll("tr")) {
    const label = tr.querySelector('[data-field="label"]').value.trim();
    const question = tr.querySelector('[data-field="question"]').value.trim();
    const threshold = Number(
      tr.querySelector('[data-field="threshold"]').value || "0.6"
    );
    const enabled = tr.querySelector('[data-field="enabled"]').checked;
    if (!question) continue;
    conditions.push({
      id: tr.dataset.id,
      label: label || question.slice(0, 12),
      question,
      threshold: Math.min(1, Math.max(0, threshold)),
      enabled,
    });
  }
  return conditions;
}

function newId() {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

async function testConnection() {
  status.textContent = "接続確認中...";
  const res = await chrome.runtime.sendMessage({ type: "health" });
  if (res?.ok) {
    const name = res.modelPath ? res.modelPath.split("/").pop() : "unknown";
    status.textContent = `OK (${res.ms}ms) モデル: ${name}`;
  } else {
    status.textContent = `接続できません: ${res?.error || res?.status || "unknown"}`;
  }
}

document.getElementById("add").addEventListener("click", () => {
  tbody.appendChild(
    rowTemplate({
      id: newId(),
      label: "",
      question: "",
      threshold: 0.6,
      enabled: true,
    })
  );
});

document.getElementById("save").addEventListener("click", async () => {
  const settings = {
    endpoint:
      document.getElementById("endpoint").value.trim() ||
      DEFAULT_SETTINGS.endpoint,
    cacheTtlDays: Number(document.getElementById("cacheTtlDays").value || 7),
    autoJudge: document.getElementById("autoJudge").checked,
    showPanel: document.getElementById("showPanel").checked,
    conditions: readForm(),
  };
  await saveSettings(settings);
  status.textContent = `保存しました (有効な条件 ${settings.conditions.filter((c) => c.enabled).length} 件)。条件を変えると次回の照会から判定し直します。`;
});

document.getElementById("reset").addEventListener("click", async () => {
  const settings = { ...DEFAULT_SETTINGS };
  await saveSettings(settings);
  await hydrate();
  status.textContent = "既定の設定に戻しました";
});

document.getElementById("test").addEventListener("click", testConnection);

// 判定ログ (入力 state・条件・確率) を JSON で書き出す。精度の分析はこれを見る。
async function buildLogPayload() {
  const all = await chrome.storage.local.get(null);
  return {
    exportedAt: new Date().toISOString(),
    settings: all.settings ?? null,
    conditionsMeta: Object.fromEntries(
      Object.entries(all).filter(([k]) => k.startsWith("m:"))
    ),
    verdicts: Object.entries(all)
      .filter(([k]) => k.startsWith("v:"))
      .map(([key, v]) => ({ key, ...v })),
  };
}

document.getElementById("log").addEventListener("click", async () => {
  status.textContent = "判定ログを書き出し中...";
  const payload = await buildLogPayload();
  const blob = new Blob([JSON.stringify(payload, null, 1)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `d1x-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
  status.textContent = `書き出しました: ${payload.verdicts.length} 件 (ダウンロードフォルダ)`;
});

async function hydrate() {
  const settings = await loadSettings();
  document.getElementById("endpoint").value = settings.endpoint;
  document.getElementById("cacheTtlDays").value = settings.cacheTtlDays ?? 7;
  document.getElementById("autoJudge").checked = settings.autoJudge !== false;
  document.getElementById("showPanel").checked = settings.showPanel !== false;
  renderConditions(settings.conditions);
}

hydrate();
