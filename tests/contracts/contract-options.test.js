"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeCloudConsent,
  normalizeParseBackend,
  normalizeParseMode,
  normalizeToken,
  validateUploadOptions
} = require("../../server/contracts/contract-options");


function validate(overrides = {}) {
  return validateUploadOptions({
    parseMode: "auto",
    parserBackend: "local",
    cloudProcessingConsent: false,
    userToken: "",
    serverTokenConfigured: false,
    encryptionConfigured: false,
    ...overrides
  });
}


test("parse mode defaults to auto and rejects unknown values", () => {
  assert.equal(normalizeParseMode(undefined), "auto");
  assert.equal(normalizeParseMode(""), "auto");
  assert.equal(normalizeParseMode("FAST"), "fast");
  assert.equal(normalizeParseMode("turbo"), null);
});


test("parser backend defaults to local and rejects unknown values", () => {
  assert.equal(normalizeParseBackend(undefined), "local");
  assert.equal(normalizeParseBackend(""), "local");
  assert.equal(normalizeParseBackend("CLOUD"), "cloud");
  assert.equal(normalizeParseBackend("turbo"), null);
});


test("cloud consent accepts only explicit truthy values", () => {
  assert.equal(normalizeCloudConsent(true), true);
  assert.equal(normalizeCloudConsent("true"), true);
  assert.equal(normalizeCloudConsent("on"), true);
  assert.equal(normalizeCloudConsent("false"), false);
  assert.equal(normalizeCloudConsent(undefined), false);
});


test("token is trimmed and length-limited", () => {
  assert.equal(normalizeToken("  abc  "), "abc");
  assert.equal(normalizeToken(undefined), "");
  assert.equal(
    normalizeToken("x".repeat(2049)),
    null
  );
});


test("local is valid without consent or token", () => {
  const result = validate({
    parserBackend: "local",
    cloudProcessingConsent: false,
    userToken: "",
    serverTokenConfigured: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.backend, "local");
  assert.equal(result.mode, "auto");
  assert.equal(result.token, "");
  assert.equal(result.storeToken, false);
});


test("local discards a submitted token", () => {
  const result = validate({
    parserBackend: "local",
    userToken: "should-not-be-stored"
  });

  assert.equal(result.ok, true);
  assert.equal(result.token, "");
  assert.equal(result.storeToken, false);
});


test("invalid backend and mode are rejected", () => {
  assert.equal(
    validate({ parserBackend: "turbo" }).ok,
    false
  );
  assert.equal(
    validate({ parseMode: "turbo" }).ok,
    false
  );
});


test("cloud requires explicit consent", () => {
  const result = validate({
    parserBackend: "cloud",
    serverTokenConfigured: true,
    encryptionConfigured: true,
    cloudProcessingConsent: false
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /确认/);
});


test("cloud without any token is rejected", () => {
  const result = validate({
    parserBackend: "cloud",
    cloudProcessingConsent: true,
    userToken: "",
    serverTokenConfigured: false
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Token/);
});


test("cloud user token requires encryption key", () => {
  const result = validate({
    parserBackend: "cloud",
    cloudProcessingConsent: true,
    userToken: "user-token",
    encryptionConfigured: false,
    serverTokenConfigured: true
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /加密密钥/);
});


test("cloud user token is marked for encrypted storage", () => {
  const result = validate({
    parserBackend: "cloud",
    cloudProcessingConsent: true,
    userToken: " user-token ",
    encryptionConfigured: true,
    serverTokenConfigured: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.token, "user-token");
  assert.equal(result.storeToken, true);
});


test("cloud can use the server token when user token is blank", () => {
  const result = validate({
    parserBackend: "cloud",
    cloudProcessingConsent: true,
    userToken: "",
    serverTokenConfigured: true,
    encryptionConfigured: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.token, "");
  assert.equal(result.storeToken, false);
});
