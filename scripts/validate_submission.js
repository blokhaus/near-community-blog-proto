// scripts/validate_submission.js (refactored for testability)

const { Octokit } = require("@octokit/rest");
const matter = require("gray-matter");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const SUBJECT_WHITELIST = [
  "Community",
  "Developers",
  "Ecosystem",
  "DAOs",
  "NFTs",
  "Gaming",
  "Web3 Gaming",
  "User-Owned AI"
];

const MAX_IMAGE_COUNT = 2;
const INVALID_CHARS_REGEX = /[\x00-\x1F\x7F\u200B\u202E]/g;
const RAW_HTML_TAGS = /<[^>]+>/g;
const INLINE_IMAGE_REGEX = /!\[[^\]]*\]\((https:\/\/user-images\.githubusercontent\.com\/[^\s)]+)\)/g;
const FEATURED_IMAGE_REGEX = /^https:\/\/user-images\.githubusercontent\.com\/.*\/featured-[\w-]+\.(png|jpg)$/;
const IMAGE_NAME_PATTERN = /^https:\/\/user-images\.githubusercontent\.com\/.*\/image-(\d+)\.(png|jpg)$/;

function validateFrontmatter(data) {
  const errors = [];

  if (!data.title || typeof data.title !== "string" || data.title.length > 100 || INVALID_CHARS_REGEX.test(data.title)) {
    errors.push("Invalid or missing title (max 100 chars, no control/invisible characters).");
  }

  if (!data.description || typeof data.description !== "string" || data.description.length > 300 || INVALID_CHARS_REGEX.test(data.description)) {
    errors.push("Invalid or missing description (max 300 chars, no control/invisible characters).");
  }

  if (!data.author || typeof data.author !== "string" || INVALID_CHARS_REGEX.test(data.author)) {
    errors.push("Missing or invalid author (no control/invisible characters).");
  }

  if (!data.subject || !SUBJECT_WHITELIST.includes(data.subject)) {
    errors.push(`Invalid subject tag. Allowed values: ${SUBJECT_WHITELIST.join(", ")}`);
  }

  if (!data.featuredImage || !FEATURED_IMAGE_REGEX.test(data.featuredImage)) {
    errors.push("Missing or invalid featuredImage (must be GitHub-hosted and start with 'featured-').");
  }

  if (data.submission !== true) {
    errors.push("Missing or invalid 'submission: true' flag in frontmatter.");
  }

  return { valid: errors.length === 0, errors };
}

function validateMarkdownContent(content) {
  const errors = [];

  if (!content || typeof content !== "string") {
    errors.push("Missing Markdown body content.");
  }

  if (RAW_HTML_TAGS.test(content)) {
    errors.push("HTML tags detected. Only Markdown syntax is allowed.");
  }

  const imageMatches = [...content.matchAll(INLINE_IMAGE_REGEX)].map(match => match[1]);

  if (imageMatches.length > MAX_IMAGE_COUNT) {
    errors.push(`Too many images used: found ${imageMatches.length}, max allowed is ${MAX_IMAGE_COUNT}.`);
  }

  const usedIndices = new Set();

  for (const url of imageMatches) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== "user-images.githubusercontent.com" || parsedUrl.search || parsedUrl.hash) {
        errors.push(`Image URL is not clean or not from GitHub: ${url}`);
        continue;
      }

      const match = url.match(IMAGE_NAME_PATTERN);
      if (!match) {
        errors.push(`Image URL does not follow required naming pattern: ${url}`);
        continue;
      }

      const index = parseInt(match[1], 10);
      if (index > MAX_IMAGE_COUNT || index < 1) {
        errors.push(`Image index out of allowed range: image-${index}`);
      } else {
        usedIndices.add(index);
      }
    } catch (e) {
      errors.push(`Invalid image URL: ${url}`);
    }
  }

  if (usedIndices.size > imageMatches.length) {
    errors.push("Mismatch between used image references and uploaded image indices.");
  }

  return { valid: errors.length === 0, errors };
}

// GitHub Action Entry Point
if (require.main === module) {
  run().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
  });
}

async function run() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const issueNumber = process.env.ISSUE_NUMBER;

  const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
  const issueBody = issue.body;
  const issueUser = issue.user.login;

  const { data: allIssues } = await octokit.issues.listForRepo({
    owner,
    repo,
    state: "open",
    creator: issueUser
  });

  const userIssues = allIssues.filter(i => i.number !== issueNumber);
  if (userIssues.length > 0) {
    return reject("You already have an open submission. Please wait until it is resolved.");
  }

  let parsed;
  try {
    parsed = matter(issueBody);
  } catch (e) {
    return reject("Unable to parse your submission. Please ensure it includes valid frontmatter and Markdown.");
  }

  const frontmatterResult = validateFrontmatter(parsed.data);
  const contentResult = validateMarkdownContent(parsed.content);
  const allErrors = [...frontmatterResult.errors, ...contentResult.errors];

  if (allErrors.length > 0) {
    const message = `❌ Submission validation failed:\n\n- ${allErrors.join("\n- ")}`;
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body: message });
    await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: ["invalid"] });
    return;
  }

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `✅ Your submission has passed initial validation and is under review.`
  });

  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: ["valid-submission"]
  });
}

function reject(reason) {
  console.error("Validation failed:", reason);
  process.exit(1);
}

module.exports = {
  validateFrontmatter,
  validateMarkdownContent
};
