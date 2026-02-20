import type { Options as SemanticReleaseOptions } from 'semantic-release'

type SemanticReleaseOptionKeys =
  | 'repositoryUrl'
  | 'branches'
  | 'tagFormat'
  | 'plugins'

export type GetNextVersionOptions = {
  /** Working directory, defaults to process.cwd(). */
  cwd?: string
  /** Semantic-release config overrides. */
  config?: SemanticReleaseOptions
  /** Name of the default release branch. Defaults to 'main'. */
  defaultBranch?: string
  /** @deprecated Use @link `defaultBranch`. */
  mainBranch?: string
  /**
   * When true, return plain x.y.z. When false (default), return
   * x.y.z-preview-<hash> for non-default branches.
   */
  release?: boolean
} & Pick<SemanticReleaseOptions, SemanticReleaseOptionKeys>

export declare function getNextVersion(
  options?: GetNextVersionOptions
): Promise<string>

declare const _default: {
  getNextVersion: typeof getNextVersion
}

export default _default
