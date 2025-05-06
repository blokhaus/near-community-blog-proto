// scripts/validate_submission.js (refactored for testability with retry and issue state handling)

const { Octokit } = require("@octokit/rest");
const matter = require("gray-matter");
const MarkdownIt = require("markdown-it");
const { formToFrontmatter, findAssociatedPr } = require("./import_helpers");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const yaml = require('js-yaml');

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
const MAX_IMAGE_SIZE = 1024 * 1024; // 1 MB
const INVALID_CHARS_REGEX = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F\u200B\u202E]/g;
// allow optional ?raw=true at end
const ASSET_URL_REGEX = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+(?:\?raw=true)?$/;

// match Markdown inline images: ![alt](url)
const imageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Escape Markdown‐sensitive characters in a string
 */
function esc(str) {
  return String(str).replace(/([\\`*_[\]()>~])/g, "\\$1");
}

// 1) single shared parser
const md = new MarkdownIt({ html: true });

/**
 * Recursively extract image URLs from Markdown-It tokens
 */
function extractImageUrls(tokens) {
  const urls = [];
  (function walk(nodes) {
    for (const t of nodes) {
      if (t.type === "image") {
        const src = t.attrGet("src");
        if (src) urls.push(src);
      }
      if (t.children) walk(t.children);
    }
  })(tokens);
  return urls;
}

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

/**
 * Validate Markdown body using pre-parsed tokens
 */
function validateMarkdownContent(content, tokens) {
  const errors = [];
  if (!content || typeof content !== "string") {
    errors.push("Missing Markdown body content.");
    return { valid: false, errors };
  }

  // Reject control / invisible characters
  if (INVALID_CHARS_REGEX.test(content)) {
    errors.push("Blog content contains invalid control or invisible characters.");
  }

  // Check for raw HTML
  const hasRawHtml = tokens.some(t => t.type === "html_block" || t.type === "html_inline");
  if (hasRawHtml) {
    errors.push("Raw HTML tags are not allowed. Please remove any HTML from your Markdown content.");
  }

  // Enforce host‐pattern on every image token
  const inlineUrls = extractImageUrls(tokens);

  for (const url of inlineUrls) {
    if (!ASSET_URL_REGEX.test(url)) {
      errors.push(`Invalid inline image URL: ${url}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 
 * HEAD‐check (with GET fallback) to confirm Content‐Type=image/* and size
 */
async function isImageUrl(url) {
  const rawUrl = url.startsWith("https://github.com/user-attachments/assets/")
    ? `${url}?raw=true`
    : url;

  // 1) HEAD check with 5 s timeout
  let res;
  const headController = new AbortController();
  const headTimeout = setTimeout(() => headController.abort(), 5000);
  try {
    res = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: headController.signal
    });
  } catch {
    clearTimeout(headTimeout);
    return false;
  }
  clearTimeout(headTimeout);

  // 2) Fallback to GET or if redirect, with 30 s timeout
  if (!res.ok || (res.status >= 300 && res.status < 400)) {
    const getController = new AbortController();
    const getTimeout = setTimeout(() => getController.abort(), 30000);
    try {
      res = await fetch(rawUrl, {
        method: "GET",
        redirect: "follow",
        signal: getController.signal
      });
    } catch {
      clearTimeout(getTimeout);
      return false;
    }
    clearTimeout(getTimeout);
  }
  if (!res.ok) return false;

  // 3) Content-Type check
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) return false;

  // 4) Size check: prefer Content-Length, else fetch body with 30 s timeout
  const lenHeader = res.headers.get("content-length");
  let length;
  if (lenHeader) {
    length = Number(lenHeader);
  } else {
    const getController2 = new AbortController();
    const getTimeout2 = setTimeout(() => getController2.abort(), 30000);
    try {
      const getRes = await fetch(rawUrl, {
        method: "GET",
        redirect: "follow",
        signal: getController2.signal
      });
      if (!getRes.ok) {
        clearTimeout(getTimeout2);
        return false;
      }
      const buf = await getRes.arrayBuffer();
      length = buf.byteLength;
    } catch {
      clearTimeout(getTimeout2);
      return false;
    }
    clearTimeout(getTimeout2);
  }

  return length <= MAX_IMAGE_SIZE;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("Unhandled error:", err);
      process.exit(1);
    });
}


async function run() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const issueNumber = Number(process.env.ISSUE_NUMBER);

  const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });

  // lock immediately to prevent mid‐stream edits
  await octokit.issues.lock({
    owner,
    repo,
    issue_number: issueNumber,
    lock_reason: "resolved"
  });

  // ── NEW: bail if there’s already an open or merged PR for this issue via bot comments
  const conflict = await findAssociatedPr(octokit, owner, repo, issueNumber);
  if (conflict) {
    console.log(
      `↩️ Issue #${issueNumber} already has PR #${conflict.number} ` +
      `(${conflict.state}${conflict.merged_at ? ", merged" : ""}); skipping.`
    );
    return;
  }

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

  // 2) Reject huge front-matter
  const fmText = raw.split('---')[1] || '';
  if (fmText.length > 2048) throw new Error('Front-matter too large');

  // 3) 🚨 Early sanity check on raw input (before full parse)
  // Fail fast on too many *unique* inline images in the input
  // This avoids heavy parsing or API fetches in clearly invalid cases.
  // pull out only the Markdown body (skip YAML front-matter)

  const allMatches = [...raw.matchAll(imageRegex)].map(m => m[1]);

  const uniqEarlyInline = [...new Set(allMatches)];
  if (uniqEarlyInline.length > MAX_IMAGE_COUNT + 2) {
    throw new Error(
      `Too many inline images: found ${uniqEarlyInline.length}, max is ${MAX_IMAGE_COUNT}`
    );
  }

  let parsed;
  try {
    parsed = matter(raw, {
      engines: {
        yaml: s => yaml.load(s, { schema: yaml.SAFE_SCHEMA })
      }
    });
  } catch (e) {
    return await reject("Unable to parse frontmatter: " + e.message);
  }

  // parse Markdown body once
  const tokens = md.parse(parsed.content, {});

  // early inline‐image count check (exclude featured image)
  const inlineUrls = extractImageUrls(tokens);
  const uniqInline = [...new Set(inlineUrls.filter(u => u !== parsed.data.featuredImage))];
  if (uniqInline.length > MAX_IMAGE_COUNT) {
    throw new Error(
      `Too many inline images: found ${uniqInline.length}, max is ${MAX_IMAGE_COUNT}`
    );
  }

  // frontmatter + content validation
  const frontmatterResult = validateFrontmatter(parsed.data);
  const contentResult = validateMarkdownContent(parsed.content, tokens);

  let allErrors = [...frontmatterResult.errors, ...contentResult.errors];

  // only if no sync errors do we do the HEAD check
  if (allErrors.length === 0) {
    // 1) Featured image: type + size
    if (!(await isImageUrl(parsed.data.featuredImage))) {
      allErrors.push("Featured Image URL invalid, not an image, or exceeds size limit");
    }

    // 2) Inline images: each must be valid via isImageUrl()
    // reuse the tokens parsed once at top to extract all image URLs
    const allInlineUrls = extractImageUrls(tokens)
      .filter(u => u !== parsed.data.featuredImage);
    const uniqInlineUrls = [...new Set(allInlineUrls)];

    for (const url of uniqInlineUrls) {
      if (!await isImageUrl(url)) {
        allErrors.push(`Inline image invalid, not an image, or too large: ${url}`);
      }
    }
    if (uniqInlineUrls.length > MAX_IMAGE_COUNT) {
      allErrors.push(
        `Too many inline images: found ${uniqInlineUrls.length}, max allowed is ${MAX_IMAGE_COUNT}.`
      );
    }
  }

  if (allErrors.length > 0) {
    return await reject("Validation failed:\n\n- " + allErrors.join("\n- "));
  }

  // on success: leave the issue locked and exit
  return;
}

async function reject(reason) {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const issue_number = parseInt(process.env.ISSUE_NUMBER, 10);

  await octokit.issues.unlock({ owner, repo, issue_number });

  // 1) Remove valid-submission if it’s there
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
