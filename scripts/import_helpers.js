// scripts/import_helpers.js

const slugify = require('slugify');

function slugifyTitle(title) {
  return slugify(title || '', { lower: true, strict: true }) || `submission-${Date.now()}`;
}

// allow ?raw=true
const ASSET_URL_REGEX = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+(?:\?raw=true)?$/;
function isGitHubImageUrl(url) {
  return ASSET_URL_REGEX.test(url);
}

function extractImageIndex(urlString) {
  try {
    const match = urlString.match(/image-(\d+)\.(png|jpg)$/);
    return match ? parseInt(match[1], 10) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Convert the GitHub Form “### …” sections into a YAML front‑matter + Markdown body
 */
function formToFrontmatter(issue) {
  const section = name => {
    const re = new RegExp(
      `###\\s*${name}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n###|$)`,
      "i"
    );
    const m = issue.body.match(re);
    return m ? m[1].trim() : "";
  };
  const esc = s => s.replace(/"/g, '\\"');
  const title = issue.title.replace(/^\[Blog\]\s*/i, "").trim();
  const description = section("Description");
  const author = section("Author");
  const subject = section("Subject");
  const featuredImage = section("Featured Image URL");
  const confirm = section("Confirm submission");
  const submission = /\[x\]/i.test(confirm);
  const content = section("Blog Content");

  return [
    "---",
    `title: "${esc(title)}"`,
    `description: "${esc(description)}"`,
    `author: "${esc(author)}"`,
    `subject: "${esc(subject)}"`,
    `featuredImage: "${esc(featuredImage)}"`,
    `submission: ${submission}`,
    "---",
    "",
    content
  ].join("\n");
}

module.exports = {
  slugifyTitle,
  isGitHubImageUrl,
  extractImageIndex,
  formToFrontmatter
};
