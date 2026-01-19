// @ts-check

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import createDebug from 'debug'
import semanticRelease from 'semantic-release'
import semver from 'semver'
import { exec } from 'tinyexec'

const DEFAULT_MAIN_BRANCH = 'main'
const debug = createDebug('semantic-release-next-version')
const TOKEN_ENV_VARS = ['GITHUB_TOKEN', 'GH_TOKEN', 'GIT_TOKEN']

/** @param {string} mainBranch */
function buildDefaultOptions(mainBranch) {
  /** @type {import('semantic-release').Options} */
  return {
    repositoryUrl: '.',
    branches: [mainBranch, { name: '*', prerelease: true }],
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
 * @param {string} mainBranch
 */
async function createTempRemote(cwd, currentBranch, mainBranch) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srnv-'))
  const remote = path.join(root, 'remote.git')

  await runGit(cwd, ['init', '--bare', remote])
  debug('created temp remote %s', remote)
  await runGit(cwd, [
    '--git-dir',
    remote,
    'symbolic-ref',
    'HEAD',
    `refs/heads/${mainBranch}`,
  ]).catch(() => {})
  await runGit(cwd, ['push', remote, `HEAD:refs/heads/${mainBranch}`]).catch(
    () => {}
  )
  if (currentBranch && currentBranch !== mainBranch) {
    debug('pushing current branch %s to temp remote', currentBranch)
    await runGit(cwd, [
      'push',
      remote,
      `HEAD:refs/heads/${currentBranch}`,
    ]).catch(() => {})
  }
  await runGit(cwd, ['push', remote, '--tags']).catch(() => {})

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
  mainBranch = DEFAULT_MAIN_BRANCH,
} = {}) {
  debug('start getNextVersion')
  debug('cwd=%s mainBranch=%s release=%s', cwd, mainBranch, release)
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

  const currentBranch = (await getCurrentBranch(cwd)) || mainBranch
  debug('currentBranch=%s', currentBranch)

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
        mainBranch
      )
      effectiveRepoUrl = remote
      tempRemoteRoot = root
    } catch (err) {
      debug('failed to create temp remote: %o', err)
    }
  }

  const loadedConfig = {
    ...buildDefaultOptions(mainBranch),
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
        currentBranch !== mainBranch ? toPrereleaseId(currentBranch) : false,
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
      await fs
        .rm(tempRemoteRoot, { recursive: true, force: true })
        .catch(() => {})
    }
  }

  if (!result) {
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
