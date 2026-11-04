import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function projectDirectoryFrom(moduleUrl: string): string {
  let directory = path.dirname(fileURLToPath(moduleUrl));
  while (!existsSync(path.join(directory, "package.json"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("The project directory could not be found");
    }
    directory = parent;
  }
  return directory;
}
