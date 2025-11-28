# Mosher Labs Basic Repo Template - Project Memory

This file contains persistent context for Claude Code sessions on this project.
It will be automatically loaded at the start of every session.

## Project Overview

This is a template repository for creating new Mosher Labs projects. It provides
a standardized starting point with pre-configured tooling and workflows.

**Key Details:**

- **Purpose:** Template for new repositories
- **CI/CD:** GitHub Actions with release workflow
- **Linting:** Pre-commit hooks for code quality
- **Pattern:** Fork or use as template, then customize

## Repository Structure

```text
basic-repo-template/
├── .github/workflows/     # CI/CD workflows
│   └── release.yml        # Semantic versioning & releases
├── .pre-commit-config.yaml
├── README.md
└── CLAUDE.md
```

## Using This Template

### Creating a New Repo

1. **Use as template:** Click "Use this template" on GitHub
1. **Clone locally:** `git clone <your-new-repo>`
1. **Update README.md:** Replace template content with project description
1. **Customize workflows:** Adjust `.github/workflows/` as needed
1. **Install pre-commit:** `pre-commit install`
1. **Create CLAUDE.md:** Document project-specific context

### Pre-configured Features

- **Release workflow:** Automatic semantic versioning from Conventional Commits
- **Pre-commit hooks:** YAML, Markdown, and commit message linting
- **GitHub Actions:** Ready to use CI/CD
- **Documentation:** README template with badges

## Git Workflow

1. **Create feature branch:** `git checkout -b feature/description`
1. **Make changes** to code or documentation
1. **ALWAYS run pre-commit BEFORE committing:** `pre-commit run --all-files`
   - Fix ALL errors (especially markdown and YAML formatting)
   - Do NOT commit with `--no-verify` unless absolutely necessary
1. **Commit with conventional format:** `git commit -m "type: description"`
1. **Push and create PR:** `gh pr create --title "feat: description"`
1. **Test changes:** If your changes reference shared workflows that were also updated,
   temporarily change the reference from `@main` to `@your-branch` to test, verify
   the PR passes, then change back to `@main` before merging
1. **Merge to main:** Automatic release created based on commits

**Commit Format:** Conventional Commits (enforced by pre-commit hook)

- `feat:` - New feature (triggers minor version bump)
- `fix:` - Bug fix (triggers patch version bump)
- `docs:` - Documentation changes (no version bump)
- `chore:` - Maintenance (no version bump)
- `refactor:` - Code refactoring (no version bump)
- `test:` - Temporary test changes (like branch references)

**Breaking changes:** Add `!` after type (e.g., `feat!:`) or include `BREAKING CHANGE:` in commit body for major version bump

## Pre-commit Hooks

**Installed hooks:**

- YAML linting (yamllint)
- Markdown linting (markdownlint)
- Conventional commit format
- File hygiene (trailing whitespace, EOF, etc.)

**Setup:**

```bash
pre-commit install              # One-time setup
pre-commit run --all-files      # Run manually
pre-commit autoupdate           # Update hook versions
```

## Important Notes

### Code Quality Standards

**CRITICAL:** All code must adhere to linter rules from the start. Do NOT write
code that needs fixing after running pre-commit hooks.

**Markdown (markdownlint):**

Configuration: `.markdownlint.yaml` (allows 2-space indent, 120 char lines)

- Nested lists under unordered items: Use 2-space indentation
- Nested lists under ordered items: Use 2-space indentation
- Inline format for simple nested items: `**Item:** Detail 1, Detail 2`
- Line length: 120 characters max (code/tables excluded)
- Bare URLs: Allowed in reference sections
- Bold for emphasis: Allowed in lists

**YAML (yamllint):**

- Maximum line length: 80 characters
- Use 2-space indentation
- No trailing whitespace
- Proper quoting for strings containing special characters

### When Working on This Repo

1. **Write linter-compliant code from the start** - Don't fix after the fact
1. **Run pre-commit hooks** BEFORE committing (fix all errors!)
1. **Follow Conventional Commits** - Enables automatic versioning
1. **Update CLAUDE.md** - Document important project context
1. **Test shared workflow changes** - Use branch references before merging

## References

- @README.md - Repository overview
- Shared Workflows: <https://github.com/Mosher-Labs/.github>
- Conventional Commits: <https://www.conventionalcommits.org/>

---

**Last Updated:** 2025-11-18

This file should be updated whenever:

- Project patterns change
- Important context is discovered
- Tooling is added or modified
