# Test fixtures

Test data only. Never run, import, or deploy anything in this folder.

- `vulnerable/` holds **deliberately insecure** code samples that the scanner rules should flag.
- `corrected/` holds the safe equivalents that the scanner rules should NOT flag.
- Other folders are small fake projects used to test project detection.

No real credentials, real hosts, or real user data appear here. Secret-like test values are generated at test time and never committed.
