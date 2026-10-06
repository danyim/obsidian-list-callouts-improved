import type { NodeProp } from '@lezer/common';

/**
 * Obsidian runs its own fork of @codemirror/language (lishid/cm-language),
 * which exports the token class prop its Markdown parser tags nodes with.
 * Upstream has never exported it. The fork is only on GitHub, and Obsidian's
 * plugin scanner did not resolve it as a git dependency: every import from
 * this module was typed `any` there, and each use flagged as unsafe.
 * So the types come from the npm release and this declares the one export
 * missing from it. The module itself is external to the bundle, and Obsidian
 * supplies the fork at runtime.
 */
declare module '@codemirror/language' {
  export const tokenClassNodeProp: NodeProp<string>;
}
