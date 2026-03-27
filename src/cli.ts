#!/usr/bin/env bun
import { resolve } from "path";
import { parseArgs } from "util";
import { convertHtmlToSlides } from "./pipeline";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "output-dir": { type: "string", short: "o", default: "./output" },
    "no-pdf": { type: "boolean", default: false },
    "no-pptx": { type: "boolean", default: false },
    "no-png": { type: "boolean", default: false },
    render: { type: "boolean", default: false },
    "skip-fonts": { type: "boolean", default: false },
    "fonts-dir": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
  allowPositionals: true,
});

if (values.version) {
  const pkg = require("../package.json");
  console.log(pkg.version);
  process.exit(0);
}

if (values.help || positionals.length === 0) {
  console.log(`
Usage: slide-gen [options] <input.html>

Options:
  -o, --output-dir <dir>   Output directory (default: ./output)
  --no-pdf                 Skip PDF generation
  --no-pptx                Skip PPTX generation
  --no-png                 Skip PNG screenshots
  --render                 Render PPTX back to PNG for verification
  --skip-fonts             Use cached fonts
  --fonts-dir <dir>        Custom fonts directory
  -h, --help               Show help
  -v, --version            Show version
`.trim());
  process.exit(values.help ? 0 : 1);
}

const htmlPath = resolve(process.cwd(), positionals[0]);

convertHtmlToSlides(htmlPath, {
  outputDir: resolve(process.cwd(), values["output-dir"]!),
  noPdf: values["no-pdf"],
  noPptx: values["no-pptx"],
  noPng: values["no-png"],
  render: values.render,
  skipFonts: values["skip-fonts"],
  fontsDir: values["fonts-dir"] ? resolve(process.cwd(), values["fonts-dir"]) : undefined,
}).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
