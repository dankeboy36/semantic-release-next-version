#!/usr/bin/env node

// @ts-check

Promise.resolve()
  .then(() => import('../dist/cli.js'))
  .then(({ run }) => run(process.argv))
  .then((code) => {
    if (typeof code === 'number') {
      process.exitCode = code
    }
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
