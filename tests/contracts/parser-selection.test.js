"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const selection = require(
  "../../private/tools/contract-review/parser-selection"
);


test("backend defaults to local and cloud visibility follows it", () => {
  assert.equal(selection.normalizeBackend(undefined), "local");
  assert.equal(selection.normalizeBackend(""), "local");
  assert.equal(selection.normalizeBackend("CLOUD"), "cloud");

  assert.equal(selection.cloudVisible(undefined), false);
  assert.equal(selection.cloudVisible("local"), false);
  assert.equal(selection.cloudVisible("cloud"), true);
});


test("mode defaults to auto and is independent of backend", () => {
  assert.equal(selection.normalizeMode(undefined), "auto");
  assert.equal(selection.normalizeMode("FAST"), "fast");
  assert.equal(selection.normalizeMode("accurate"), "accurate");

  const fields = selection.uploadFields({
    backend: "cloud",
    mode: "fast",
    consent: true,
    token: "t"
  });

  assert.equal(fields.parserBackend, "cloud");
  assert.equal(fields.parseMode, "fast");
});


test("local upload omits cloud consent and token", () => {
  const fields = selection.uploadFields({
    backend: "local",
    mode: "accurate",
    consent: true,
    token: "should-not-be-sent"
  });

  assert.deepEqual(fields, {
    parseMode: "accurate",
    parserBackend: "local"
  });
});


test("cloud upload includes consent and only a non-empty token", () => {
  const withToken = selection.uploadFields({
    backend: "cloud",
    mode: "auto",
    consent: true,
    token: "  user-token  "
  });

  assert.equal(withToken.cloudProcessingConsent, "true");
  assert.equal(withToken.mineruApiToken, "user-token");

  const withoutToken = selection.uploadFields({
    backend: "cloud",
    mode: "auto",
    consent: true,
    token: ""
  });

  assert.equal(withoutToken.cloudProcessingConsent, "true");
  assert.equal(
    Object.hasOwn(withoutToken, "mineruApiToken"),
    false
  );
});


test("cloud without consent is blocked", () => {
  const result = selection.validateCloudSelection({
    backend: "cloud",
    consent: false,
    token: "t",
    serverTokenConfigured: true,
    encryptionKeyConfigured: true
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /确认/);
});


test("cloud without any token source is blocked", () => {
  const result = selection.validateCloudSelection({
    backend: "cloud",
    consent: true,
    token: "",
    serverTokenConfigured: false,
    encryptionKeyConfigured: true
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Token/);
});


test("cloud user token requires an encryption key", () => {
  const result = selection.validateCloudSelection({
    backend: "cloud",
    consent: true,
    token: "user-token",
    serverTokenConfigured: true,
    encryptionKeyConfigured: false
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /加密密钥/);
});


test("custom token with encryption key is valid", () => {
  const result = selection.validateCloudSelection({
    backend: "cloud",
    consent: true,
    token: "user-token",
    serverTokenConfigured: false,
    encryptionKeyConfigured: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, "");
});


test("cloud server-token path is valid without a user token", () => {
  const result = selection.validateCloudSelection({
    backend: "cloud",
    consent: true,
    token: "",
    serverTokenConfigured: true,
    encryptionKeyConfigured: false
  });

  assert.equal(result.ok, true);
});


test("local selection never requires cloud configuration", () => {
  const result = selection.validateCloudSelection({
    backend: "local",
    consent: false,
    token: "",
    serverTokenConfigured: false,
    encryptionKeyConfigured: false
  });

  assert.equal(result.ok, true);
});
