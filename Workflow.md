# 🧪 Submission Workflow & Validation Rules

This document outlines how the blog submission system works — from intake to approval — and defines the validation rules enforced during the process.

---

## 🧭 Workflow Overview

1. **User opens a GitHub Issue** using the blog submission template
2. **GitHub Action runs validation** via `scripts/validate_submission.js`
3. If valid:
   - The issue is labeled `valid-submission`
   - A second step of the GitHub Action further optimizes the content, creates a new branch + pull request
4. **Reviewers approve or edit the PR**
5. **Merged PR** adds content to `content/posts/YYYY-MM-DDThh-mm-ss-sssZ-<slug>/` on the default branch.

Downstream from here:
6. **Frontend Blog Code**  incorporates the approved post to the NEAR blog community section.

---

## 📦 Submission Format

Submissions must include:

### ✅ Required Submission Fields
Posts should include the fields defined in the blog submission issue template. Those fields will be used to generate the frontmatter in the published Markdown:
```yaml
---
title: "Why I Love NEAR"
description: "Exploring what makes NEAR special"
author: "Jane Doe"
subject: "Community"
featuredImage: "https://github.com/user-attachments/assets/<hash>?raw=true"
submission: true
---
```

### ✅ Markdown Content
```markdown
## Why I Love NEAR

NEAR is fast, simple, and scalable.

![Diagram](https://github.com/user-attachments/assets/<hash>?raw=true)
```

---

## ✅ Validation Rules

### Frontmatter:
- `title`: max 100 characters, no control/invisible characters
- `description`: max 300 characters, same constraints
- `author`: must be present, clean, at most 100 characters
- `subject`: must be one of:
  - `Community`, `Developers`, `Ecosystem`, `DAOs`, `NFTs`, `Gaming`, `Web3 Gaming`, `User-Owned AI`
- `featuredImage`: must be GitHub-hosted and a valid URL (added via the issue editor)
- `submission`: must be `true`

### Markdown Content:
- Must be present
- Must not contain raw HTML (`<div>`, `<script>`, etc.)
- May include up to two inline images:
  - Hosted on GitHub Form assets (`user-attachments/assets/<hash>`)
  - No fixed filename pattern required
  - Inserted via the issue editor (drag & drop)

---

## 🔐 Safety Checks

- Detects control characters and Unicode obfuscation (`\x00`–`\x1F`, `\u200B`, etc.)
- Rejects invalid URLs, mismatched image names, or excess image count
- Validates that all referenced images align with naming and upload expectations

---

## 🛠 Pull Request Generation

Once labeled `valid-submission`, a GitHub Action:
  - Creates a new branch of the form  
    `submissions/issue-<ISSUE_NUMBER>-<ISO_TIMESTAMP>-<SLUG>`
  - Commits sanitized content under `content/posts/<folder>/…`
  - Opens a PR against the default branch

The PR includes:
  - `index.md` with clean frontmatter + post body
  - an `images/` directory of optimized assets

---

## ✅ Final Approval

Once a reviewer approves and merges the PR:
- The post lives in `content/posts/<date>-<timestamp>-<slug>/`  
  (e.g. `content/posts/2025-05-01T12-34-56-789Z-why-i-love-near`)
- The issue is labeled `imported`

From there, the post is ready to be published or exported by downstream systems.
