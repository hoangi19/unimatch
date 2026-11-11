import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { emitSchemeChange, media } from './test-setup'
import { storedTheme, useTheme } from './theme'

it('follows the OS setting while nothing is stored', () => {
  media.prefersDark = true
  const { result } = renderHook(() => useTheme())
  expect(result.current.theme).toBe('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')

  act(() => emitSchemeChange(false))
  expect(result.current.theme).toBe('light')
})

it('remembers a toggled theme and stops following the OS', () => {
  const { result } = renderHook(() => useTheme())
  act(() => result.current.toggleTheme())
  expect(result.current.theme).toBe('dark')
  expect(storedTheme()).toBe('dark')

  act(() => emitSchemeChange(false))
  expect(result.current.theme).toBe('dark')
})

it('ignores junk in storage', () => {
  localStorage.setItem('um-theme', 'blue')
  expect(storedTheme()).toBeNull()
})
