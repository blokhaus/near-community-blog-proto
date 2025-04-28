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

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function run() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const issueNumber = process.env.ISSUE_NUMBER;

  const body = process.env.ISSUE_BODY;
  const username = process.env.ISSUE_USER;

  const parsed = matter(body);
  const { data, content } = parsed;

  if (!data.submission || data.submission !== true) {
    console.error("Not a flagged submission. Aborting.");
    return;
  }

  const slug = slugifyTitle(data.title);
  const date = new Date().toISOString().split("T")[0];
  const postDir = path.join("content", "posts", `${date}-${slug}`);
  const imageDir = path.join(postDir, "images");

  fs.mkdirSync(imageDir, { recursive: true });

  // match inline images uploaded via the new Form host
  const imageRegex = /!\[(.*?)\]\((https:\/\/github\.com\/user-attachments\/assets\/[^\s)]+)\)/g;

  const images = [...content.matchAll(imageRegex)];

  let updatedContent = content;

  for (const [match, alt, url] of images) {
    try {
      if (!isGitHubImageUrl(url)) {
        throw new Error(`Invalid image URL format or host: ${url}`);
      }

      const index = extractImageIndex(url);
      if (!index || index < 1 || index > 2) {
        throw new Error(`Image index out of range or invalid: ${url}`);
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);

      const buffer = await res.buffer();
      const type = await FileType.fromBuffer(buffer);
      if (!type || !["image/png", "image/jpeg"].includes(type.mime)) {
        throw new Error(`Invalid MIME type for image: ${type?.mime}`);
      }

      // attach the correct extension
      const base = path.basename(new URL(url).pathname);
      const filename = `${base}.${type.ext}`;

      const localPath = `./images/${filename}`;
      const fullLocalPath = path.join(imageDir, filename);

      const cleaned = await sharp(buffer).toFormat(type.ext).toBuffer();
      fs.writeFileSync(fullLocalPath, cleaned);

      updatedContent = updatedContent.replace(url, localPath);
    } catch (err) {
      console.error(`❌ Skipping image due to error: ${err.message}`);
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `⚠️ One of your images could not be imported: ${err.message}`
      });
      return;
    }
  }

  const finalFrontmatter = {
    title: data.title,
    description: data.description,
    author: data.author,
    subject: data.subject,
    // note: strip any query params, then add the same extension
    featuredImage: `./images/${path.basename(data.featuredImage)}.${FileType.fromBuffer
      ? (await FileType.fromBuffer(await fetch(data.featuredImage).then(r => r.buffer()))).ext
      : path.extname(data.featuredImage).slice(1)
      }`,
    publishDate: date,
  };

  const finalMarkdown = matter.stringify(updatedContent, finalFrontmatter);
  fs.writeFileSync(path.join(postDir, "index.md"), finalMarkdown);

  const pr = await octokit.pulls.create({
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
}

run().catch(err => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});