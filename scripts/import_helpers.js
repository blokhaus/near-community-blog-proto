// scripts/import_helpers.js

const MarkdownIt = require("markdown-it");
const md = new MarkdownIt({ html: false });

/**
 * Convert the GitHub Form “### …” sections into a YAML front‑matter + Markdown body
 */
function formToFrontmatter(issue) {
  // ▸ Bail early on ridiculously large submissions (mirror our 50 KB guard)
  const MAX_BODY = 50_000;
  if (issue.body.length > MAX_BODY) {
    throw new Error(
      `Issue body too large (${issue.body.length} chars). Max is ${MAX_BODY} chars.`
    );
  }

  // split original text into lines
  const lines = issue.body.split(/\r?\n/);

  // parse into tokens with line‐map info
  const tokens = md.parse(issue.body, {});

  // we'll record the starting line of each section
  const sectionLines = {
    Description: null,
    Author: null,
    Subject: null,
    "Featured Image URL": null,
    "Confirm submission": null,
    "Blog Content": null
  };

  // walk tokens to find h3 headings & their starting line
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === "heading_open" && tok.tag === "h3" && tok.map) {
      const title = tokens[i + 1]?.content.trim();
      if (sectionLines.hasOwnProperty(title)) {
        sectionLines[title] = tok.map[0];
      }
    }
  }

  // helper to extract raw lines between two markers
  const sliceSection = (name, nextName) => {
    const start = sectionLines[name];
    const end = nextName && sectionLines[nextName] != null
      ? sectionLines[nextName]
      : lines.length;
    if (start == null) return "";
    return lines.slice(start + 1, end).join("\n").trim();
  };

  const titleRaw = issue.title.replace(/^\[Blog\]\s*/i, "").trim();
  const description = sliceSection("Description", "Author");
  const author = sliceSection("Author", "Subject");
  const subject = sliceSection("Subject", "Featured Image URL");
  const featuredImage = sliceSection("Featured Image URL", "Confirm submission");
  const confirm = sliceSection("Confirm submission", "Blog Content");
  const content = sliceSection("Blog Content", null);

  const esc = s => s.replace(/"/g, '\\"');
  const submission = /\[x\]/i.test(confirm);

  return [
    "---",
    `title: "${esc(titleRaw)}"`,
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
  formToFrontmatter
};
