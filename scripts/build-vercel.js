const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const copyFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

const copyDir = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
};

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const file of ["app.js", "style.css", "portfolio.config.json", "portfolio-data.json"]) {
  const source = path.join(ROOT, file);
  if (fs.existsSync(source)) {
    copyFile(source, path.join(DIST, file));
  }
}

copyDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));
copyFile(
  path.join(ROOT, "node_modules", "motion", "dist", "motion.js"),
  path.join(DIST, "vendor", "motion.js")
);

const html = fs
  .readFileSync(path.join(ROOT, "index.html"), "utf8")
  .replace("node_modules/motion/dist/motion.js", "vendor/motion.js");
fs.writeFileSync(path.join(DIST, "index.html"), html);

console.log("Built static site in dist/");
