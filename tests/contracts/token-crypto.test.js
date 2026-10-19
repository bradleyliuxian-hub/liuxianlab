"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TokenCryptoError,
  decryptToken,
  encryptToken,
  isConfigured
} = require("../../server/contracts/token-crypto");


const KEY = "a".repeat(64);
const CONTEXT = {
  contractId: "11111111-1111-1111-1111-111111111111",
  ownerUsername: "test-owner"
};
const TOKEN = "fictional-test-token";


function withKey(value, fn) {
  const original =
    process.env.MINERU_API_TOKEN_ENCRYPTION_KEY;

  if (value === undefined) {
    delete process.env.MINERU_API_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.MINERU_API_TOKEN_ENCRYPTION_KEY = value;
  }

  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.MINERU_API_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.MINERU_API_TOKEN_ENCRYPTION_KEY = original;
    }
  }
}


test("missing key is reported and isConfigured is false", () => {
  withKey(undefined, () => {
    assert.equal(isConfigured(), false);

    assert.throws(
      () => encryptToken(TOKEN, CONTEXT),
      error =>
        error instanceof TokenCryptoError
        && error.code === "ENCRYPTION_KEY_MISSING"
    );
  });
});


test("encrypt/decrypt roundtrip", () => {
  withKey(KEY, () => {
    const record = encryptToken(TOKEN, CONTEXT);

    assert.equal(record.iv.length, 12);
    assert.equal(record.authTag.length, 16);
    assert.ok(record.ciphertext.length > 0);
    assert.equal(record.keyVersion, 1);

    assert.equal(
      decryptToken(record, CONTEXT),
      TOKEN
    );
  });
});


test("stored record does not contain the plaintext token", () => {
  withKey(KEY, () => {
    const record = encryptToken(TOKEN, CONTEXT);

    const serialized = JSON.stringify({
      ciphertext: record.ciphertext.toString("base64"),
      iv: record.iv.toString("base64"),
      authTag: record.authTag.toString("base64")
    });

    assert.equal(
      serialized.includes(TOKEN),
      false
    );

    assert.equal(
      record.ciphertext.toString("utf8").includes(TOKEN),
      false
    );
  });
});


test("ciphertext is bound to contract and owner", () => {
  withKey(KEY, () => {
    const record = encryptToken(TOKEN, CONTEXT);

    assert.throws(
      () => decryptToken(record, {
        ...CONTEXT,
        contractId:
          "22222222-2222-2222-2222-222222222222"
      }),
      error => error.code === "DECRYPT_FAILED"
    );

    assert.throws(
      () => decryptToken(record, {
        ...CONTEXT,
        ownerUsername: "other-owner"
      }),
      error => error.code === "DECRYPT_FAILED"
    );
  });
});


test("tampered ciphertext fails authentication", () => {
  withKey(KEY, () => {
    const record = encryptToken(TOKEN, CONTEXT);

    const tampered = {
      ...record,
      ciphertext: Buffer.from(record.ciphertext)
    };

    tampered.ciphertext[0] ^= 0xff;

    assert.throws(
      () => decryptToken(tampered, CONTEXT),
      error => error.code === "DECRYPT_FAILED"
    );
  });
});


test("errors never contain the token", () => {
  withKey(KEY, () => {
    const record = encryptToken(TOKEN, CONTEXT);

    try {
      decryptToken(record, {
        ...CONTEXT,
        ownerUsername: "other-owner"
      });
      assert.fail("expected failure");
    } catch (error) {
      assert.equal(
        String(error.message).includes(TOKEN),
        false
      );
    }
  });
});
