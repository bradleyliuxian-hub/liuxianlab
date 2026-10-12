"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");


const MAX_DRAFT_BYTES =
  5 * 1024 * 1024;


function getReviewPaths(
  root,
  contractId
) {

  const contractRoot =
    path.join(
      root,
      "storage",
      "contracts",
      contractId
    );


  const parsedDir =
    path.join(
      contractRoot,
      "parsed"
    );


  const finalDir =
    path.join(
      contractRoot,
      "final"
    );


  return {

    contractRoot,

    parsedDir,

    rawMarkdownPath:
      path.join(
        parsedDir,
        "document.raw.md"
      ),

    draftMarkdownPath:
      path.join(
        parsedDir,
        "document.draft.md"
      ),

    issuesPath:
      path.join(
        parsedDir,
        "issues.json"
      ),

    finalDir,

    finalMarkdownPath:
      path.join(
        finalDir,
        "document.md"
      )

  };

}


async function atomicWrite(
  filePath,
  content
) {

  await fsp.mkdir(
    path.dirname(
      filePath
    ),
    {
      recursive: true
    }
  );


  const tempPath =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;


  try {

    await fsp.writeFile(
      tempPath,
      content,
      "utf8"
    );


    await fsp.rename(
      tempPath,
      filePath
    );


  } catch (error) {

    await fsp.rm(
      tempPath,
      {
        force: true
      }
    );

    throw error;

  }

}


async function readDraft(
  root,
  contractId
) {

  const {
    draftMarkdownPath
  } = getReviewPaths(
    root,
    contractId
  );


  const content =
    await fsp.readFile(
      draftMarkdownPath,
      "utf8"
    );


  const stat =
    await fsp.stat(
      draftMarkdownPath
    );


  return {
    content,
    bytes:
      stat.size,
    updatedAt:
      stat.mtime.toISOString()
  };

}


async function writeDraft(
  root,
  contractId,
  content
) {

  if (
    typeof content !==
    "string"
  ) {

    throw new TypeError(
      "Draft content must be a string"
    );

  }


  if (
    !content.trim()
  ) {

    throw new Error(
      "Draft Markdown cannot be empty"
    );

  }


  const bytes =
    Buffer.byteLength(
      content,
      "utf8"
    );


  if (
    bytes >
    MAX_DRAFT_BYTES
  ) {

    const error =
      new Error(
        "Draft Markdown is too large"
      );

    error.code =
      "DRAFT_TOO_LARGE";

    throw error;

  }


  const {
    draftMarkdownPath
  } = getReviewPaths(
    root,
    contractId
  );


  const normalized =
    content.endsWith("\n")
      ? content
      : `${content}\n`;


  await atomicWrite(
    draftMarkdownPath,
    normalized
  );


  const stat =
    await fsp.stat(
      draftMarkdownPath
    );


  return {
    bytes:
      stat.size,
    updatedAt:
      stat.mtime.toISOString()
  };

}


async function readIssues(
  root,
  contractId
) {

  const {
    issuesPath
  } = getReviewPaths(
    root,
    contractId
  );


  try {

    const raw =
      await fsp.readFile(
        issuesPath,
        "utf8"
      );


    const document =
      JSON.parse(
        raw
      );


    if (
      !Array.isArray(
        document.issues
      )
    ) {

      document.issues =
        [];

    }


    return document;


  } catch (error) {

    if (
      error.code ===
      "ENOENT"
    ) {

      return {
        version: 1,
        status:
          "pending_review",
        issues: []
      };

    }


    throw error;

  }

}


async function saveIssues(
  root,
  contractId,
  document
) {

  const {
    issuesPath
  } = getReviewPaths(
    root,
    contractId
  );


  await atomicWrite(
    issuesPath,
    JSON.stringify(
      document,
      null,
      2
    ) + "\n"
  );

}


async function resolveIssue(
  root,
  contractId,
  issueId,
  {
    resolution = "confirmed",
    note = ""
  } = {}
) {

  const document =
    await readIssues(
      root,
      contractId
    );


  const issue =
    document.issues.find(
      item =>
        String(
          item.id
        ) ===
        String(
          issueId
        )
    );


  if (!issue) {

    const error =
      new Error(
        "Issue not found"
      );

    error.code =
      "ISSUE_NOT_FOUND";

    throw error;

  }


  issue.status =
    "resolved";

  issue.resolution =
    String(
      resolution ||
      "confirmed"
    );

  issue.note =
    String(
      note ||
      ""
    );

  issue.resolvedAt =
    new Date()
      .toISOString();


  const remaining =
    document.issues.filter(
      item =>
        item.status !==
        "resolved"
    ).length;


  document.status =
    remaining === 0
      ? "reviewed"
      : "pending_review";


  document.updatedAt =
    new Date()
      .toISOString();


  await saveIssues(
    root,
    contractId,
    document
  );


  return {
    issue,
    remaining,
    documentStatus:
      document.status
  };

}


async function finalizeDraft(
  root,
  contractId
) {

  const {
    draftMarkdownPath,
    finalMarkdownPath
  } = getReviewPaths(
    root,
    contractId
  );


  const content =
    await fsp.readFile(
      draftMarkdownPath,
      "utf8"
    );


  if (
    !content.trim()
  ) {

    throw new Error(
      "Draft Markdown cannot be empty"
    );

  }


  await atomicWrite(
    finalMarkdownPath,
    content
  );


  const stat =
    await fsp.stat(
      finalMarkdownPath
    );


  return {
    path:
      finalMarkdownPath,
    bytes:
      stat.size,
    updatedAt:
      stat.mtime.toISOString()
  };

}


module.exports = {
  getReviewPaths,
  readDraft,
  writeDraft,
  readIssues,
  saveIssues,
  resolveIssue,
  finalizeDraft
};
