// import_submission.js (with helper integration + close + lock issue)

const { Octokit } = require("@octokit/rest");
const matter = require("gray-matter");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const FileType = require("file-type");
const sharp = require("sharp");
const {
  slugifyTitle,
  isGitHubImageUrl,
  extractImageIndex
} = require("./import_helpers");

/**
 * Turn a GitHub Form upload page URL into the actual raw S3 blob URL
 */
function toRawUrl(url) {
  return url.startsWith("https://github.com/user-attachments/assets/")
    ? `${url}?raw=true`
    : url;
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function run() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const issueNumber = process.env.ISSUE_NUMBER;
  const body = process.env.ISSUE_BODY;
  const username = process.env.ISSUE_USER;
  let pr;

  try {
    const parsed = matter(body);
    const { data, content } = parsed;

    if (!data.submission) {
      console.error("Not a flagged submission. Aborting.");
      return;
    }

    const slug = slugifyTitle(data.title);
    const date = new Date().toISOString().split("T")[0];
    const postDir = path.join("content", "posts", `${date}-${slug}`);
    const imageDir = path.join(postDir, "images");

    fs.mkdirSync(imageDir, { recursive: true });

    // match inline images uploaded via the new Form host
    const imageRegex = /!\[(.*?)\]\((https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+)(?:\?raw=true)?\)/g;

    const images = [...content.matchAll(imageRegex)];

    let updatedContent = content;

    for (const [, alt, url] of images) {
      const rawUrl = toRawUrl(url);
      const res = await fetch(rawUrl, { redirect: "follow" });
      if (!res.ok) throw new Error(`Failed to fetch image: ${rawUrl}`);

      const buffer = await res.buffer();
      const type = await FileType.fromBuffer(buffer);
      if (!type || !["image/png", "image/jpeg"].includes(type.mime)) {
        throw new Error(`Invalid MIME type for image: ${type?.mime}`);
      }

      const base = path.basename(new URL(url).pathname);
      const filename = `${base}.${type.ext}`;

      const localPath = `./images/${filename}`;
      const fullLocalPath = path.join(imageDir, filename);

      const cleaned = await sharp(buffer).toFormat(type.ext).toBuffer();
      fs.writeFileSync(fullLocalPath, cleaned);

      updatedContent = updatedContent.replace(url, localPath);
    }

    const rawFeat = toRawUrl(data.featuredImage);
    const featRes = await fetch(rawFeat, { redirect: "follow" });
    if (!featRes.ok) throw new Error(`Failed to fetch featured image: ${rawFeat}`);
    const featBuf = await featRes.buffer();
    const featType = await FileType.fromBuffer(featBuf);
    if (!featType || !["image/png", "image/jpeg"].includes(featType.mime)) {
      throw new Error(`Invalid MIME type for featured image: ${featType?.mime}`);
    }

    const finalFrontmatter = {
      title: data.title,
      description: data.description,
      author: data.author,
      subject: data.subject,
      featuredImage: `./images/${path.basename(new URL(data.featuredImage).pathname)}.${featType.ext}`,
      publishDate: date,
    };

    const finalMarkdown = matter.stringify(updatedContent, finalFrontmatter);
    fs.writeFileSync(path.join(postDir, "index.md"), finalMarkdown);

    pr = await octokit.pulls.create({
      owner,
      repo,
      title: `Blog Submission from @${username} — “${data.title}”`,
      head: `submissions/issue-${issueNumber}-${slug}`.substring(0, 60),
      base: "main",
      body: `This blog post was submitted via [issue #${issueNumber}](https://github.com/${owner}/${repo}/issues/${issueNumber}).\n\nPlease review the content and approve if ready to merge.`
    });

    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `✅ Submission has been converted into [PR #${pr.data.number}](${pr.data.html_url}).\n\nThis issue is now closed and locked. Please follow further discussion in the PR.`
    });

    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: ["imported"]
    });

    await octokit.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: "closed"
    });

    await octokit.issues.lock({
      owner,
      repo,
      issue_number: issueNumber,
      lock_reason: "resolved"
    });

    console.log(`✅ Imported submission to ${postDir}`);

  } catch (err) {
    console.error("❌ Import failed:", err);

    // ← NEW: comment back on the Issue
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `❌ Import failed: ${err.message}`
    });

    // ← NEW: add an “import-failed” label (create this label in your repo)
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: ["import-failed"]
    });

    // re‑throw so the Action still fails
    throw err;
  }
}

run().catch(() => process.exit(1));