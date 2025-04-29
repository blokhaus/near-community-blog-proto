// scripts/validate_submission.js (refactored for testability with retry and issue state handling)

const { Octokit } = require("@octokit/rest");
const matter = require("gray-matter");
const MarkdownIt = require("markdown-it");
const { formToFrontmatter } = require("./import_helpers");
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
const INVALID_CHARS_REGEX = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F\u200B\u202E]/g;
const INLINE_IMAGE_REGEX = /!\[[^\]]*\]\((https:\/\/github\.com\/user-attachments\/assets\/[^\s)]+)\)/g;
// allow optional ?raw=true at end
const ASSET_URL_REGEX = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+(?:\?raw=true)?$/;

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

  if (!data.title
    || data.title.length > 100
    || INVALID_CHARS_REGEX.test(data.title)
  ) {
    errors.push("Invalid or missing title (max 100 chars, no control/invisible characters).");
  }

  if (!data.description
    || data.description.length > 300
    || INVALID_CHARS_REGEX.test(data.description)
  ) {
    errors.push("Invalid or missing description (max 300 chars, no control/invisible characters).");
  }

  if (!data.author
    || INVALID_CHARS_REGEX.test(data.author)
  ) {
    errors.push("Missing or invalid author (no control/invisible characters).");
  }

  if (!data.subject || !SUBJECT_WHITELIST.includes(data.subject)) {
    errors.push(`Invalid subject tag. Allowed values: ${SUBJECT_WHITELIST.join(", ")}`);
  }

  if (!data.featuredImage || !ASSET_URL_REGEX.test(data.featuredImage)) {
    errors.push("Missing or invalid Featured Image URL (must be a GitHub Form upload URL).");
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

  // Reject control / invisible characters in the body
  if (INVALID_CHARS_REGEX.test(content)) {
    errors.push("Blog content contains invalid control or invisible characters.");
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

  for (const url of imageMatches) {
    if (!ASSET_URL_REGEX.test(url)) {
      errors.push(`Invalid inline image URL: ${url}`);
      continue;
    }
  }

  const totalImages = imageMatches.length + 1; // +1 for featured
  if (totalImages > 3) {
    errors.push(`Too many images total: found ${totalImages}, max 3 allowed.`);
  }

  return { valid: errors.length === 0, errors };
}

/** 
 * HEAD‐check (with GET fallback) to confirm Content‐Type=image/* 
 */
async function isImageUrl(url) {
  // 1) Point at the raw blob endpoint
  const rawUrl = url.startsWith("https://github.com/user-attachments/assets/")
    ? `${url}?raw=true`
    : url;

  // 2) Try HEAD first, following any redirects
  let res = await fetch(rawUrl, {
    method: "HEAD",
    redirect: "follow"
  });

  // 3) If HEAD is forbidden (403), not OK, or still a redirect, fallback to GET
  if (!res.ok || (res.status >= 300 && res.status < 400)) {
    res = await fetch(rawUrl, {
      method: "GET",
      redirect: "follow"
    });
  }

  // 4) Finally, confirm it’s an image
  const ct = res.headers.get("content-type") || "";
  return ct.startsWith("image/");
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

  // SMALL CHANGE: if there's no YAML front‑matter, wrap Form sections
  const raw = issueBody.trim().startsWith("---")
    ? issueBody
    : formToFrontmatter(issue);

  let parsed;
  try {
    parsed = matter(raw);
  } catch (e) {
    // on parse‐error, label + comment & exit non‑zero
    await octokit.issues.createComment({
      owner, repo, issue_number: issueNumber,
      body: `❌ Unable to parse your submission. Please ensure it includes valid frontmatter and Markdown.`
    });
    await octokit.issues.addLabels({
      owner, repo, issue_number: issueNumber,
      labels: ["invalid"]
    });
    return await reject("Unable to parse submission");
  }

  const frontmatterResult = validateFrontmatter(parsed.data);
  const contentResult = validateMarkdownContent(parsed.content);
  let allErrors = [...frontmatterResult.errors, ...contentResult.errors];

  // only if no sync errors do we do the HEAD check
  if (allErrors.length === 0) {
    // Featured image HEAD check
    if (!(await isImageUrl(parsed.data.featuredImage))) {
      allErrors.push("Featured Image URL did not return image Content-Type");
    }
    // Inline images HEAD check
    const inlineUrls = [...parsed.content.matchAll(INLINE_IMAGE_REGEX)].map(m => m[1]);
    for (const url of inlineUrls) {
      if (!(await isImageUrl(url))) {
        allErrors.push(`Inline image URL is not an image: ${url}`);
      }
    }
  }

  if (allErrors.length > 0) {
    // ❌ comment + label invalid, then abort with an exception
    await octokit.issues.createComment({
      owner, repo, issue_number: issueNumber,
      body: `❌ Submission validation failed:\n\n- ${allErrors.join("\n- ")}`
    });
    await octokit.issues.addLabels({
      owner, repo, issue_number: issueNumber,
      labels: ["invalid"]
    });
    throw new Error("Submission validation failed");
  }

  // —— RESTORE this block so fixing an invalid submission clears the label ——  
  if (labels.includes("invalid")) {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: "invalid"
    });
  }

  // ✅ now comment & label valid
  await octokit.issues.createComment({
    owner, repo, issue_number: issueNumber,
    body: `✅ Your submission has passed initial validation and is under review.`
  });
  await octokit.issues.addLabels({
    owner, repo, issue_number: issueNumber,
    labels: ["valid-submission"]
  });

  // lock issue to prevent further edits after validation
  await octokit.issues.lock({
    owner,
    repo,
    issue_number: issueNumber,
    lock_reason: "resolved"
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
