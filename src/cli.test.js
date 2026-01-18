// @ts-check

import { run } from './cli.js'
import { getNextVersion } from './next-version.js'

vi.mock('./next-version.js', () => {
  const getNextVersion = vi.fn()
  return { getNextVersion }
})

const originalEnv = { ...process.env }

const getNextVersionMock = /** @type {ReturnType<typeof vi.fn>} */ (
  getNextVersion
)

describe('cli', () => {
  let logSpy
  let errorSpy

  beforeEach(() => {
    vi.clearAllMocks()
    getNextVersionMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    process.env = { ...originalEnv }
    getNextVersionMock.mockReset()
  })

  it('prints the next version and exits with code 0', async () => {
    getNextVersionMock.mockResolvedValue('1.0.0-preview-abc1234')

    const exitCode = await run(['node', 'cli.js'])

    expect(exitCode).toBe(0)
    expect(getNextVersionMock).toHaveBeenCalledWith({
      cwd: undefined,
      release: false,
    })
    expect(logSpy).toHaveBeenCalledWith('1.0.0-preview-abc1234')
  })

  it('passes through the --release flag', async () => {
    getNextVersionMock.mockResolvedValue('1.0.0')

    const exitCode = await run(['node', 'cli.js', '--release'])

    expect(exitCode).toBe(0)
    expect(getNextVersionMock).toHaveBeenCalledWith({
      cwd: undefined,
      release: true,
    })
  })

  it('accepts a custom working directory', async () => {
    getNextVersionMock.mockResolvedValue('1.0.0')

    const exitCode = await run(['node', 'cli.js', '--cwd', '/tmp/project'])

    expect(exitCode).toBe(0)
    expect(getNextVersionMock).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      release: false,
    })
  })

  it('returns an error when getNextVersion fails', async () => {
    getNextVersionMock.mockRejectedValue(new Error('boom'))

    const exitCode = await run(['node', 'cli.js'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('boom')
  })

  it('rejects unknown flags', async () => {
    const exitCode = await run(['node', 'cli.js', '--unknown'])

    expect(exitCode).toBe(1)
    expect(getNextVersionMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown flag')
    )
  })

  it('shows help and exits 0', async () => {
    const exitCode = await run(['node', 'cli.js', '--help'])

    expect(exitCode).toBe(0)
    expect(getNextVersionMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'))
  })

  it('shows version and exits 0', async () => {
    process.env.npm_package_version = '9.9.9'

    const exitCode = await run(['node', 'cli.js', '--version'])

    expect(exitCode).toBe(0)
    expect(getNextVersionMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('9.9.9'))
  })

  it('passes through custom main branch', async () => {
    getNextVersionMock.mockResolvedValue('1.2.3')

    const exitCode = await run(['node', 'cli.js', '--main-branch', 'develop'])

    expect(exitCode).toBe(0)
    expect(getNextVersionMock).toHaveBeenCalledWith({
      cwd: undefined,
      release: false,
      mainBranch: 'develop',
    })
  })

  it('falls back to cwd when argv lacks a script path', async () => {
    getNextVersionMock.mockResolvedValue('0.0.1')

    const exitCode = await run(['node'])

    expect(exitCode).toBe(0)
    expect(getNextVersionMock).toHaveBeenCalledWith({
      cwd: undefined,
      release: false,
      mainBranch: undefined,
    })
  })

  it('stringifies non-Error failures from getNextVersion', async () => {
    getNextVersionMock.mockRejectedValue('bad news')

    const exitCode = await run(['node', 'cli.js'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('bad news')
  })
})

describe('cli (isolated module mocks)', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('falls back to empty version when no package info is available', async () => {
    delete process.env.npm_package_version

    vi.doMock('meow', () => ({
      default: () => ({
        flags: { version: true, help: false },
        pkg: undefined,
        help: '',
      }),
    }))
    vi.doMock('./next-version.js', () => ({
      getNextVersion: vi.fn(),
    }))

    const { run: isolatedRun } = await import('./cli.js')
    const localLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const code = await isolatedRun(['node', 'cli.js'])

    expect(code).toBe(0)
    expect(localLogSpy).toHaveBeenCalledWith('')
    localLogSpy.mockRestore()
  })

  it('stringifies parsing errors when meow throws non-Error', async () => {
    getNextVersionMock.mockResolvedValue('skip')
    vi.doMock('meow', () => ({
      default: () => {
        throw 'parse boom' // eslint-disable-line no-throw-literal
      },
    }))
    vi.doMock('./next-version.js', () => ({
      getNextVersion: getNextVersionMock,
    }))

    const { run: isolatedRun } = await import('./cli.js')
    const localErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    const code = await isolatedRun(['node', 'cli.js'])

    expect(code).toBe(1)
    expect(localErrorSpy).toHaveBeenCalledWith('parse boom')
    localErrorSpy.mockRestore()
  })
})
