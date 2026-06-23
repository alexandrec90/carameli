# Known fixes — fix-instructions

Recurring eval signals and the instruction-file edit that resolves them. The skill
checks this table in Step 1 (parallel read) and applies a matching edit as a one-shot
short-circuit instead of re-deriving it.

- **Eval signal** is a plain substring to look for in a task's delta (e.g. a metric
  pattern or a task name), not a regex.
- Bump **Hits** / **Last used** on every match. Add rows only for signals likely to
  recur. Prune rows with **Hits = 0** older than 90 days from **Added**.

| Eval signal (substring) | Root cause | Instruction edit | Hits | Last used | Added |
|---|---|---|---|---|---|
| _(none yet — populated as recurring signals appear)_ | | | | | |
