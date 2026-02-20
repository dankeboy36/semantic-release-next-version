// @ts-check

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import createDebug from 'debug'
import semanticRelease from 'semantic-release'
import semver from 'semver'
import { exec } from 'tinyexec'

const DEFAULT_BRANCH = 'main'
const debug = createDebug('semantic-release-next-version')
const TOKEN_ENV_VARS = ['GITHUB_TOKEN', 'GH_TOKEN', 'GIT_TOKEN']
const TAG_FORMAT_VERSION_MARKER = '__srnv_version_marker__'
const TAG_FORMAT_VERSION_PATTERNS = [
  /\$\{\s*version\s*\}/g,
  /<%=\s*version\s*%>/g,
]

/** @param {string} defaultBranch */
function buildDefaultOptions(defaultBranch) {
  /** @type {import('semantic-release').Options} */
  return {
    repositoryUrl: '.',
    branches: [defaultBranch, { name: '*', prerelease: true }],
    // eslint-disable-next-line no-template-curly-in-string
    tagFormat: '${version}',
    plugins: ['@semantic-release/commit-analyzer'],
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
async function runGit(cwd, args) {
  const result = await exec('git', args, {
    nodeOptions: { cwd },
    throwOnError: true,
  })
  if (result.exitCode) {
    throw new Error(`git ${args.join(' ')} failed with code ${result.exitCode}`)
  }
  return result.stdout.trim()
}

/** @param {string} cwd */
async function getCurrentBranch(cwd) {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME
  try {
    return await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    return ''
  }
}

/** @param {string} cwd */
async function getRemoteOriginUrl(cwd) {
  try {
    return await runGit(cwd, ['config', '--get', 'remote.origin.url'])
  } catch {
    return ''
  }
}

/** @param {string} cwd */
async function isShallowRepository(cwd) {
  try {
    return (
      (await runGit(cwd, ['rev-parse', '--is-shallow-repository'])) === 'true'
    )
  } catch {
    return false
  }
}

/** @param {string} url */
function isGithubHttpUrl(url) {
  return /^https?:\/\/[^/]*github\.com[:/]/i.test(url)
}

function hasGitToken() {
  return TOKEN_ENV_VARS.some((key) => process.env[key])
}

/**
 * @param {string} cwd
 * @param {string} currentBranch
 * @param {string} defaultBranch
 */
async function createTempRemote(cwd, currentBranch, defaultBranch) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srnv-'))
  const remote = path.join(root, 'remote.git')

  await runGit(cwd, ['init', '--bare', remote])
  debug('created temp remote %s', remote)
  try {
    await runGit(cwd, [
      '--git-dir',
      remote,
      'symbolic-ref',
      'HEAD',
      `refs/heads/${defaultBranch}`,
    ])
  } catch {}
  try {
    await runGit(cwd, ['push', remote, `HEAD:refs/heads/${defaultBranch}`])
  } catch {}
  if (currentBranch && currentBranch !== defaultBranch) {
    debug('pushing current branch %s to temp remote', currentBranch)
    try {
      await runGit(cwd, ['push', remote, `HEAD:refs/heads/${currentBranch}`])
    } catch {}
  }
  try {
    await runGit(cwd, ['push', remote, '--tags'])
  } catch {}

  return { remote, root }
}

/**
 * @param {import('semantic-release').BranchSpec[]} branches
 * @param {string} branchName
 */
function branchExists(branches, branchName) {
  return branches.some((entry) => {
    if (typeof entry === 'string') return entry === branchName
    return entry?.name === branchName
  })
}

/** @param {string} branchName */
function toPrereleaseId(branchName) {
  const slug = branchName
    .replace(/[^0-9A-Za-z-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'prerelease'
}

/**
 * @param {string} tag
 * @param {string} tagFormat
 */
function parseVersionFromTag(tag, tagFormat) {
  if (!tag) return ''

  if (tagFormat) {
    let normalizedTagFormat = tagFormat
    let replacements = 0
    for (const pattern of TAG_FORMAT_VERSION_PATTERNS) {
      normalizedTagFormat = normalizedTagFormat.replace(pattern, () => {
        replacements += 1
        return TAG_FORMAT_VERSION_MARKER
      })
    }

    if (replacements === 1) {
      const [prefix, suffix] = normalizedTagFormat.split(
        TAG_FORMAT_VERSION_MARKER
      )
      if (tag.startsWith(prefix) && tag.endsWith(suffix)) {
        const endIndex = suffix ? tag.length - suffix.length : tag.length
        if (endIndex >= prefix.length) {
          const versionSegment = tag.slice(prefix.length, endIndex)
          const parsed = semver.parse(versionSegment)
          if (parsed) return `${parsed.major}.${parsed.minor}.${parsed.patch}`
        }
      }
    }
  }

  const cleaned = semver.clean(tag)
  const parsed = semver.parse(cleaned || '')
  if (!parsed) return ''
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

/**
 * @param {string} cwd
 * @param {string} tagFormat
 */
async function resolveCurrentBaseVersion(cwd, tagFormat) {
  try {
    const rawTags = await runGit(cwd, ['tag', '--list'])
    const versions = rawTags
      .split('\n')
      .map((tag) => parseVersionFromTag(tag.trim(), tagFormat))
      .filter(Boolean)
    if (versions.length > 0) {
      return semver.rsort([...new Set(versions)])[0]
    }
  } catch {}

  try {
    const packageJsonPath = path.join(cwd, 'package.json')
    const rawPackageJson = await fs.readFile(packageJsonPath, 'utf8')
    const packageVersion = JSON.parse(rawPackageJson)?.version
    const parsed = semver.parse(packageVersion)
    if (parsed) return `${parsed.major}.${parsed.minor}.${parsed.patch}`
  } catch {}

  throw new Error(
    'semantic-release did not return a next version and no valid version was found in git tags or package.json.'
  )
}

/**
 * @param {string} cwd
 * @param {string} fallback
 */
async function resolveCommitHash(cwd, fallback) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return await runGit(cwd, ['rev-parse', '--short', 'HEAD'])
  } catch {
    return fallback
  }
}

/**
 * Calculate the next semantic-release version without pushing tags or
 * publishing.
 *
 * @param {import('./index.js').GetNextVersionOptions} [options]
 * @returns {Promise<string>} Next release version.
 */
export async function getNextVersion({
  cwd = process.cwd(),
  config = {},
  repositoryUrl,
  branches: overrideBranches,
  tagFormat,
  plugins,
  release = false,
  defaultBranch,
  mainBranch,
} = {}) {
  const resolvedDefaultBranch = defaultBranch ?? mainBranch ?? DEFAULT_BRANCH
  debug('start getNextVersion')
  debug(
    'cwd=%s defaultBranch=%s release=%s',
    cwd,
    resolvedDefaultBranch,
    release
  )
  debug(
    'env GITHUB_HEAD_REF=%s GITHUB_REF=%s GITHUB_REF_NAME=%s',
    process.env.GITHUB_HEAD_REF,
    process.env.GITHUB_REF,
    process.env.GITHUB_REF_NAME
  )
  if (
    process.env.GITHUB_HEAD_REF &&
    process.env.GITHUB_REF?.startsWith('refs/pull/')
  ) {
    // Force env-ci to treat the source branch as the release branch on PRs.
    process.env.GITHUB_REF = `refs/heads/${process.env.GITHUB_HEAD_REF}`
    process.env.GITHUB_REF_NAME = process.env.GITHUB_HEAD_REF
  }

  const currentBranch = (await getCurrentBranch(cwd)) || resolvedDefaultBranch
  debug('currentBranch=%s', currentBranch)

  if (await isShallowRepository(cwd)) {
    throw new Error(
      'Shallow git clone detected. This tool requires full git history and tags; use actions/checkout with fetch-depth: 0 (or run git fetch --unshallow --tags).'
    )
  }

  let effectiveRepoUrl =
    repositoryUrl ||
    config.repositoryUrl ||
    (release ? await getRemoteOriginUrl(cwd) : '.') ||
    '.'
  let tempRemoteRoot = ''
  const needsLocalRemote =
    (!release && effectiveRepoUrl === '.') ||
    (release && isGithubHttpUrl(effectiveRepoUrl) && !hasGitToken())

  if (needsLocalRemote) {
    try {
      const { remote, root } = await createTempRemote(
        cwd,
        currentBranch,
        resolvedDefaultBranch
      )
      effectiveRepoUrl = remote
      tempRemoteRoot = root
    } catch (err) {
      debug('failed to create temp remote: %o', err)
    }
  }

  /** @type {import('semantic-release').Options} */
  const loadedConfig = {
    ...buildDefaultOptions(resolvedDefaultBranch),
    ...config,
    repositoryUrl: effectiveRepoUrl,
    ...(tagFormat ? { tagFormat } : {}),
    ...(plugins ? { plugins } : {}),
  }
  debug(
    'loadedConfig.branches=%o overrideBranches=%o repositoryUrl=%s',
    loadedConfig.branches,
    overrideBranches,
    loadedConfig.repositoryUrl
  )
  const baseBranches = overrideBranches ?? loadedConfig.branches
  const branches = Array.isArray(baseBranches)
    ? [...baseBranches]
    : baseBranches
      ? [baseBranches]
      : []
  debug('branches before ensure current=%o', branches)

  if (!branchExists(branches, currentBranch)) {
    branches.push({
      name: currentBranch,
      prerelease:
        currentBranch !== resolvedDefaultBranch
          ? toPrereleaseId(currentBranch)
          : false,
    })
  }
  debug('final branches=%o', branches)

  let result
  try {
    result = await semanticRelease(
      {
        ...loadedConfig,
        branches,
        dryRun: true,
        ci: false,
        repositoryUrl: loadedConfig.repositoryUrl,
      },
      {
        cwd,
        // Clear notes refs so stray git notes cannot break tag parsing.
        env: {
          ...process.env,
          GIT_NOTE_REF: 'semantic-release-next-version-empty',
          GIT_NOTES_REF: '',
          GIT_NOTES_DISPLAY_REF: '',
        },
        // Route semantic-release logs to stderr so CLI consumers can safely
        // capture stdout for the version string.
        stdout: process.stderr,
        stderr: process.stderr,
      }
    )
  } finally {
    if (tempRemoteRoot) {
      try {
        await fs.rm(tempRemoteRoot, { recursive: true, force: true })
      } catch {}
    }
  }

  if (!result) {
    if (!release) {
      const baseVersion = await resolveCurrentBaseVersion(
        cwd,
        loadedConfig.tagFormat
      )
      const commitHash = await resolveCommitHash(
        cwd,
        toPrereleaseId(currentBranch || 'preview')
      )
      return `${baseVersion}-preview-${commitHash}`
    }
    throw new Error('semantic-release did not return a next version.')
  }

  const parsed = semver.parse(result.nextRelease.version)
  if (!parsed) {
    throw new Error(
      `Unable to parse semantic-release version: ${result.nextRelease.version}`
    )
  }

  const baseVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  if (release) return baseVersion

  const commitHash = await resolveCommitHash(
    cwd,
    toPrereleaseId(currentBranch || 'preview')
  )

  return `${baseVersion}-preview-${commitHash}`
}
