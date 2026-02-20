// @ts-check

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import semanticRelease from 'semantic-release'
import { exec } from 'tinyexec'

import { getNextVersion } from './next-version.js'

/* eslint-disable no-template-curly-in-string */

vi.mock('tinyexec', () => {
  const exec = vi.fn(() => {
    throw new Error('exec not mocked')
  })
  return { exec }
})

vi.mock('semantic-release', () => {
  const semanticRelease = vi.fn()
  return { default: semanticRelease }
})

const semanticReleaseMock = /** @type {ReturnType<typeof vi.fn>} */ (
  semanticRelease
)
const execMock = /** @type {ReturnType<typeof vi.fn>} */ (exec)

function mockGit({
  originUrl = '',
  branch = 'main',
  commit = 'abcdef0',
  tags = ['0.0.9'],
} = {}) {
  execMock.mockImplementation(async (_cmd, args) => {
    if (args?.[0] === 'init' && args[1] === '--bare') {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (args?.[0] === '--git-dir' && args[2] === 'symbolic-ref') {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (args?.[0] === 'push') {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (
      args?.[0] === 'config' &&
      args[1] === '--get' &&
      args[2] === 'remote.origin.url'
    ) {
      return { stdout: originUrl, stderr: '', exitCode: 0 }
    }
    if (args?.includes('--abbrev-ref')) {
      return { stdout: `${branch}\n`, stderr: '', exitCode: 0 }
    }
    if (args?.includes('--is-shallow-repository')) {
      return { stdout: 'false\n', stderr: '', exitCode: 0 }
    }
    if (args?.includes('--short')) {
      return { stdout: `${commit}\n`, stderr: '', exitCode: 0 }
    }
    if (args?.[0] === 'tag' && args[1] === '--list') {
      return {
        stdout: tags.length ? `${tags.join('\n')}\n` : '',
        stderr: '',
        exitCode: 0,
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 }
  })
}

describe('getNextVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GITHUB_HEAD_REF
    delete process.env.GITHUB_REF
    delete process.env.GITHUB_REF_NAME
    delete process.env.GITHUB_SHA
  })

  it('returns preview versions using the commit hash and branch prerelease id', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.2.3-beta.1' },
    })
    execMock.mockRejectedValue(new Error('git not needed'))

    process.env.GITHUB_HEAD_REF = 'feature/cool-thing'
    process.env.GITHUB_REF = 'refs/pull/1/merge'
    process.env.GITHUB_SHA = 'abcdef1234567890'

    const version = await getNextVersion()

    expect(version).toBe('1.2.3-preview-abcdef1')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: expect.arrayContaining([
          expect.objectContaining({
            name: 'feature/cool-thing',
            prerelease: 'feature-cool-thing',
          }),
        ]),
      }),
      expect.any(Object)
    )
  })

  it('returns the base release version when release flag is true', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '2.0.1' },
    })
    mockGit()

    const version = await getNextVersion({ release: true })

    expect(version).toBe('2.0.1')
    expect(semanticReleaseMock).toHaveBeenCalled()
  })

  it('falls back to the branch slug when no commit hash is available', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '0.1.0-alpha.2' },
    })
    execMock.mockImplementation(async (_cmd, args) => {
      if (
        args?.[0] === 'config' &&
        args[1] === '--get' &&
        args[2] === 'remote.origin.url'
      ) {
        return { stdout: '', stderr: '', exitCode: 0 }
      }
      if (args.includes('--abbrev-ref')) {
        return { stdout: 'feature/slugged\n', stderr: '', exitCode: 0 }
      }
      if (args.includes('--short')) {
        throw new Error('git unavailable')
      }
      throw new Error('git unavailable')
    })

    const version = await getNextVersion()

    expect(version).toBe('0.1.0-preview-feature-slugged')
  })

  it('returns a preview from the current tag when no release is produced', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['0.0.9'] })

    const version = await getNextVersion()

    expect(version).toBe('0.0.9-preview-abcdef0')
  })

  it.each([
    {
      name: 'semantic-release default tag format',
      tagFormat: 'v${version}',
      tag: 'v1.2.3',
      expected: '1.2.3-preview-abcdef0',
    },
    {
      name: 'this package default tag format',
      tagFormat: '${version}',
      tag: '1.2.3',
      expected: '1.2.3-preview-abcdef0',
    },
    {
      name: 'custom tag format',
      tagFormat: 'release-<%= version %>-prod',
      tag: 'release-1.2.3-prod',
      expected: '1.2.3-preview-abcdef0',
    },
  ])(
    'derives fallback preview version with $name',
    async ({ tagFormat, tag, expected }) => {
      semanticReleaseMock.mockResolvedValue(null)
      mockGit({ tags: [tag] })

      const version = await getNextVersion({ config: { tagFormat } })

      expect(version).toBe(expected)
    }
  )

  it('falls back to plain semver tag parsing when tagFormat is undefined', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['1.2.3'] })

    const version = await getNextVersion({
      config: { tagFormat: undefined },
    })

    expect(version).toBe('1.2.3-preview-abcdef0')
  })

  it('falls back when tagFormat contains multiple version placeholders', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['2.3.4'] })

    const version = await getNextVersion({
      config: { tagFormat: '${version}-${version}' },
    })

    expect(version).toBe('2.3.4-preview-abcdef0')
  })

  it('falls back to semver.clean parsing when tagFormat extraction does not match', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['v2.3.4'] })

    const version = await getNextVersion({
      config: { tagFormat: 'release-${version}' },
    })

    expect(version).toBe('2.3.4-preview-abcdef0')
  })

  it('falls back when tagFormat boundaries overlap and extracted version is empty', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['aa'] })

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'srnv-overlap-'))
    try {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ version: '4.5.6' }),
        'utf8'
      )

      const version = await getNextVersion({
        cwd,
        config: { tagFormat: 'aa${version}a' },
      })
      expect(version).toBe('4.5.6-preview-abcdef0')
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('falls back when extracted tag version is not semver', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['release-not-semver-prod'] })

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'srnv-invalid-tag-'))
    try {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ version: '7.8.9' }),
        'utf8'
      )

      const version = await getNextVersion({
        cwd,
        config: { tagFormat: 'release-${version}-prod' },
      })
      expect(version).toBe('7.8.9-preview-abcdef0')
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('throws in release mode when semantic-release does not return a result', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit()

    await expect(getNextVersion({ release: true })).rejects.toThrow(
      'semantic-release did not return a next version.'
    )
  })

  it('returns current version in release mode when onNoRelease is current', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['0.0.9'] })

    const version = await getNextVersion({
      release: true,
      onNoRelease: 'current',
    })

    expect(version).toBe('0.0.9')
  })

  it('returns preview version in release mode when onNoRelease is preview', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: ['0.0.9'] })

    const version = await getNextVersion({
      release: true,
      onNoRelease: 'preview',
    })

    expect(version).toBe('0.0.9-preview-abcdef0')
  })

  it('throws for invalid onNoRelease option values', async () => {
    await expect(
      getNextVersion({
        // @ts-expect-error - intentionally invalid input for runtime validation.
        onNoRelease: 'invalid',
      })
    ).rejects.toThrow(
      'Invalid onNoRelease option: invalid. Expected one of: error, current, preview.'
    )
    expect(semanticReleaseMock).not.toHaveBeenCalled()
  })

  it('falls back to package.json when tags do not contain a semantic version', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    execMock.mockRejectedValue(new Error('git unavailable'))

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'srnv-version-'))
    try {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ version: '9.8.7-beta.1' }),
        'utf8'
      )

      const version = await getNextVersion({ cwd })
      expect(version).toBe('9.8.7-preview-main')
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('throws when neither tags nor package.json contain a valid version', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit({ tags: [] })

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'srnv-no-version-'))
    try {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ version: 'not-semver' }),
        'utf8'
      )

      await expect(getNextVersion({ cwd })).rejects.toThrow(
        'semantic-release did not return a next version and no valid version was found in git tags or package.json.'
      )
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('throws when semantic-release returns an unparsable version', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: 'not-a-version' },
    })
    mockGit()

    await expect(getNextVersion()).rejects.toThrow(
      'Unable to parse semantic-release version: not-a-version'
    )
  })

  it('respects custom default branch when adding inferred branch config', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.0-beta.1' },
    })
    mockGit({ branch: 'develop' })

    const version = await getNextVersion({
      branches: [],
      defaultBranch: 'develop',
      release: true,
    })

    expect(version).toBe('1.0.0')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: [
          {
            name: 'develop',
            prerelease: false,
          },
        ],
      }),
      expect.any(Object)
    )
  })

  it('accepts branches passed as a single BranchSpec object', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '2.3.4' },
    })
    mockGit({ branch: 'release' })

    const version = await getNextVersion({
      branches: { name: 'release' },
      release: true,
    })

    expect(version).toBe('2.3.4')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: [{ name: 'release' }],
      }),
      expect.any(Object)
    )
  })

  it('falls back to a preview slug when no branch or commit hash can be found', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '3.0.0' },
    })
    execMock.mockRejectedValue(new Error('no git'))

    const version = await getNextVersion()

    expect(version).toBe('3.0.0-preview-main')
  })

  it('applies repositoryUrl, tagFormat, and plugins overrides', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '4.5.6' },
    })
    mockGit()

    const version = await getNextVersion({
      repositoryUrl: 'file:///tmp/repo',
      tagFormat: 'v${version}',
      plugins: ['@semantic-release/commit-analyzer', 'custom-plugin'],
      release: true,
    })

    expect(version).toBe('4.5.6')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: 'file:///tmp/repo',
        tagFormat: 'v${version}',
        plugins: ['@semantic-release/commit-analyzer', 'custom-plugin'],
      }),
      expect.any(Object)
    )
  })

  it('coerces branches to an array when provided nullish', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '5.0.0' },
    })
    mockGit()

    const version = await getNextVersion({
      config: { branches: null },
      release: true,
    })

    expect(version).toBe('5.0.0')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: [{ name: 'main', prerelease: false }],
      }),
      expect.any(Object)
    )
  })

  it('uses GITHUB_REF_NAME when present', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.1' },
    })
    execMock.mockRejectedValue(new Error('no git call'))
    process.env.GITHUB_REF_NAME = 'release/ref-name'
    process.env.GITHUB_SHA = '123456789'

    const version = await getNextVersion({ release: true })

    expect(version).toBe('1.0.1')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: expect.arrayContaining([
          expect.objectContaining({
            name: 'release/ref-name',
            prerelease: 'release-ref-name',
          }),
        ]),
      }),
      expect.any(Object)
    )
  })

  it('defaults to the prerelease slug when branch characters are stripped', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.2' },
    })
    execMock.mockRejectedValue(new Error('no git command'))
    process.env.GITHUB_HEAD_REF = '!!!'
    process.env.GITHUB_REF = 'refs/pull/1/merge'
    process.env.GITHUB_SHA = 'abcdef123456'

    const version = await getNextVersion({ release: true })

    expect(version).toBe('1.0.2')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: expect.arrayContaining([
          expect.objectContaining({
            name: '!!!',
            prerelease: 'prerelease',
          }),
        ]),
      }),
      expect.any(Object)
    )
  })

  it('falls back to repositoryUrl "." when config repositoryUrl is undefined', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '2.0.0' },
    })
    mockGit()

    const version = await getNextVersion({
      config: { repositoryUrl: undefined },
      release: true,
    })

    expect(version).toBe('2.0.0')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: '.',
      }),
      expect.any(Object)
    )
  })

  it('falls back gracefully when git commands fail', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.0' },
    })
    execMock.mockImplementation(async () => {
      throw new Error('fatal: not a git repo')
    })

    const version = await getNextVersion()

    expect(version).toBe('1.0.0-preview-main')
    expect(execMock).toHaveBeenCalled()
  })

  it('uses preview slug when both branch and defaultBranch are empty', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.0' },
    })
    execMock.mockImplementation(async () => {
      throw new Error('fatal: not a git repo')
    })

    const version = await getNextVersion({ defaultBranch: '' })

    expect(version).toBe('1.0.0-preview-preview')
  })

  it('uses preview slug fallback when no release exists and branch is unknown', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    execMock.mockImplementation(async (_cmd, args) => {
      if (args?.includes('--is-shallow-repository')) {
        return { stdout: 'false\n', stderr: '', exitCode: 0 }
      }
      if (args?.includes('--abbrev-ref')) {
        throw new Error('branch unavailable')
      }
      if (args?.[0] === 'tag' && args[1] === '--list') {
        return { stdout: '0.0.9\n', stderr: '', exitCode: 0 }
      }
      if (args?.includes('--short')) {
        throw new Error('hash unavailable')
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    })

    const version = await getNextVersion({
      defaultBranch: '',
      repositoryUrl: 'file:///tmp/repo',
    })

    expect(version).toBe('0.0.9-preview-preview')
  })

  it('supports deprecated mainBranch option alias', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.0-beta.1' },
    })
    mockGit({ branch: 'develop' })

    const version = await getNextVersion({
      branches: [],
      mainBranch: 'develop',
      release: true,
    })

    expect(version).toBe('1.0.0')
  })

  it('uses local repositoryUrl for preview to avoid auth checks', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '2.0.0' },
    })
    mockGit({ originUrl: 'https://github.com/example/repo.git' })

    const version = await getNextVersion()
    const calledOptions = semanticReleaseMock.mock.calls[0][0]

    expect(version).toBe('2.0.0-preview-abcdef0')
    expect(semanticReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: expect.stringMatching(/srnv-.*remote\.git$/),
      }),
      expect.any(Object)
    )
    expect(calledOptions.repositoryUrl).not.toContain('github.com')
  })

  it('continues when git returns a non-zero exit code', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.2.3' },
    })
    execMock.mockResolvedValue({
      stdout: '',
      stderr: 'fatal',
      exitCode: 1,
    })

    const version = await getNextVersion()

    expect(version).toBe('1.2.3-preview-main')
    expect(execMock).toHaveBeenCalled()
  })

  it('pushes the current branch when creating a temp remote', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.0' },
    })
    mockGit({ branch: 'feature/temp-remote' })

    process.env.GITHUB_HEAD_REF = 'feature/temp-remote'
    process.env.GITHUB_REF = 'refs/heads/feature/temp-remote'

    await getNextVersion()

    expect(
      execMock.mock.calls.some(
        ([cmd, args]) =>
          cmd === 'git' &&
          Array.isArray(args) &&
          args[0] === 'push' &&
          args.includes('HEAD:refs/heads/feature/temp-remote')
      )
    ).toBe(true)
  })

  it('uses a temp remote for release when github auth is absent', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '3.1.0' },
    })
    mockGit({
      originUrl: 'https://github.com/example/repo.git',
      branch: 'main',
    })
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN
    delete process.env.GIT_TOKEN

    const version = await getNextVersion({ release: true })
    const calledOptions = semanticReleaseMock.mock.calls[0][0]

    expect(version).toBe('3.1.0')
    expect(calledOptions.repositoryUrl).toMatch(/srnv-.*remote\.git$/)
  })

  it('throws a clear error for shallow clones', async () => {
    mockGit({ branch: 'main' })
    execMock.mockImplementation(async (_cmd, args) => {
      if (args?.includes('--is-shallow-repository')) {
        return { stdout: 'true\n', stderr: '', exitCode: 0 }
      }
      if (args?.includes('--abbrev-ref')) {
        return { stdout: 'main\n', stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    })

    await expect(getNextVersion()).rejects.toThrow(
      'Shallow git clone detected. This tool requires full git history and tags; use actions/checkout with fetch-depth: 0 (or run git fetch --unshallow --tags).'
    )
    expect(semanticReleaseMock).not.toHaveBeenCalled()
  })
})
