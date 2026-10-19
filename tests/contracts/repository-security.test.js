"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Repository security tests without a real PostgreSQL connection.
 * Inject a fake db module before repository.js loads.
 */

const dbPath = require.resolve(
  "../../server/contracts/db"
);

let lastQuery = null;
let nextRows = [];

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (text, params = []) => {
      lastQuery = { text, params };
      return { rows: nextRows };
    }
  }
};

const repository = require(
  "../../server/contracts/repository"
);


function reset(rows = []) {
  lastQuery = null;
  nextRows = rows;
}


test("getContractForOwner scopes the query by owner", async () => {
  reset([{}]);

  await repository.getContractForOwner(
    "11111111-1111-1111-1111-111111111111",
    "alice"
  );

  assert.match(
    lastQuery.text,
    /owner_username = \$2/
  );
  assert.deepEqual(
    lastQuery.params,
    [
      "11111111-1111-1111-1111-111111111111",
      "alice"
    ]
  );
});


test("createContract persists parse_backend_requested", async () => {
  reset([{}]);

  await repository.createContract({
    id: "11111111-1111-1111-1111-111111111111",
    ownerUsername: "alice",
    originalName: "contract.pdf",
    storedName: "source.pdf",
    filePath: "storage/contracts/x/source.pdf",
    size: 10,
    mimeType: "application/pdf",
    status: "queued",
    stage: "queued",
    progress: 0,
    error: null,
    parseModeRequested: "auto",
    parseBackendRequested: "cloud",
    sourceSha256: null,
    pageCount: 1
  });

  assert.match(
    lastQuery.text,
    /parse_backend_requested/
  );
  assert.ok(
    lastQuery.params.includes("cloud")
  );
});


test("createContract defaults missing backend to local", async () => {
  reset([{}]);

  await repository.createContract({
    id: "11111111-1111-1111-1111-111111111111",
    ownerUsername: "alice",
    originalName: "contract.pdf",
    storedName: "source.pdf",
    filePath: "storage/contracts/x/source.pdf",
    size: 10,
    mimeType: "application/pdf",
    status: "queued",
    stage: "queued",
    progress: 0,
    error: null,
    parseModeRequested: "auto"
  });

  assert.ok(
    lastQuery.params.includes("local")
  );
});


test("saveContractCredential stores ciphertext fields only", async () => {
  reset([{ contract_id: "x" }]);

  const ciphertext = Buffer.from("ciphertext");
  const iv = Buffer.alloc(12, 1);
  const authTag = Buffer.alloc(16, 2);
  const expiresAt = new Date("2026-10-20T00:00:00Z");

  await repository.saveContractCredential({
    contractId: "x",
    ownerUsername: "alice",
    ciphertext,
    iv,
    authTag,
    keyVersion: 1,
    expiresAt
  });

  assert.match(
    lastQuery.text,
    /INSERT INTO contract_credentials/
  );
  assert.match(
    lastQuery.text,
    /ciphertext/
  );
  assert.equal(
    lastQuery.params[2],
    ciphertext
  );
  assert.equal(lastQuery.params[3], iv);
  assert.equal(lastQuery.params[4], authTag);

  const serialized = JSON.stringify(
    lastQuery.params.map(value =>
      Buffer.isBuffer(value)
        ? value.toString("utf8")
        : String(value)
    )
  );

  assert.equal(
    serialized.includes("plaintext-token"),
    false
  );
});


test("deleteContractCredential scopes by contract id", async () => {
  reset();

  await repository.deleteContractCredential("x");

  assert.match(
    lastQuery.text,
    /DELETE FROM contract_credentials/
  );
  assert.match(lastQuery.text, /contract_id = \$1/);
  assert.deepEqual(lastQuery.params, ["x"]);
});


test("hardDeleteContract only removes soft-deleted rows", async () => {
  reset();

  await repository.hardDeleteContract("x");

  assert.match(
    lastQuery.text,
    /deleted_at IS NOT NULL/
  );
});
