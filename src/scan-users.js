// GraphQL 応答から X のユーザー objects を拾う。MAIN world の content script として
// 読み込まれ、同じ world の inject.js から window.__d1xScanUsers として使われる。
// node からもテストできるよう CommonJS でも export する。
//
// X の User object は年々痩せていくので、形を 2 通り受ける:
//   A) フラット: { screen_name, name, description, followers_count, friends_count, followed_by }
//   B) 入れ子  : { __typename:"User", core:{name,screen_name}, legacy:{description,...},
//                 relationship_perspectives:{followed_by,...} }
(function (global) {
  function num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  function bool(v) {
    return typeof v === "boolean" ? v : null;
  }

  function merge(found, handle, fields) {
    const prev = found.get(handle) || {};
    const pick = (key) => (fields[key] ?? prev[key] ?? null);
    found.set(handle, {
      handle,
      name: pick("name"),
      bio: pick("bio"),
      following: pick("following"),
      followers: pick("followers"),
      followedBy: pick("followedBy"),
    });
  }

  // A) フラットな legacy 型レコード
  function isFlatUser(o) {
    return (
      o !== null &&
      typeof o === "object" &&
      typeof o.screen_name === "string" &&
      ("name" in o ||
        "description" in o ||
        "followers_count" in o ||
        "friends_count" in o ||
        "followed_by" in o)
    );
  }

  function isObj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // B) core / legacy / relationship_perspectives に分かれた User container
  function isUserContainer(o) {
    return (
      isObj(o) &&
      (isObj(o.core) || isObj(o.legacy) || isObj(o.relationship_perspectives))
    );
  }

  // ユーザー 1 件を取り込む。取り込んだら true。
  function take(o, found) {
    if (isFlatUser(o)) {
      merge(found, o.screen_name, {
        name: typeof o.name === "string" ? o.name : null,
        bio: typeof o.description === "string" ? o.description : null,
        following: num(o.friends_count),
        followers: num(o.followers_count),
        followedBy: bool(o.followed_by),
      });
    }
    if (isUserContainer(o)) {
      const core = o.core && typeof o.core === "object" ? o.core : {};
      const legacy = o.legacy && typeof o.legacy === "object" ? o.legacy : {};
      const rp =
        o.relationship_perspectives && typeof o.relationship_perspectives === "object"
          ? o.relationship_perspectives
          : {};
      const handle =
        (typeof core.screen_name === "string" && core.screen_name) ||
        (typeof legacy.screen_name === "string" && legacy.screen_name) ||
        null;
      if (handle) {
        merge(found, handle, {
          name: typeof core.name === "string" ? core.name : typeof legacy.name === "string" ? legacy.name : null,
          bio: typeof legacy.description === "string" ? legacy.description : null,
          following: num(legacy.friends_count),
          followers: num(legacy.followers_count),
          followedBy: bool(legacy.followed_by) ?? bool(rp.followed_by),
        });
      }
    }
  }

  // root 以下の object を走査し、handle -> {handle,name,bio,following,followers,followedBy} を返す。
  // 同じ handle が複数箇所に出たら、値が入っている方を優先する。
  function scanUsers(root, out) {
    const found = out instanceof Map ? out : new Map();
    const stack = [root];
    const seen = new Set();
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === null || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);

      take(node, found);

      if (Array.isArray(node)) {
        for (const v of node) stack.push(v);
        continue;
      }
      for (const key in node) {
        const v = node[key];
        if (v !== null && typeof v === "object") stack.push(v);
      }
    }
    return found;
  }

  // 応答本文 (JSON テキスト) を走査する。壊れた JSON は null。
  function scanUsersJson(text) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    return scanUsers(json);
  }

  global.__d1xScanUsers = scanUsers;
  global.__d1xScanUsersJson = scanUsersJson;
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    scanUsers: globalThis.__d1xScanUsers,
    scanUsersJson: globalThis.__d1xScanUsersJson,
  };
}
