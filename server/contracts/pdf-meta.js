"use strict";

const fs = require("fs");


/*
 * pdfjs-dist v6 ships ESM, so it is loaded lazily through a
 * dynamic import and cached for the process lifetime.
 */
let pdfjsPromise = null;


function loadPdfjs() {

  if (!pdfjsPromise) {

    pdfjsPromise =
      import(
        "pdfjs-dist/legacy/build/pdf.mjs"
      ).catch(
        error => {

          pdfjsPromise = null;

          throw error;

        }
      );

  }

  return pdfjsPromise;

}


/*
 * Best-effort input page count.
 *
 * Returns a positive integer, or null when the page count
 * cannot be established reliably. Callers must treat null as
 * "unknown" and must never fail the upload because of it.
 */
async function readPdfPageCount(
  filePath
) {

  try {

    const pdfjs =
      await loadPdfjs();


    const data =
      new Uint8Array(
        fs.readFileSync(
          filePath
        )
      );


    const document =
      await pdfjs.getDocument({

        data,

        useSystemFonts:
          false,

        isEvalSupported:
          false

      }).promise;


    const count =
      Number(
        document.numPages
      );


    try {

      if (
        typeof document.destroy ===
        "function"
      ) {

        await document.destroy();

      } else if (
        typeof document.cleanup ===
        "function"
      ) {

        document.cleanup();

      }

    } catch (_) {
      // Ignore cleanup errors.
    }


    return (
      Number.isFinite(count)
      &&
      count > 0
    )
      ? count
      : null;


  } catch (error) {

    console.error(
      "[contract pdf meta]",
      error.message
    );

    return null;

  }

}


module.exports = {
  readPdfPageCount
};
