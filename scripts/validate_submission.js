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
// allow optional ?raw=true at end
const ASSET_URL_REGEX = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+(?:\?raw=true)?$/;

/**
 * Escape Markdown‐sensitive characters in a string
 */
function esc(str) {
  return String(str).replace(/([\\`*_[\]()>~])/g, "\\$1");
}

// 1) single shared parser
const md = new MarkdownIt({ html: true });

function validateFrontmatter(data) {
  const errors = [];
  const allowedFields = ["title", "description", "author", "subject", "featuredImage", "submission"];
  const unexpectedFields = Object.keys(data).filter(key => !allowedFields.includes(key));

  if (unexpectedFields.length > 0) {
    errors.push(`Unexpected fields in frontmatter: ${unexpectedFields.join(", ")}`);
  }

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
    || data.author.length > 100
    || INVALID_CHARS_REGEX.test(data.author)
  ) {
    errors.push("Missing or invalid author (max 100 chars, no control/invisible characters).");
  }

  if (!data.subject || !SUBJECT_WHITELIST.includes(data.subject)) {
    errors.push(`Invalid subject tag. Allowed values: ${SUBJECT_WHITELIST.join(", ")}`);
  }

  if (!data.featuredImage || !ASSET_URL_REGEX.test(data.featuredImage)) {
    errors.push("Missing or invalid Featured Image URL (must be a GitHub Form upload URL).");
  }

  if (!data.submission) {
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

  // using shared `md`
  const tokens = md.parse(content, {});

  // Check for raw HTML tokens
  const hasRawHtml = tokens.some(token => token.type === "html_block" || token.type === "html_inline");

  if (hasRawHtml) {
    errors.push("Raw HTML tags are not allowed. Please remove any HTML from your Markdown content.");
    // continue collecting other errors rather than returning early
  }

  // --- only enforce host‑pattern on every real Markdown image token ---
  // using shared `md` for image tokens
  const toksImg = md.parse(content, {});
  const inlineUrls = [];
  (function walk(nodes) {
    for (const t of nodes) {
      if (t.type === "image") {
        const src = t.attrGet("src");
        if (src) inlineUrls.push(src);
      }
      if (t.children) walk(t.children);
    }
  })(toksImg);

  // each URL must be a GitHub form upload
  for (const url of inlineUrls) {
    if (!ASSET_URL_REGEX.test(url)) {
      errors.push(`Invalid inline image URL: ${url}`);
    }
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

  // 3) HEAD/GET with 5 s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    let res = await fetch(rawUrl, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (!res.ok || (res.status >= 300 && res.status < 400)) {
      res = await fetch(rawUrl, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") || "";
    return ct.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
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

  // 🚀 fetch ALL open issues by this user (not just the first page)
  const allIssues = await octokit.paginate(
    octokit.issues.listForRepo,
    {
      owner,
      repo,
      state: "open",
      creator: issueUser,
      per_page: 100
    }
  );

  const submissionIssues = allIssues.filter(i =>
    i.labels.some(label => label.name === "blog-submission")
  );

  const validIssues = submissionIssues.filter(i =>
    i.labels.some(label => label.name === "valid-submission")
  );

  // Allow up to three simultaneous valid submissions per user
  if (validIssues.length >= 3) {
    return await reject(
      `You already have ${validIssues.length} blog submissions under review. The maximum allowed is 3.`
    );
  }

  const invalidIssues = submissionIssues.filter(i =>
    i.labels.some(label => label.name === "invalid")
  );

  if (invalidIssues.length >= 100) {
    return await reject("You have reached the limit of 100 invalid submissions. Please review the feedback and correct your submissions.");
  }

  // Always convert the GitHub Form inputs into front‑matter
  let raw;
  try {
    raw = formToFrontmatter(issue);
  } catch (e) {
    return await reject(
      "Unable to convert form input into frontmatter: " + e.message
    );
  }

  let parsed;
  try {
    parsed = matter(raw);
  } catch (e) {
    return await reject("Unable to parse frontmatter: " + e.message);
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
    // Inline images HEAD check & count vs. featuredImage
    // reuse shared `md` for inline images
    const toks2 = md.parse(parsed.content, {});
    const inline = [];
    (function walk(nodes) {
      for (const t of nodes) {
        if (t.type === "image") {
          const s = t.attrGet("src");
          if (s) inline.push(s);
        }
        if (t.children) walk(t.children);
      }
    })(toks2);

    // dedupe
    const uniqInline = [...new Set(inline)];
    // must remove featuredImage from inline‑count
    const withoutFeat = uniqInline.filter(u => u !== parsed.data.featuredImage);

    // 1) every inline must be a real image
    for (const url of uniqInline) {
      if (!(await isImageUrl(url))) {
        allErrors.push(`Inline image URL is not an image: ${url}`);
      }
    }
    // 2) enforce no more than 2 distinct non‑featured inline URLs
    if (withoutFeat.length > MAX_IMAGE_COUNT) {
      allErrors.push(
        `Too many inline images: found ${withoutFeat.length}, max allowed is ${MAX_IMAGE_COUNT}.`
      );
    }
  }

  if (allErrors.length > 0) {
    return await reject("Validation failed:\n\n- " + allErrors.join("\n- "));
  }

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
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const issue_number = parseInt(process.env.ISSUE_NUMBER, 10);

  // 1) Remove valid‑submission if it’s there
  try {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number,
      name: "valid-submission"
    });
  } catch { }

  // 2) Add the invalid label
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number,
    labels: ["invalid"]
  });

  // 3) Post the comment
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number,
    body: [
      "❌ Submission rejected:",
      "",
      "```",
      esc(reason),
      "```"
    ].join("\n")
  });

  process.exit(1);
}
