# ✍️ NEAR Community Blog

Welcome to the official community-powered blog for the NEAR ecosystem. This repository serves as the central platform for:

- ✨ Submitting community blog posts
- ✅ Validating and reviewing content
- 📦 Producing clean, structured Markdown for publication

This system is GitHub-native and ensures quality, transparency, and editorial control — with a submission process designed for openness and trust.

---

## ✍️ How to Submit a Blog Post

Anyone with a GitHub account can submit a blog post by opening a [new issue](../../issues/new/choose) and selecting the **“Submit a Blog Post”** template.

Your submission will need to include:

- A title and short description
- Your name (or author handle)
- A topic category (selected from a list)
- A featured image URL
- Your article content in Markdown format

🛠 The system will automatically validate your submission. If it passes, a pull request will be created for editorial review.

---

## 🔁 Submission Lifecycle

1. **A user opens an Issue** using the provided template
2. **Validation scripts** check your input and content format
3. **If valid**, a pull request (PR) is automatically created
4. **Approvers review** the content in the PR
5. **If approved**, the PR is merged and the article is published live on the NEAR website

🗂️ Finalized content lives in content/posts/, ready for consumption by the frontend.

---

## 🧠 Project Structure

| Path                      | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `.github/ISSUE_TEMPLATE/` | Submission & general issue forms                   |
| `.github/workflows/`      | GitHub Actions for validation, import, and preview |
| `scripts/`                | Validation and import scripts (Node.js)            |
| `content/posts/`          | Where approved posts live (Markdown + images)      |

---

## 🧪 Maintainer Guide

For a breakdown of how validation, approval, and pull request workflows operate, see:

📘 [Workflow.md](./Workflow.md)

---

## 🌐 Publishing & Frontend INtegration

This repository is focused on managing the submission and editorial process.

> The frontend or publishing system that ultimately displays these posts may vary over time.

Content in `content/posts/` is structured and ready to be consumed by downstream systems, including static site generators, APIs, or any custom frontend tooling.

This repo does **not** contain frontend code.

---

## ❤️ Contributing

We welcome thoughtful, positive contributions from across the NEAR community. If you're ready to share your experience, idea, or story — [submit a post](../../issues/new/choose)!
