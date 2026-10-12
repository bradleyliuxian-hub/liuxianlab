"use strict";

const {
  Pool
} = require("pg");


let pool = null;


function getPool() {

  if (pool) {
    return pool;
  }


  const connectionString =
    process.env.DATABASE_URL;


  if (!connectionString) {

    throw new Error(
      "DATABASE_URL is not configured"
    );

  }


  pool = new Pool({

    connectionString,

    max: 5,

    idleTimeoutMillis:
      30000,

    connectionTimeoutMillis:
      5000,

    application_name:
      "liuxianlab-contracts"

  });


  pool.on(
    "error",
    error => {

      console.error(
        "[postgres pool]",
        error
      );

    }
  );


  return pool;
}


async function query(
  text,
  params = []
) {

  return getPool().query(
    text,
    params
  );

}


async function pingDatabase() {

  const result =
    await query(
      `
      SELECT
        current_database()
          AS database_name,

        current_user
          AS database_user,

        NOW()
          AS server_time
      `
    );


  return result.rows[0];

}


async function closeDatabase() {

  if (!pool) {
    return;
  }


  const currentPool =
    pool;

  pool = null;

  await currentPool.end();

}


module.exports = {
  getPool,
  query,
  pingDatabase,
  closeDatabase
};
