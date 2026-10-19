"use strict";

/*
 * Per-contract MinerU API token encryption.
 *
 * AES-256-GCM, random 12-byte IV, 16-byte auth tag.
 * The AAD binds the ciphertext to one contract + owner, so a
 * credential row cannot be copied to another contract/user.
 *
 * Key format:
 *   - 64 hex characters (32 bytes), or
 *   - base64 encoding of exactly 32 bytes.
 *
 * The token is never logged by this module.
 */

const crypto = require("crypto");


const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TOKEN_LENGTH = 2048;


class TokenCryptoError extends Error {

  constructor(code, message) {
    super(message);
    this.name = "TokenCryptoError";
    this.code = code;
  }

}


function loadKey() {

  const raw =
    String(
      process.env.MINERU_API_TOKEN_ENCRYPTION_KEY
      || ""
    ).trim();


  if (!raw) {
    throw new TokenCryptoError(
      "ENCRYPTION_KEY_MISSING",
      "服务器未配置 MINERU_API_TOKEN_ENCRYPTION_KEY"
    );
  }


  let key = null;


  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {

    try {
      key = Buffer.from(raw, "base64");
    } catch (_) {
      key = null;
    }

  }


  if (!key || key.length !== 32) {
    throw new TokenCryptoError(
      "ENCRYPTION_KEY_INVALID",
      "MINERU_API_TOKEN_ENCRYPTION_KEY 必须是 32 字节（64 位 hex 或 base64）"
    );
  }


  return key;

}


function isConfigured() {

  try {
    loadKey();
    return true;
  } catch (_) {
    return false;
  }

}


function aadFor(contractId, ownerUsername) {
  return Buffer.from(
    `contract-credential:v${KEY_VERSION}:${contractId}:${ownerUsername}`,
    "utf8"
  );
}


function assertContext(context) {

  const contractId =
    String(context?.contractId || "").trim();

  const ownerUsername =
    String(context?.ownerUsername || "").trim();


  if (!contractId || !ownerUsername) {
    throw new TokenCryptoError(
      "INVALID_CONTEXT",
      "凭证缺少合同或用户上下文"
    );
  }


  return {
    contractId,
    ownerUsername
  };

}


function normalizeToken(value) {

  const token =
    String(value || "").trim();


  if (!token) {
    throw new TokenCryptoError(
      "EMPTY_TOKEN",
      "API Token 为空"
    );
  }


  if (token.length > MAX_TOKEN_LENGTH) {
    throw new TokenCryptoError(
      "TOKEN_TOO_LONG",
      "API Token 长度超出限制"
    );
  }


  return token;

}


function encryptToken(token, context) {

  const key = loadKey();
  const safeContext = assertContext(context);
  const plaintext = normalizeToken(token);
  const iv = crypto.randomBytes(IV_BYTES);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    key,
    iv,
    {
      authTagLength: TAG_BYTES
    }
  );

  cipher.setAAD(
    aadFor(
      safeContext.contractId,
      safeContext.ownerUsername
    )
  );

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv,
    authTag,
    keyVersion: KEY_VERSION
  };

}


function decryptToken(record, context) {

  const key = loadKey();
  const safeContext = assertContext(context);

  const ciphertext =
    Buffer.from(record?.ciphertext || []);

  const iv =
    Buffer.from(record?.iv || []);

  const authTag =
    Buffer.from(record?.authTag || []);

  const keyVersion =
    Number(record?.keyVersion ?? KEY_VERSION);


  if (
    keyVersion !== KEY_VERSION
    || iv.length !== IV_BYTES
    || authTag.length !== TAG_BYTES
    || ciphertext.length === 0
  ) {
    throw new TokenCryptoError(
      "INVALID_RECORD",
      "凭证格式无效"
    );
  }


  try {

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      iv,
      {
        authTagLength: TAG_BYTES
      }
    );

    decipher.setAAD(
      aadFor(
        safeContext.contractId,
        safeContext.ownerUsername
      )
    );

    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return plaintext.toString("utf8");

  } catch (_) {
    throw new TokenCryptoError(
      "DECRYPT_FAILED",
      "凭证解密失败（数据可能被篡改）"
    );
  }

}


module.exports = {
  KEY_VERSION,
  MAX_TOKEN_LENGTH,
  TokenCryptoError,
  decryptToken,
  encryptToken,
  isConfigured
};
