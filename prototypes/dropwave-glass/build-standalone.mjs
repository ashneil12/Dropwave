import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const outputPath = NodePath.resolve(
  process.argv[2] ?? NodePath.resolve(here, "dropwave-glass.html"),
);
const [html, styles, storage, dialogFocus, app] = await Promise.all([
  NodeFSP.readFile(NodePath.resolve(here, "index.html"), "utf8"),
  NodeFSP.readFile(NodePath.resolve(here, "styles.css"), "utf8"),
  NodeFSP.readFile(NodePath.resolve(here, "state-storage.js"), "utf8"),
  NodeFSP.readFile(NodePath.resolve(here, "dialog-focus.js"), "utf8"),
  NodeFSP.readFile(NodePath.resolve(here, "app.js"), "utf8"),
]);

const inlineApp = `${storage.replaceAll("export function", "function")}\n${dialogFocus.replaceAll("export function", "function")}\n${app.replace('import { restoreState, serializeState } from "./state-storage.js";\n', "").replace('import { focusTrapTarget } from "./dialog-focus.js";\n', "")}`;
const standalone = html
  .replace(
    '    <link rel="stylesheet" href="./styles.css" />',
    `    <style>\n${styles}\n    </style>`,
  )
  .replace(
    '    <script type="module" src="./app.js"></script>',
    `    <script>\n${inlineApp}\n    </script>`,
  );

await NodeFSP.writeFile(outputPath, standalone);
console.log(`Wrote ${outputPath}`);
