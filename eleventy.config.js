const { createJiti } = require("jiti");

const jiti = createJiti(__filename, { interopDefault: true });

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("site/assets");
  eleventyConfig.addPassthroughCopy("site/robots.txt");
  eleventyConfig.addPassthroughCopy({
    "site/assets/brand/favicon.ico": "favicon.ico",
  });

  // Eleventy 3.1.x only reads .json/.mjs/.cjs/.js data files natively. We use
  // .ts so site/_data/*.ts can share types with the rest of the codebase; jiti
  // transpiles on the fly (same loader tsx uses).
  eleventyConfig.addDataExtension("ts", {
    parser: async (_contents, filePath) => {
      const mod = await jiti.import(filePath);
      const fn = typeof mod === "function" ? mod : mod?.default;
      return typeof fn === "function" ? await fn() : fn;
    },
    read: false,
  });

  // CHANGELOG.md lives at the repo root (outside the `site/` input dir) but is
  // consumed by site/_data/changelog.ts. Without this, `eleventy --serve`
  // never picks up edits and you have to restart the dev server.
  eleventyConfig.addWatchTarget("./CHANGELOG.md");

  eleventyConfig.addGlobalData("env", process.env.NODE_ENV || "development");

  eleventyConfig.addFilter("toISODate", (date) => {
    return date instanceof Date ? date.toISOString().split("T")[0] : "";
  });

  eleventyConfig.addFilter("marketplaceUtm", (url, medium) => {
    if (!url || !medium) return url;
    const sep = url.includes("?") ? "&" : "?";
    const q = new URLSearchParams({
      utm_source: "website",
      utm_medium: String(medium),
      utm_campaign: "mermaid_toolkit",
    });
    return `${url}${sep}${q}`;
  });

  eleventyConfig.addCollection("sitemapValidated", (collectionApi) => {
    const all = collectionApi.getAll();
    const missing = all
      .filter(
        (item) =>
          !item.data.eleventyExcludeFromCollections &&
          !item.data.sitemapPriority,
      )
      .map((item) => item.inputPath);

    if (missing.length) {
      throw new Error(
        `Missing sitemapPriority in front matter:\n  ${missing.join("\n  ")}`,
      );
    }

    return all;
  });

  return {
    dir: {
      input: "site",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md"],
    htmlTemplateEngine: "njk",
  };
};
