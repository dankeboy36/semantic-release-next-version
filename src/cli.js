// @ts-check

import { pathToFileURL } from 'node:url'

import meow from 'meow'

import { getNextVersion } from './next-version.js'

const HELP_TEXT = `
  Usage
    $ next-version-helper [--release] [--cwd <path>] [--main-branch <name>]

  Options
    --release       Return the plain next release version (x.y.z)
    --cwd <path>    Working directory (defaults to current)
    --main-branch   Name of the main release branch (default: main)
    --help, -h      Show this help
    --version, -v   Show package version
`

/** @param {readonly string[]} argv */
export async function run(argv = process.argv) {
  const argList = Array.from(argv)
  const importMetaForMeow = import.meta
  let cli
  try {
    cli = meow(HELP_TEXT, {
      importMeta: importMetaForMeow,
      allowUnknownFlags: false,
      autoHelp: false,
      autoVersion: false,
      argv: argList.slice(2),
      flags: {
        release: { type: 'boolean', default: false },
        cwd: { type: 'string' },
        mainBranch: { type: 'string' },
        help: { type: 'boolean', shortFlag: 'h' },
        version: { type: 'boolean', shortFlag: 'v' },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    return 1
  }

  if (cli.flags.help) {
    console.log(cli.help)
    return 0
  }

  if (cli.flags.version) {
    const version = process.env.npm_package_version || cli.pkg?.version || ''
    console.log(version)
    return 0
  }

  try {
    const version = await getNextVersion({
      cwd: cli.flags.cwd,
      release: Boolean(cli.flags.release),
      mainBranch: cli.flags.mainBranch,
    })
    console.log(version)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    return 1
  }
}

/* istanbul ignore next */
const isCli = pathToFileURL(process.argv[1] ?? '').href === import.meta.url
/* istanbul ignore next */
if (isCli) {
  run(process.argv).then((code) => {
    process.exitCode = code
  })
}
