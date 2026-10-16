// UserCell 1 個を読む純関数群。content.js と同じ ISOLATED world で動く。
//
// カウント (フォロー数/フォロワー数) はここでは取らない。X の一覧 DOM には出ておらず、
// 以前テキストから拾おうとして handle の数字 +「フォロー中」ボタンを誤って拾った。
// 数値は GraphQL 応答 (scan-users.js) からのみ取る。
(function (global) {
  // 「この人にフォローされています」バッジの DOM testid と、locale 依存のテキスト。
  const FOLLOWS_YOU_SELECTOR = '[data-testid="userFollowIndicator"]';
  const FOLLOWS_YOU_TEXTS = [
    "Follows you",
    "フォローされています",
    "あなたをフォローしています",
  ];
  const BUTTON_LIKE = /^(フォロー中|フォロー|フォロワー|Following|Follow|Followers|解除)$/;

  function firstNumber(...candidates) {
    for (const c of candidates) if (typeof c === "number") return c;
    return null;
  }

  function parseHandle(cell) {
    for (const a of cell.querySelectorAll('a[href^="/"]')) {
      const href = a.getAttribute("href") || "";
      // X の handle は 15 文字までだが、長い値でも取りこぼさないよう長さでは切らない。
      const m = href.match(/^\/([A-Za-z0-9_]+)/);
      if (m && m[1] !== "i" && m[1] !== "home" && m[1] !== "search") {
        return m[1];
      }
    }
    return null;
  }

  function parseName(nameBlock) {
    if (!nameBlock) return null;
    const firstSpan = nameBlock.querySelector("span");
    const fromSpan = firstSpan ? firstSpan.textContent.trim() : "";
    if (fromSpan) return fromSpan;
    const text = nameBlock.textContent || "";
    return text.split("@")[0].trim() || null;
  }

  // 表示名や handle と同じ文字列は bio ではない (X の一覧 DOM で取り違える)。
  function norm(s) {
    return (s || "").toLowerCase().replace(/[\s\u200b\u200d\ufe0f]/g, "");
  }

  function looksLikeName(text, name, handle) {
    const t = norm(text);
    if (!t) return true;
    if (name && t === norm(name)) return true;
    if (handle && t === norm(handle)) return true;
    return false;
  }

  // bio の要素は testid が付いているとは限らない。付いていなければ、
  // 「名前ブロックでもボタンでもない最初のテキストブロック」を bio とみなす。
  function parseBio(cell, nameBlock, name, handle) {
    const direct =
      cell.querySelector('[data-testid="UserDescription"]') ||
      cell.querySelector('[data-testid="UserBio"]');
    if (direct) {
      const text = (direct.textContent || "").trim();
      if (!looksLikeName(text, name, handle)) return text;
    }

    for (const el of cell.querySelectorAll("div")) {
      if (nameBlock && (el === nameBlock || el.contains(nameBlock))) continue;
      if (el.querySelector('[data-testid="User-Name"], button, [role="button"]')) continue;
      const text = (el.textContent || "").trim();
      if (text.length < 2 || text.length > 400) continue;
      if (text.startsWith("@")) continue;
      if (BUTTON_LIKE.test(text)) continue;
      if (handle && text.includes("@" + handle)) continue;
      if (looksLikeName(text, name, handle)) continue;
      return text;
    }
    return "";
  }

  // DOM に表示されている揺れを吸収して、1 セル分の情報を返す。
  function parseCell(cell) {
    const handle = parseHandle(cell);
    const nameBlock = cell.querySelector('[data-testid="User-Name"]');
    const name = parseName(nameBlock);
    const bio = parseBio(cell, nameBlock, name, handle);
    const allText = cell.textContent || "";
    const followsYou =
      cell.querySelector(FOLLOWS_YOU_SELECTOR) !== null ||
      FOLLOWS_YOU_TEXTS.some((t) => allText.includes(t));

    return { handle, name, bio, followsYou };
  }

  // 一方的フォロー (こちらがフォローしているが、相手からはされていない) かどうか。
  // GraphQL の followed_by が取れていればそれを優先し、無ければ DOM のバッジで判断する。
  function isOneSided(cellInfo, apiInfo) {
    if (apiInfo && typeof apiInfo.followedBy === "boolean") {
      return apiInfo.followedBy === false;
    }
    return cellInfo.followsYou === false;
  }

  function mergeAccount(cellInfo, apiInfo) {
    const fromApi = apiInfo && typeof apiInfo.bio === "string" && apiInfo.bio !== "";
    return {
      handle: cellInfo.handle || (apiInfo ? apiInfo.handle : null),
      name: cellInfo.name || (apiInfo ? apiInfo.name : null),
      bio: (fromApi ? apiInfo.bio : cellInfo.bio) || "",
      bioSource: fromApi ? "api" : cellInfo.bio ? "dom" : "none",
      following: firstNumber(apiInfo ? apiInfo.following : null),
      followers: firstNumber(apiInfo ? apiInfo.followers : null),
    };
  }

  global.__d1xParse = {
    parseCell,
    isOneSided,
    mergeAccount,
    FOLLOWS_YOU_TEXTS,
    FOLLOWS_YOU_SELECTOR,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.__d1xParse;
}
