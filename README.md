# ✍️ NEAR Community Blog

Welcome to the official community-powered blog for the NEAR ecosystem. This repository serves as the central platform for:

- ✨ Submitting community blog posts
- ✅ Validating and reviewing content
- 📦 Producing clean, structured Markdown for publication

This system is GitHub-native and ensures quality, transparency, and editorial control — with a submission process designed for openness and trust.

---

## ✍️ How to Submit a Blog Post

Anyone can submit a blog post by opening a [new issue](../../issues/new/choose) using the **Blog Submission** template.

Submissions must:
- Be written in Markdown
- Include a properly formatted frontmatter block
- Follow our [content guidelines](Workflow.md)

Submissions are automatically validated and, if successful, converted into a pull request for human review.

---

## 🔁 Submission Lifecycle

1. **Open an Issue** using the blog submission form
2. **Validation** runs via GitHub Actions
3. **Feedback** is posted if issues are found
4. **Valid submissions** are turned into pull requests
5. **Approvers** review and merge content
6. **Merged posts** live in `content/posts/`

---

## 🧠 Project Structure

| Path                          | Purpose |
|-------------------------------|---------|
| `.github/ISSUE_TEMPLATE/`     | Submission & general issue forms |
| `.github/workflows/`          | GitHub Actions for validation, import, and preview |
| `scripts/`                    | Validation and import scripts (Node.js) |
| `content/posts/`              | Where approved posts live (Markdown + images) |

---

## 🧪 Maintainer Guide

For a full breakdown of how validation, approval, and pull request workflows operate, see:

📘 [Workflow.md](./Workflow.md)

---

## 🌐 Presentation & Frontend

This repository is focused on managing the submission and editorial process.

> The frontend or publishing system that ultimately displays these posts may vary over time.

Content in `content/posts/` is structured and ready to be consumed by downstream systems, including static site generators, APIs, or any custom frontend tooling.

---

## ❤️ Contributing

We welcome thoughtful, positive contributions from across the NEAR community. If you're ready to share your experience, idea, or story — [submit a post](../../issues/new/choose)!
