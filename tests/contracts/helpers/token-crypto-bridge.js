"use strict";

/*
 * Test-only stdin/stdout bridge for Node <-> Python credential
 * compatibility tests. Never used by the application server.
 *
 * Input JSON:
 *   { "mode": "encrypt", "token": "...", "contractId": "...", "ownerUsername": "..." }
 *   { "mode": "decrypt", "record": {...base64...}, "contractId": "...", "ownerUsername": "..." }
 */

const fs = require("fs");

const {
  decryptToken,
  encryptToken
} = require("../../../server/contracts/token-crypto");


function toBase64(value) {
  return Buffer.from(value).toString("base64");
}


function fromBase64(value) {
  return Buffer.from(String(value || ""), "base64");
}


function main() {

  const input =
    JSON.parse(
      fs.readFileSync(0, "utf8")
    );

  const context = {
    contractId: input.contractId,
    ownerUsername: input.ownerUsername
  };


  if (input.mode === "encrypt") {

    const record =
      encryptToken(
        input.token,
        context
      );

    process.stdout.write(
      JSON.stringify({
        ciphertext: toBase64(record.ciphertext),
        iv: toBase64(record.iv),
        authTag: toBase64(record.authTag),
        keyVersion: record.keyVersion
      })
    );

    return;

  }


  if (input.mode === "decrypt") {

    const record = input.record || {};

    const token =
      decryptToken(
        {
          ciphertext: fromBase64(record.ciphertext),
          iv: fromBase64(record.iv),
          authTag: fromBase64(record.authTag),
          keyVersion: record.keyVersion
        },
        context
      );

    process.stdout.write(
      JSON.stringify({ token })
    );

    return;

  }


  throw new Error("unknown mode");

}


try {
  main();
} catch (error) {
  process.stderr.write(
    `${error.code || error.name || "ERROR"}\n`
  );
  process.exit(1);
}
