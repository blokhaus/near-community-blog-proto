// scripts/import_helpers.js

const slugify = require('slugify');

function slugifyTitle(title) {
  return slugify(title || '', { lower: true, strict: true }) || `submission-${Date.now()}`;
}

function isGitHubImageUrl(urlString) {
  try {
    const url = new URL(urlString);
    return (
      url.hostname === 'user-images.githubusercontent.com' &&
      !url.search &&
      !url.hash
    );
  } catch (e) {
    return false;
  }
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
