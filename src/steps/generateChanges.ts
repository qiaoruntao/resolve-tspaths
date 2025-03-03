import { existsSync, readFileSync } from "fs";
import { dirname, relative, resolve } from "path";

import { FileNotFoundError } from "~/utils/errors";

import type { Alias, Change, ProgramPaths, TextChange } from "~/types";

export const IMPORT_EXPORT_REGEX =
  /(?:(?:require\(|import\()|(?:import|export) (?:.*from )?)['"]([^'"]*)['"]\)?/g;

const PATHS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".cjs",
  ".mjs",
  ".mdx",
  ".d.ts",
  ".json",
  "/index.js",
  "/index.jsx",
  "/index.ts",
  "/index.tsx",
  "/index.cjs",
  "/index.mjs",
  "/index.mdx",
  "/index.d.ts",
];

/**
 * Generate the alias path mapping changes to apply to the provide files.
 *
 * @param files The list of files to replace alias paths in.
 * @param aliases The path mapping configuration from tsconfig.
 * @param programPaths Program options.
 */
export function generateChanges(
  files: string[],
  aliases: Alias[],
  programPaths: Pick<ProgramPaths, "srcPath" | "outPath">
): Change[] {
  const changeList: Change[] = [];

  for (const file of files) {
    const { changed, text, changes } = replaceAliasPathsInFile(
      file,
      aliases,
      programPaths
    );

    if (!changed) continue;

    changeList.push({ file, text, changes });
  }

  return changeList;
}

/**
 * Read the file at the given path and return the text with aliased paths replaced.
 *
 * @param filePath The path to the file.
 * @param aliases The path mapping configuration from tsconfig.
 * @param programPaths Program options.
 */
export function replaceAliasPathsInFile(
  filePath: string,
  aliases: Alias[],
  programPaths: Pick<ProgramPaths, "srcPath" | "outPath">
): { changed: boolean; text: string; changes: TextChange[] } {
  if (!existsSync(filePath))
    throw new FileNotFoundError(replaceAliasPathsInFile.name, filePath);

  const originalText = readFileSync(filePath, "utf-8");
  const changes: TextChange[] = [];

  const newText = originalText.replace(
    IMPORT_EXPORT_REGEX,
    (original, matched) => {
      const result = aliasToRelativePath(
        matched,
        filePath,
        aliases,
        programPaths
      );

      if (!result.replacement) return original;

      const index = original.indexOf(matched);
      changes.push({
        original: result.original,
        modified: result.replacement,
      });

      return (
        original.substring(0, index) +
        result.replacement +
        original.substring(index + matched.length)
      );
    }
  );

  return { changed: originalText !== newText, text: newText, changes };
}

/**
 * Convert an aliased path to a relative path.
 *
 * @param path The aliased path that needs to be mapped to a relative path.
 * @param filePath The location of the file that the aliased path was from.
 * @param aliases The path mapping configuration from tsconfig.
 * @param programPaths Program options.
 */
export function aliasToRelativePath(
  path: string,
  filePath: string,
  aliases: Alias[],
  programPaths: Pick<ProgramPaths, "srcPath" | "outPath">
): { file: string; original: string; replacement?: string } {
  const { srcPath, outPath } = programPaths;

  for (const alias of aliases) {
    const { prefix, aliasPaths } = alias;

    // Skip the alias if the path does not start with it
    if (!path.startsWith(prefix)) continue;

    const pathRelative = path.substring(prefix.length);
    const srcFile = resolve(srcPath, relative(outPath, filePath));

    // Find a matching alias path
    for (const aliasPath of aliasPaths) {
      const modulePath = resolve(aliasPath, pathRelative);

      // File must exist in source directory
      if (
        existsSync(modulePath) ||
        PATHS.some((ext) => existsSync(`${modulePath}${ext}`))
      ) {
        const rel = relative(dirname(srcFile), modulePath);
        const replacement = rel.startsWith(".") ? rel : `./${rel}`;
        return {
          file: filePath,
          original: path,
          replacement: replacement.replace(/\\/g, "/"),
        };
      }
    }
  }

  // If no alias was found, just return the original path
  return { file: filePath, original: path };
}
