"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");


const ROOT = path.resolve(__dirname, "..", "..");

const HTML = fs.readFileSync(
  path.join(
    ROOT,
    "private/tools/contract-review/index.html"
  ),
  "utf8"
);

const SCRIPT = fs.readFileSync(
  path.join(
    ROOT,
    "private/tools/contract-review/script.js"
  ),
  "utf8"
);

const HISTORY = fs.readFileSync(
  path.join(
    ROOT,
    "private/tools/contract-review/contract-history.js"
  ),
  "utf8"
);


test("local parser is the default checked option", () => {
  assert.match(
    HTML,
    /name="parserBackend"[\s\S]*?value="local"[\s\S]*?checked/
  );

  assert.match(
    HTML,
    /value="cloud"/
  );
});


test("cloud settings and consent are present but initially hidden", () => {
  assert.match(
    HTML,
    /id="cloudSettings"[\s\S]*?hidden/
  );

  assert.match(
    HTML,
    /id="mineruApiToken"[\s\S]*?type="password"/
  );

  assert.match(
    HTML,
    /id="cloudConsent"[\s\S]*?type="checkbox"/
  );

  assert.match(
    HTML,
    /id="cloudConfigHint"/
  );
});


test("token input is not persisted by the page", () => {
  assert.doesNotMatch(
    SCRIPT,
    /localStorage[\s\S]{0,80}(mineruApiToken|token)/i
  );

  assert.doesNotMatch(
    SCRIPT,
    /sessionStorage/
  );

  assert.doesNotMatch(
    SCRIPT,
    /location\.(search|href)[\s\S]{0,80}token/i
  );
});


test("upload sends backend, mode, consent, and optional token", () => {
  assert.match(
    SCRIPT,
    /formData\.append\(\s*["']parserBackend["']/
  );

  assert.match(
    SCRIPT,
    /formData\.append\(\s*["']parseMode["']/
  );

  assert.match(
    SCRIPT,
    /cloudProcessingConsent/
  );

  assert.match(
    SCRIPT,
    /mineruApiToken/
  );
});


test("token input is cleared after submit", () => {
  assert.match(
    SCRIPT,
    /mineruApiToken[\s\S]{0,120}value\s*=\s*["']["']/
  );
});


test("cloud selection requires a consent check in the browser", () => {
  assert.match(
    SCRIPT,
    /cloudConsent[\s\S]{0,80}checked/
  );
});


test("history displays the selected engine without guessing cloud", () => {
  assert.match(
    HISTORY,
    /parseDetailText/
  );

  assert.match(
    HISTORY,
    /本地 MinerU（历史默认）/
  );

  assert.match(
    HISTORY,
    /MinerU 云端 API/
  );
});
