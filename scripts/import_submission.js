// import_submission.js (with helper integration + close + lock issue)

const { Octokit } = require("@octokit/rest");
const matter = require("gray-matter");
const path = require("path");
// use Node’s built‑in fetch (Node 18+)
// no import needed
const { fileTypeFromBuffer } = require("file-type");
const sharp = require("sharp");
const { formToFrontmatter } = require("./import_helpers");

/**
 * Turn a post title into a URL‑safe slug
 */
function slugifyTitle(title) {
  // only used here, so inline slugify
  const slugify = require("slugify");
  return slugify(title || "", { lower: true, strict: true })
    || `submission-${Date.now()}`;
}

/**
 * Check that a URL is a GitHub Form asset upload
 */
function isGitHubImageUrl(url) {
  return /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+(?:\?raw=true)?$/.test(url);
}

/**
 * Turn a GitHub Form upload page URL into the actual raw‑blob URL
 */
function toRawUrl(url) {
  const base = url.split("?")[0];
  return base.startsWith("https://github.com/user-attachments/assets/")
    ? `${base}?raw=true`
    : url;
}

/**
 * Fetch with a 30 s timeout (was 5 s)
 */
async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function run() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const issueNumber = process.env.ISSUE_NUMBER;
  const username = process.env.ISSUE_USER;
  let pr;

  // Fetch the full issue so we have title + body
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber
  });
  const raw = formToFrontmatter(issue);

  try {
    const parsed = matter(raw);
    const { data, content } = parsed;

    if (!data.submission) {
      console.error("Not a flagged submission. Aborting.");
      return;
    }

    const slug = slugifyTitle(data.title);

    // generate safe date + timestamp once
    const now = new Date();
    const date = now.toISOString().split('T')[0];               // "YYYY‑MM‑DD"
    const timestamp = now.toISOString().replace(/[:.]/g, '-');      // "YYYY‑MM‑DDThh-mm-ss-sssZ"
    const folderName = `${date}-${timestamp}-${slug}`;
    // prevent any traversal characters or parent‑dir patterns in our name
    if (
      folderName.includes('/') ||
      folderName.includes('\\') ||
      folderName.includes('..')
    ) {
      throw new Error(`Invalid folder name (path injection): ${folderName}`);
    }
    // only truncate the slug segment so we keep the issue# and timestamp intact
    const prefix = `submissions/issue-${issueNumber}-${timestamp}-`;
    const maxSlugLen = 60 - prefix.length;
    const safeSlug = slug.slice(0, maxSlugLen);
    const branch = prefix + safeSlug;

    // Repo‐relative paths (for Octokit) always use posix/
    const repoPostDir = `content/posts/${folderName}`;
    const repoImageDir = `${repoPostDir}/images`;

    // match inline images uploaded via the new Form host
    const imageRegex = /!\[(.*?)\]\((https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+)(?:\?raw=true)?\)/g;
    const images = [...content.matchAll(imageRegex)];
    let updatedContent = content;
    // collect processed inline images
    const inlineAssets = [];
    // track filename collisions
    const nameCount = new Map();

    for (const [, alt, url] of images) {
      // ensure it’s a Form‐hosted asset URL
      if (!isGitHubImageUrl(url)) {
        throw new Error(`Invalid inline image URL: ${url}`);
      }

      const res = await fetchWithTimeout(toRawUrl(url), { redirect: "follow" });
      if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      // determine format (normalize jpg→jpeg)
      const rawType = await fileTypeFromBuffer(buffer);
      if (!rawType || !["image/png", "image/jpeg"].includes(rawType.mime)) {
        throw new Error(`Invalid MIME type for image: ${rawType?.mime}`);
      }
      const ext = rawType.ext === "jpg" ? "jpeg" : rawType.ext;
      const base = path.basename(new URL(url).pathname);
      // optional collision suffix
      const seen = nameCount.get(base) || 0;
      const filename = `${base}${seen > 0 ? `-${seen}` : ""}.${ext}`;
      nameCount.set(base, seen + 1);
      // sanitize filename against path injection
      if (
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('..')
      ) {
        throw new Error(`Invalid image filename (path injection): ${filename}`);
      }
      const cleaned = await sharp(buffer).toFormat(ext).toBuffer();
      // queue for commit
      inlineAssets.push({ filename, buffer: cleaned });
      // point content at the new relative path, stripping any '?raw=true'
      const rawQueryUrl = `${url}?raw=true`;
      // reference images relative to index.md
      updatedContent = updatedContent.split(rawQueryUrl).join(`images/${filename}`);
      updatedContent = updatedContent.split(url).join(`images/${filename}`);
    }

    // Fetch & write the featured image the same way
    const featRes = await fetchWithTimeout(toRawUrl(data.featuredImage), { redirect: "follow" });
    if (!featRes.ok) throw new Error(`Failed to fetch featured image: ${data.featuredImage}`);

    const featArrayBuf = await featRes.arrayBuffer();
    const featBuf = Buffer.from(featArrayBuf);

    const rawFeatType = await fileTypeFromBuffer(featBuf);
    if (!rawFeatType || !["image/png", "image/jpeg"].includes(rawFeatType.mime)) {
      throw new Error(`Invalid MIME type for featured image: ${rawFeatType?.mime}`);
    }
    const featExt = rawFeatType.ext === "jpg" ? "jpeg" : rawFeatType.ext;
    const featBase = path.basename(new URL(data.featuredImage).pathname);
    const featFilename = `${featBase}.${featExt}`;
    const featCleaned = await sharp(featBuf).toFormat(featExt).toBuffer();
    // queue for commit
    const featuredAsset = { filename: featFilename, buffer: featCleaned };
    // sanitize featured image filename against path injection
    if (
      featuredAsset.filename.includes('/') ||
      featuredAsset.filename.includes('\\') ||
      featuredAsset.filename.includes('..')
    ) {
      throw new Error(
        `Invalid featured image filename (path injection): ${featuredAsset.filename}`
      );
    }

    const finalFrontmatter = {
      title: data.title,
      description: data.description,
      author: data.author,
      subject: data.subject,
      // path is relative to index.md, so no leading `./`
      featuredImage: `images/${featFilename}`,
      publishDate: now.toISOString(),   // full timestamp
    };

    // Assemble final Markdown (no local write; will upload via Octokit)
    const finalMarkdown = matter.stringify(updatedContent, finalFrontmatter);

    // —— use Octokit to create/reset branch & commit all files via Git Data API ——  
    // 1) determine default-branch SHA  
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const base = repoData.default_branch;
    const { data: baseBranch } = await octokit.repos.getBranch({ owner, repo, branch: base });
    const baseSha = baseBranch.commit.sha;

    //
    // 2) create or reset our feature branch
    //
    const fullRef = `refs/heads/${branch}`;
    const shortRef = `heads/${branch}`;

    let exists = true;
    try {
      // GET /git/ref/:ref expects "heads/branch"
      await octokit.rest.git.getRef({ owner, repo, ref: shortRef });
    } catch (err) {
      if (err.status === 404) {
        exists = false;
      } else {
        throw err;
      }
    }
    if (!exists) {
      // POST /git/refs requires the full "refs/heads/…"
      await octokit.rest.git.createRef({
        owner, repo,
        ref: fullRef,
        sha: baseSha
      });
    } else {
      // PATCH /git/refs/:ref expects "heads/…"
      await octokit.rest.git.updateRef({
        owner, repo,
        ref: shortRef,
        sha: baseSha,
        force: true
      });
    }

    // 2b) prepare one atomic commit
    const commitMessage = `Import blog submission #${issueNumber}: ${data.title.replace(/"/g, '\\"')}`;
    const treeItems = [];

    // featured image blob
    const featBlob = await octokit.rest.git.createBlob({
      owner, repo,
      content: featuredAsset.buffer.toString("base64"),
      encoding: "base64"
    });
    treeItems.push({
      path: `${repoImageDir}/${featuredAsset.filename}`,
      mode: "100644", type: "blob",
      sha: featBlob.data.sha
    });

    // inline image blobs
    for (const { filename, buffer } of inlineAssets) {
      const blob = await octokit.rest.git.createBlob({
        owner, repo,
        content: buffer.toString("base64"),
        encoding: "base64"
      });
      treeItems.push({
        path: `${repoImageDir}/${filename}`,
        mode: "100644", type: "blob",
        sha: blob.data.sha
      });
    }

    // markdown blob
    const mdBlob = await octokit.rest.git.createBlob({
      owner, repo,
      content: Buffer.from(finalMarkdown).toString("base64"),
      encoding: "base64"
    });
    treeItems.push({
      path: `${repoPostDir}/index.md`,
      mode: "100644", type: "blob",
      sha: mdBlob.data.sha
    });

    // 2c) build a tree off baseSha
    const { data: tree } = await octokit.rest.git.createTree({
      owner, repo,
      base_tree: baseSha,
      tree: treeItems
    });

    // 2d) make the commit
    const { data: commit } = await octokit.rest.git.createCommit({
      owner, repo,
      message: commitMessage,
      tree: tree.sha,
      parents: [baseSha]
    });

    // and again, updateRef must use the short form
    await octokit.rest.git.updateRef({
      owner, repo,
      ref: shortRef,
      sha: commit.sha,
      force: true
    });

    // — only after a successful commit do we open the PR —
    pr = await octokit.pulls.create({
      owner, repo,
      title: `Blog Submission from @${username} — "${data.title}"`,
      head: branch,
      base,
      body: `This blog post was submitted via [issue #${issueNumber}](https://github.com/${owner}/${repo}/issues/${issueNumber}).\n\nPlease review.`
    });

    // unlock, comment, add “imported” label
    await octokit.issues.unlock({ owner, repo, issue_number: issueNumber });
    await octokit.issues.createComment({
      owner, repo, issue_number: issueNumber,
      body: `✅ Submission has been converted into [PR #${pr.data.number}](${pr.data.html_url}).`
    });
    await octokit.issues.addLabels({
      owner, repo, issue_number: issueNumber,
      labels: ["imported"],
    });

    // clear any old “import-failed” label
    try {
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: "import-failed"
      });
    } catch (e) { /* ignore if it wasn’t there */ }

    // close & re‑lock
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: "closed" });
    await octokit.issues.lock({ owner, repo, issue_number: issueNumber, lock_reason: "resolved" });

    console.log(`✅ Imported submission to ${repoPostDir}`);
  } catch (err) {
    // ANY error (fetch timeout, blob/tree/commit, etc.) will land here
    console.error("❌ Import failed:", err);

    // make sure the issue is unlocked
    try { await octokit.issues.unlock({ owner, repo, issue_number: issueNumber }); } catch { }

    // report failure & label
    await octokit.issues.createComment({
      owner, repo, issue_number: issueNumber,
      body: `❌ Import failed: ${err.message}`
    });
    await octokit.issues.addLabels({
      owner, repo, issue_number: issueNumber,
      labels: ["import-failed"]
    });
    await octokit.issues.lock({
      owner, repo, issue_number: issueNumber,
      lock_reason: "resolved"
    });

    return; // ensure we never proceed to PR creation
  }
}

run().catch(() => process.exit(1));