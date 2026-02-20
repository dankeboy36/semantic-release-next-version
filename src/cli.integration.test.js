// @ts-check

import semanticRelease from 'semantic-release'
import { exec } from 'tinyexec'

import { run } from './cli.js'

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

const execMock = /** @type {ReturnType<typeof vi.fn>} */ (exec)
const semanticReleaseMock = /** @type {ReturnType<typeof vi.fn>} */ (
  semanticRelease
)

describe('cli integration', () => {
  let logSpy
  let errorSpy

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GITHUB_HEAD_REF
    delete process.env.GITHUB_REF
    delete process.env.GITHUB_REF_NAME
    delete process.env.GITHUB_SHA

    semanticReleaseMock.mockResolvedValue(null)
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
      if (args?.includes('--abbrev-ref')) {
        return { stdout: 'main\n', stderr: '', exitCode: 0 }
      }
      if (args?.includes('--is-shallow-repository')) {
        return { stdout: 'false\n', stderr: '', exitCode: 0 }
      }
      if (args?.[0] === 'tag' && args[1] === '--list') {
        return { stdout: '0.0.9\n', stderr: '', exitCode: 0 }
      }
      if (args?.includes('--short')) {
        return { stdout: 'abc1234\n', stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('prints preview fallback and exits 0 in default mode when no release exists', async () => {
    const exitCode = await run(['node', 'cli.js'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith('0.0.9-preview-abc1234')
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
