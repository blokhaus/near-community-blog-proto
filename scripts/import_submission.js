// import_submission.js (with helper integration)

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

  const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
  const body = issue.body;
  const username = issue.user.login;

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

  const imageRegex = /!\[(.*?)\]\((https:\/\/user-images\.githubusercontent\.com\/[^)]+)\)/g;
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

      const image = sharp(buffer);
      const metadata = await image.metadata();
      const ratio = metadata.width / metadata.height;
      if (Math.abs(ratio - 16 / 9) > 0.05) {
        throw new Error(`Image must be 16:9 ratio. Found: ${metadata.width}x${metadata.height}`);
      }

      const filename = path.basename(new URL(url).pathname);
      const localPath = `./images/${filename}`;
      const fullLocalPath = path.join(imageDir, filename);

      const cleaned = await image.toFormat(type.ext).toBuffer();
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
    featuredImage: `./images/${path.basename(data.featuredImage)}`,
    publishDate: date,
  };

  const finalMarkdown = matter.stringify(updatedContent, finalFrontmatter);
  fs.writeFileSync(path.join(postDir, "index.md"), finalMarkdown);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `✅ Submission imported to \`${postDir}/index.md\`. Ready for publication.`
  });

  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: ["imported"]
  });

  console.log(`✅ Imported submission to ${postDir}`);
}

run().catch(err => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});
