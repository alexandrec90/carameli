---
name: audit-skills
disable-model-invocation: true
description: Audits Claude Skills for adherence to Anthropic's best practices and Carameli authoring conventions. Use when reviewing SKILL.md files, directory structures, or skill implementations to ensure they are concise, discoverable, and effective.
argument-hint: 'Optional: skill name to audit (e.g., "add-endpoint"), or omit to audit all skills'
---

# Audit Skills

Evaluate and refine Claude Skills against the checklists below. After scoring, offer to apply fixes and re-audit.

## Audit Workflow

1. **Analyze Metadata**: Check YAML frontmatter for description compliance.
2. **Review Body Content**: Assess conciseness and the "Smart Claude" assumption.
3. **Inspect Architecture**: Evaluate progressive disclosure patterns and file depth.
4. **Evaluate Workflows**: Look for checklists and feedback loops for complex tasks.
5. **Check Project Conventions**: Verify Carameli-specific rules from `.claude/rules/authoring.md`.
6. **Score & Recommend**: Provide a final assessment and specific refactoring suggestions.
7. **Fix & Re-audit**: If issues found, offer to apply fixes, then re-run the checklist to confirm.

## 1. Metadata & Structure Checklist

- [ ] **Name**: Must match the directory name. Lowercase, numbers, and hyphens only. Action-oriented (`add-endpoint`, `fix-tests`) or gerund form (`processing-pdfs`). No vague names (`helper`, `utils`).
- [ ] **Description**: Max 1024 characters. Written in **3rd person** ("Generates…", "Audits…" — not "Generate…" or "I can…").
- [ ] **"Use when" Clause**: Description includes a concrete trigger (e.g., "Use when introducing a new table or adding/changing columns").
- [ ] **Argument Hint**: Has an `argument-hint` field describing what arguments the skill accepts (or `'(no arguments)'` if none).

## 2. Core Principles (The "Concise" Test)

- [ ] **Conciseness**: Is the `SKILL.md` body under 500 lines?
- [ ] **Smart Claude Assumption**: Does it avoid explaining basic concepts (e.g., what a PDF is, how `pip` works)?
- [ ] **Token Efficiency**: Does every paragraph justify its token cost?
- [ ] **Degrees of Freedom**: Are instructions appropriately strict (low freedom for fragile tasks like migrations) or flexible (high freedom for creative tasks)?

## 3. Progressive Disclosure & Architecture

- [ ] **Reference Depth**: Are all referenced files exactly one level deep from `SKILL.md`? (Never `A -> B -> C`).
- [ ] **ToC**: If any reference file is >100 lines, does it have a Table of Contents at the top?
- [ ] **File Separation**: Are advanced features or API references moved to separate files to keep `SKILL.md` focused?
- [ ] **Path Format**: All file paths use forward slashes — never backslashes.

## 4. Operational Excellence

- [ ] **Checklist Pattern**: For multi-step workflows, does it provide a checklist for Claude to track progress?
- [ ] **Feedback Loops**: Does it implement "Run validator → fix errors → repeat" patterns for complex edits?
- [ ] **Templates/Examples**: Are there clear Input/Output pairs or templates for structured responses?

## 5. Project Conventions

- [ ] **Script Compliance**: If the skill generates scripts, do they follow PowerShell conventions from `.claude/rules/tooling.md`?
- [ ] **Time-Sensitivity**: No mentions of specific dates or "current" years that will expire.
- [ ] **Terminology**: Is the language consistent (e.g., always "endpoint," never switching to "route")?

## Grading Rubric

| Grade | Description |
| :--- | :--- |
| **Elite** | Extremely concise, uses progressive disclosure perfectly, includes validation loops. |
| **Functional** | Follows naming/description rules, but might be slightly verbose or lack workflows. |
| **Needs Refactor** | Violates naming rules, uses 1st person, or is too verbose with instructions. |
| **Critical** | Over 500 lines in `SKILL.md`, missing description, or uses deep nesting (>1 level). |
