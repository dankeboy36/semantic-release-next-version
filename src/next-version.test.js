// @ts-check

import { exec } from 'tinyexec'
import semanticRelease from 'semantic-release'

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

function mockGit({ originUrl = '', branch = 'main', commit = 'abcdef0' } = {}) {
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
    if (args?.includes('--short')) {
      return { stdout: `${commit}\n`, stderr: '', exitCode: 0 }
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

  it('throws when semantic-release does not return a result', async () => {
    semanticReleaseMock.mockResolvedValue(null)
    mockGit()

    await expect(getNextVersion()).rejects.toThrow(
      'semantic-release did not return a next version.'
    )
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

  it('respects custom main branch when adding inferred branch config', async () => {
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

  it('uses preview slug when both branch and mainBranch are empty', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: { version: '1.0.0' },
    })
    execMock.mockImplementation(async () => {
      throw new Error('fatal: not a git repo')
    })

    const version = await getNextVersion({ mainBranch: '' })

    expect(version).toBe('1.0.0-preview-preview')
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
})
