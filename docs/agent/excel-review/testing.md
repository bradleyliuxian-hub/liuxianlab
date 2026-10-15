# excel-review / testing

- Node: `node --test tests/excel-review/*.test.js` (also in `npm test`).
- Python: `.venv/bin/python -m unittest discover -s services/excel_review/tests -t .`.
- Use real `.xlsx` where behavior depends on OOXML (comments/threads).
- Never weaken a test to make a change pass; fix the code.

Read when: writing/repairing tests for this tool.
