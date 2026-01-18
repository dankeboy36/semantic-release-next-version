// @ts-check

import index, { getNextVersion } from './index.js'

describe('index', () => {
  it('exports getNextVersion as named export', () => {
    expect(typeof getNextVersion).toBe('function')
  })

  it('exposes getNextVersion via default export', () => {
    expect(typeof index.getNextVersion).toBe('function')
  })
})
