import { describe, expect, it } from 'vitest'
import type { Algorithm, ModuleOptions } from './module'

describe('@jfungus/ratelimit-nuxt', () => {
  describe('ModuleOptions type', () => {
    it('accepts valid options', () => {
      const validOptions: ModuleOptions = {
        enabled: true,
        limit: 100,
        windowMs: 60_000,
        algorithm: 'sliding-window',
        storage: 'memory',
        skip: ['/_nuxt/**'],
        include: ['/api/**'],
        statusCode: 429,
        message: 'Too Many Requests',
        headers: true,
        keyGenerator: 'ip',
        dryRun: false,
      }
      expect(validOptions.limit).toBe(100)
      expect(validOptions.algorithm).toBe('sliding-window')
    })

    it('accepts fixed-window algorithm', () => {
      const options: ModuleOptions = {
        algorithm: 'fixed-window',
      }
      expect(options.algorithm).toBe('fixed-window')
    })

    it('accepts different keyGenerator values', () => {
      const ipOptions: ModuleOptions = { keyGenerator: 'ip' }
      const ipUaOptions: ModuleOptions = { keyGenerator: 'ip-ua' }
      const customOptions: ModuleOptions = { keyGenerator: 'custom' }

      expect(ipOptions.keyGenerator).toBe('ip')
      expect(ipUaOptions.keyGenerator).toBe('ip-ua')
      expect(customOptions.keyGenerator).toBe('custom')
    })
  })

  describe('Algorithm type', () => {
    it('only allows valid algorithms', () => {
      // Type-level test - if this compiles, the type is correct
      const fixedWindow: Algorithm = 'fixed-window'
      const slidingWindow: Algorithm = 'sliding-window'

      expect(fixedWindow).toBe('fixed-window')
      expect(slidingWindow).toBe('sliding-window')
    })
  })
})
