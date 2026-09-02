const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("review desk exposes one pending queue and item-level results", () => {
  const html = read("admin/index.html");
  assert.match(html, /data-kind="pending"/);
  assert.match(html, /data-kind="results"/);
  assert.doesNotMatch(html, /data-kind="candidate"|data-kind="risk"|confirmButton|publishButton/);
});

test("saving a draft does not create processed history", () => {
  const draft = read("functions/api/admin/review/draft.js");
  assert.doesNotMatch(draft, /review_history|draft_saved/);
});

test("submitted decisions become effective only after queue sync", () => {
  const publish = read("functions/api/admin/review/publish.js");
  const sync = read("functions/api/admin/sync-queue.js");
  const history = read("functions/api/admin/review/history.js");
  assert.match(publish, /state='submitted'/);
  assert.doesNotMatch(publish, /state='published'/);
  assert.match(sync, /d\.state='submitted' AND i\.active=0/);
  assert.match(sync, /state='effective'/);
  assert.match(history, /FROM review_decisions/);
  assert.doesNotMatch(history, /FROM review_history/);
});
