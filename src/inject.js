// MAIN world: X 自身が投げる GraphQL 応答を読むだけ。追加のリクエストは一切出さない。
// 拾ったユーザー情報は window.postMessage で content.js (ISOLATED world) に渡す。
(function () {
  "use strict";

  // "/i/api/graphql/" だけでなく "api.x.com/graphql/" 等も拾う。
  const GRAPHQL = /\/graphql\//;
  const DUMP_LIMIT = 60000;
  let lastGraphQL = null;

  function publish(users) {
    if (users.size === 0) return;
    try {
      window.postMessage({ __d1x: "users", users: Array.from(users.values()) }, "*");
    } catch {
      /* 失敗してもページ動作には影響させない */
    }
  }

  // 直近の GraphQL 応答を保持しておく (解析用。popup の「DOM/応答を保存」で取り出す)。
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.__d1x !== "dumpRequest") return;
    try {
      window.postMessage({ __d1x: "graphqlDump", data: lastGraphQL }, "*");
    } catch {
      /* ignore */
    }
  });

  function handleText(url, text) {
    if (typeof text !== "string" || text.length === 0) return;
    lastGraphQL = { url, ts: Date.now(), text: text.slice(0, DUMP_LIMIT) };
    const scan = window.__d1xScanUsersJson;
    if (typeof scan !== "function") return;
    const users = scan(text);
    if (users) publish(users);
  }

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = originalFetch.apply(this, arguments);
    try {
      const url =
        typeof input === "string" ? input : input && input.url ? input.url : "";
      if (GRAPHQL.test(url)) {
        promise
          .then((res) => {
            try {
              res
                .clone()
                .text()
                .then((text) => handleText(url, text))
                .catch(() => {});
            } catch {
              /* body が既に読まれている等 */
            }
          })
          .catch(() => {});
      }
    } catch {
      /* フックの失敗は素通し */
    }
    return promise;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  // X は pushState で画面を切り替えるので、URL 変化を content script に知らせる。
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name];
    if (typeof original !== "function") continue;
    history[name] = function () {
      const result = original.apply(this, arguments);
      try {
        window.postMessage({ __d1x: "navigate" }, "*");
      } catch {
        /* ignore */
      }
      return result;
    };
  }

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__d1xUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    try {
      const url = this.__d1xUrl;
      if (typeof url === "string" && GRAPHQL.test(url)) {
        this.addEventListener("load", () => {
          try {
            handleText(url, this.responseText);
          } catch {
            /* responseType が text でない場合など */
          }
        });
      }
    } catch {
      /* ignore */
    }
    return originalSend.apply(this, arguments);
  };
})();
