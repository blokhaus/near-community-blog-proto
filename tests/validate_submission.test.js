// tests/validate_submission.test.js

const { validateFrontmatter, validateMarkdownContent } = require('../scripts/validate_submission');

describe("Frontmatter Validation", () => {
  test("valid frontmatter passes", () => {
    const data = {
      title: "Why I Love NEAR",
      description: "This post explores my favorite features of the NEAR ecosystem.",
      author: "Alice Example",
      subject: "Community",
      featuredImage: "https://user-images.githubusercontent.com/123456/featured-near.png",
      submission: true
    };
    const result = validateFrontmatter(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing title fails", () => {
    const data = {
      description: "Missing title field.",
      author: "Alice Example",
      subject: "Community",
      featuredImage: "https://user-images.githubusercontent.com/123456/featured-near.png",
      submission: true
    };
    const result = validateFrontmatter(data);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/title/);
  });

  test("invalid subject fails", () => {
    const data = {
      title: "Bad Subject Test",
      description: "This will fail due to subject.",
      author: "Alice Example",
      subject: "WrongTag",
      featuredImage: "https://user-images.githubusercontent.com/123456/featured-near.png",
      submission: true
    };
    const result = validateFrontmatter(data);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/subject/);
  });
});

describe("Markdown Content Validation", () => {
  test("valid content with 2 images passes", () => {
    const content = "Markdown with images\n\n![Alt text](https://user-images.githubusercontent.com/img/image-1.png)\n![Alt text](https://user-images.githubusercontent.com/img/image-2.jpg)";
    const result = validateMarkdownContent(content);
    expect(result.valid).toBe(true);
  });

  test("raw HTML fails", () => {
    const content = "<div>This is HTML and should fail</div>";
    const result = validateMarkdownContent(content);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/HTML tags/);
  });

  test("too many images fails", () => {
    const content = "![img1](url1) ![img2](url2) ![img3](url3)";
    const result = validateMarkdownContent(content);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Too many images/);
  });

  test("image with bad index fails", () => {
    const content = "![img](https://user-images.githubusercontent.com/x/image-3.png)";
    const result = validateMarkdownContent(content);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/index out of allowed range/);
  });

  test("image with query string fails", () => {
    const content = "![img](https://user-images.githubusercontent.com/x/image-1.png?query=123)";
    const result = validateMarkdownContent(content);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not clean/);
  });
});
