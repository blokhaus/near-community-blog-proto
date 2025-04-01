# 🧪 Submission Workflow & Validation Rules

This document outlines how the blog submission system works — from intake to approval — and defines the validation rules enforced during the process.

---

## 🧭 Workflow Overview

1. **User opens a GitHub Issue** using the blog submission template
2. **GitHub Action runs validation** via `scripts/validate_submission.js`
3. If valid:
   - The issue is labeled `valid-submission`
   - A second GitHub Action creates a new branch + pull request
4. **Reviewers approve or edit the PR**
5. **Merged PR** adds content to `content/posts/YYYY-MM-DD-title/`

---

## 📦 Submission Format

Submissions must include:

### ✅ Frontmatter (YAML)
```yaml
---
title: "Why I Love NEAR"
description: "Exploring what makes NEAR special"
author: "Jane Doe"
subject: "Community"
featuredImage: "https://user-images.githubusercontent.com/.../featured-near.png"
submission: true
---
```

### ✅ Markdown Content
```markdown
## Why I Love NEAR

NEAR is fast, simple, and scalable.

![Diagram](https://user-images.githubusercontent.com/.../image-1.png)
```

---

## ✅ Validation Rules

### Frontmatter:
- `title`: max 100 characters, no control/invisible characters
- `description`: max 300 characters, same constraints
- `author`: must be present, clean
- `subject`: must be one of:
  - `Community`, `Developers`, `Ecosystem`, `DAOs`, `NFTs`, `Gaming`, `Web3 Gaming`, `User-Owned AI`
- `featuredImage`: must be GitHub-hosted and start with `featured-`
- `submission`: must be `true`

### Markdown Content:
- Must be present
- Must not contain raw HTML (`<div>`, `<script>`, etc.)
- Must contain 1–2 inline images, each:
  - Hosted on GitHub (`user-images.githubusercontent.com`)
  - Named as `image-1.png`, `image-2.jpg`, etc.
  - Must not exceed the maximum count
  - Must match image index and order

---

## 🔐 Safety Checks

- Detects control characters and Unicode obfuscation (`\x00`–`\x1F`, `\u200B`, etc.)
- Rejects invalid URLs, mismatched image names, or excess image count
- Validates that all referenced images align with naming and upload expectations

---

## 🛠 Pull Request Generation

Once labeled `valid-submission`, a GitHub Action:
- Creates a new branch: `submissions/issue-123-title`
- Commits sanitized content to `content/posts/...`
- Opens a PR targeting `main`

The PR includes:
- `index.md` with clean frontmatter and Markdown
- `images/` folder with re-encoded, resized images

---

## 📄 PR Preview

On PR open, a GitHub Action:
- Renders the post to HTML
- Uploads it as an artifact
- Comments with a preview link

This allows reviewers to check layout and content before merging.

---

## ✅ Final Approval

Once a reviewer approves and merges the PR:
- The post lives in `content/posts/YYYY-MM-DD-title/`
- The issue is labeled `imported`

From there, the post is ready to be published or exported by downstream systems.
