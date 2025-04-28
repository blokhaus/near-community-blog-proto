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

module.exports = {
  slugifyTitle,
  isGitHubImageUrl,
  extractImageIndex
};
