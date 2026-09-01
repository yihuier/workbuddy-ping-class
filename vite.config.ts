import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };

function inlineWorkBuddyBundle(): Plugin {
  return {
    name: "inline-workbuddy-bundle",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("__PING_CLASS_APP_VERSION__", packageJson.version);
    },
    closeBundle() {
      const outputDirectory = resolve("dist");
      const htmlPath = resolve(outputDirectory, "index.html");
      if (!existsSync(htmlPath)) {
        throw new Error("构建产物缺少 dist/index.html");
      }

      let html = readFileSync(htmlPath, "utf8");
      html = html.replace(
        /<script\s+type="module"\s+crossorigin\s+src="\.\/([^"]+)"><\/script>/g,
        (_tag, relativePath: string) => {
          const javascript = readFileSync(resolve(outputDirectory, relativePath), "utf8");
          return `<script>\n${javascript}\n</script>`;
        },
      );
      html = html.replace(
        /<link\s+rel="stylesheet"\s+crossorigin\s+href="\.\/([^"]+)">/g,
        (_tag, relativePath: string) => {
          const css = readFileSync(resolve(outputDirectory, relativePath), "utf8");
          return `<style>\n${css}\n</style>`;
        },
      );

      const inlineScripts: string[] = [];
      html = html.replace(/<script>\n[\s\S]*?<\/script>/g, (script) => {
        inlineScripts.push(script);
        return "";
      });
      if (inlineScripts.length) {
        html = html.replace("</body>", `${inlineScripts.join("\n")}\n</body>`);
      }

      writeFileSync(htmlPath, html, "utf8");
      rmSync(resolve(outputDirectory, "assets"), { recursive: true, force: true });
      rmSync(resolve(outputDirectory, "mock"), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2017",
    minify: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
  plugins: [inlineWorkBuddyBundle()],
});
