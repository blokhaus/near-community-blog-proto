// tests/import_submission.test.js

const path = require('path');
const { URL } = require('url');

// Example helpers to test if you modularize them in import_submission.js
const { slugifyTitle, isGitHubImageUrl, extractImageIndex } = require('../scripts/import_helpers');

describe("Import Script Helpers", () => {
  test("slugifyTitle converts title safely", () => {
    const input = "Let's GO, NEAR!"
    const slug = slugifyTitle(input);
    expect(slug).toBe("lets-go-near");
  });

  test("isGitHubImageUrl accepts valid GitHub image URLs", () => {
    const url = "https://user-images.githubusercontent.com/abc123/image-1.png";
    expect(isGitHubImageUrl(url)).toBe(true);
  });

  test("isGitHubImageUrl rejects non-GitHub URLs", () => {
    const url = "https://imgur.com/image-1.png";
    expect(isGitHubImageUrl(url)).toBe(false);
  });

  test("extractImageIndex parses valid image name", () => {
    const url = "https://user-images.githubusercontent.com/abc/image-2.jpg";
    expect(extractImageIndex(url)).toBe(2);
  });

  test("extractImageIndex returns null for bad format", () => {
    const url = "https://user-images.githubusercontent.com/image-wrongname.png";
    expect(extractImageIndex(url)).toBe(null);
  });
});
