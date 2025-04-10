// scripts/validate_submission.js (refactored for testability with retry and issue state handling)

const { Octokit } = require("@octokit/rest");
const matter = require("gray-matter");
const MarkdownIt = require("markdown-it");

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
const INLINE_IMAGE_REGEX = /!\[[^\]]*\]\((https:\/\/user-images\.githubusercontent\.com\/[^\s)]+)\)/g;
const FEATURED_IMAGE_REGEX = /^https:\/\/user-images\.githubusercontent\.com\/.*\/featured-[\w-]+\.(png|jpg)$/;
const IMAGE_NAME_PATTERN = /^https:\/\/user-images\.githubusercontent\.com\/.*\/image-(\d+)\.(png|jpg)$/;

function validateFrontmatter(data) {
  const errors = [];
  const allowedFields = ["title", "description", "author", "subject", "featuredImage", "submission"];
  const unexpectedFields = Object.keys(data).filter(key => !allowedFields.includes(key));

  if (unexpectedFields.length > 0) {
    errors.push(`Unexpected fields in frontmatter: ${unexpectedFields.join(", ")}`);
  }

  // Initialize markdown-it with html enabled (so we can detect it)
  const md = new MarkdownIt({ html: true });

  // Helper function to validate a field for raw HTML
  function validateField(fieldName, fieldValue) {
    if (!fieldValue || typeof fieldValue !== "string") {
      errors.push(`Invalid or missing ${fieldName}.`);
      return;
    }

    // Parse the field value into tokens
    const tokens = md.parse(fieldValue, {});

    // Check for raw HTML tokens
    const hasRawHtml = tokens.some(token => token.type === "html_block" || token.type === "html_inline");

    if (hasRawHtml) {
      errors.push(`Raw HTML is not allowed in the ${fieldName} field.`);
    }
  }

  // Validate each frontmatter field
  if (data.title) validateField("title", data.title);
  if (data.description) validateField("description", data.description);
  if (data.author) validateField("author", data.author);

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
    return { valid: false, errors };
  }

  // Initialize markdown-it with html enabled (so we can detect it)
  const md = new MarkdownIt({ html: true });

  // Parse the content into tokens
  const tokens = md.parse(content, {});

  // Check for raw HTML tokens
  const hasRawHtml = tokens.some(token => token.type === "html_block" || token.type === "html_inline");

  if (hasRawHtml) {
    errors.push("Raw HTML tags are not allowed. Please remove any HTML from your Markdown content.");
    return { valid: false, errors };
  }

  // Additional validation for images
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
  const labels = issue.labels.map(label => label.name);

  if (issue.state === "closed") return;

  if (labels.includes("valid-submission")) return;

  const { data: allIssues } = await octokit.issues.listForRepo({
    owner,
    repo,
    state: "open",
    creator: issueUser
  });

  const submissionIssues = allIssues.filter(i =>
    i.labels.some(label => label.name === "blog-submission")
  );

  const validIssues = submissionIssues.filter(i =>
    i.labels.some(label => label.name === "valid-submission")
  );

  if (validIssues.length > 0) {
    return await reject("You already have a blog submission under review. Please wait until it is resolved.");
  }

  const invalidIssues = submissionIssues.filter(i =>
    i.labels.some(label => label.name === "invalid")
  );

  if (invalidIssues.length >= 100) {
    return await reject("You have reached the limit of 100 invalid submissions. Please review the feedback and correct your submissions.");
  }

  let parsed;
  try {
    parsed = matter(issueBody);
  } catch (e) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `❌ Unable to parse your submission. Please ensure it includes valid frontmatter and Markdown.`
    });

    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: ["invalid"]
    });

    console.error("Error parsing submission:", e);
    return;
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

  if (labels.includes("invalid")) {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: "invalid"
    });
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

async function reject(reason) {
  console.error(`Validation failed for issue #${process.env.ISSUE_NUMBER}:`, reason);

  // Add a comment to the issue
  await octokit.issues.createComment({
    owner: process.env.GITHUB_REPOSITORY.split("/")[0],
    repo: process.env.GITHUB_REPOSITORY.split("/")[1],
    issue_number: process.env.ISSUE_NUMBER,
    body: `❌ Submission rejected: ${reason}`
  });

  process.exit(1);
}

module.exports = {
  validateFrontmatter,
  validateMarkdownContent
};
