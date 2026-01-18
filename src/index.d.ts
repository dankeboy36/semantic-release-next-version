import type semanticRelease from 'semantic-release'

export type GetNextVersionOptions = {
  /** Working directory, defaults to process.cwd(). */
  cwd?: string
  /** Semantic-release config overrides. */
  config?: semanticRelease.Options
  /** Repository URL override. */
  repositoryUrl?: string
  /**
   * Branch configuration override. Defaults to ['main', { name: '*' }] with the
   * current branch appended (as a prerelease branch when not main).
   */
  branches?: semanticRelease.BranchSpec[] | semanticRelease.BranchSpec
  /** Tag format override. Defaults to '${version}'. */
  tagFormat?: string
  /**
   * Plugin override. Defaults to ['@semantic-release/commit-analyzer'] to keep
   * dry-run behavior minimal.
   */
  plugins?: (string | semanticRelease.PluginSpec)[]
  /** Name of the main release branch. Defaults to 'main'. */
  mainBranch?: string
  /**
   * When true, return plain x.y.z. When false (default), return
   * x.y.z-preview-<hash> for non-main branches.
   */
  release?: boolean
}

export declare function getNextVersion(
  options?: GetNextVersionOptions
): Promise<string>

export declare const api: {
  getNextVersion: typeof getNextVersion
}

declare const _default: {
  getNextVersion: typeof getNextVersion
}

export default _default
