import test from "node:test";
import assert from "node:assert/strict";

import "../src/scan-users.js";

const scanUsers = globalThis.__d1xScanUsers;
const scanUsersJson = globalThis.__d1xScanUsersJson;

// X の Following タイムライン応答に近い形。
const followingResponse = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  {
                    entryId: "user-111",
                    content: {
                      entryType: "TimelineTimelineItem",
                      itemContent: {
                        itemType: "TimelineUser",
                        user_results: {
                          result: {
                            __typename: "User",
                            rest_id: "111",
                            core: {
                              name: "さくら🌸カフェ巡り",
                              screen_name: "sakura_cafe_love",
                            },
                            legacy: {
                              name: "さくら🌸カフェ巡り",
                              screen_name: "sakura_cafe_love",
                              description: "はじめまして！相互フォロー歓迎です！",
                              followers_count: 312,
                              friends_count: 4820,
                              followed_by: false,
                              following: true,
                            },
                            relationship_perspectives: {
                              followed_by: false,
                              following: true,
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: "user-222",
                    content: {
                      entryType: "TimelineTimelineItem",
                      itemContent: {
                        itemType: "TimelineUser",
                        user_results: {
                          result: {
                            __typename: "User",
                            rest_id: "222",
                            core: { name: "田中 誠", screen_name: "tanaka_makoto" },
                            legacy: {
                              name: "田中 誠",
                              screen_name: "tanaka_makoto",
                              description: "ソフトウェアエンジニア。",
                              followers_count: 203,
                              friends_count: 187,
                              followed_by: true,
                              following: true,
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
              { type: "TimelineTerminateTimeline", direction: "Bottom" },
            ],
          },
        },
      },
    },
  },
};

test("Following 応答から handle ごとにユーザーを拾う", () => {
  const users = scanUsers(followingResponse);
  assert.equal(users.size, 2);

  const sakura = users.get("sakura_cafe_love");
  assert.equal(sakura.handle, "sakura_cafe_love");
  assert.equal(sakura.name, "さくら🌸カフェ巡り");
  assert.equal(sakura.bio, "はじめまして！相互フォロー歓迎です！");
  assert.equal(sakura.following, 4820);
  assert.equal(sakura.followers, 312);
  assert.equal(sakura.followedBy, false);

  const tanaka = users.get("tanaka_makoto");
  assert.equal(tanaka.followedBy, true);
  assert.equal(tanaka.following, 187);
  assert.equal(tanaka.followers, 203);
});

test("core (name だけ) と legacy が分かれていても 1 件にまとまる", () => {
  const users = scanUsers({
    a: { screen_name: "dup", name: "表示名" },
    b: { screen_name: "dup", description: "bio", followers_count: 5, friends_count: 6 },
  });
  assert.equal(users.size, 1);
  const u = users.get("dup");
  assert.equal(u.name, "表示名");
  assert.equal(u.bio, "bio");
  assert.equal(u.followers, 5);
  assert.equal(u.following, 6);
});

test("配列・深い入れ子・循環参照でも落ちない", () => {
  const node = {
    list: [{ user: { legacy: { screen_name: "deep", followers_count: 1 } } }],
  };
  node.self = node;
  const users = scanUsers(node);
  assert.equal(users.get("deep").followers, 1);
});

test("core/legacy に分かれた User container からも bio とカウントを拾う", () => {
  const users = scanUsers({
    data: {
      user: {
        result: {
          __typename: "User",
          core: { name: "Intel Japan", screen_name: "IntelJapan" },
          legacy: {
            description: "インテルの日本公式アカウント",
            followers_count: 12345,
            friends_count: 678,
            followed_by: false,
          },
          relationship_perspectives: { followed_by: false, following: true },
        },
      },
    },
  });
  const u = users.get("IntelJapan");
  assert.equal(u.name, "Intel Japan");
  assert.equal(u.bio, "インテルの日本公式アカウント");
  assert.equal(u.following, 678);
  assert.equal(u.followers, 12345);
  assert.equal(u.followedBy, false);
});

test("legacy に screen_name が無くても core と 1 件にまとまる", () => {
  const users = scanUsers({
    result: {
      __typename: "User",
      core: { name: "スーパーメガストア公式", screen_name: "megastore_jp" },
      legacy: { description: "毎日セール情報", followers_count: 45120, friends_count: 12 },
      relationship_perspectives: { followed_by: false },
    },
  });
  assert.equal(users.size, 1);
  const u = users.get("megastore_jp");
  assert.equal(u.name, "スーパーメガストア公式");
  assert.equal(u.bio, "毎日セール情報");
  assert.equal(u.followers, 45120);
  assert.equal(u.followedBy, false, "relationship_perspectives の followed_by を使う");
});

test("壊れた JSON は null", () => {
  assert.equal(scanUsersJson("{not json"), null);
  assert.equal(scanUsersJson('{"a":1}').size, 0);
});
