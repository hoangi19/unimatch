import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from './App'
import { ToastProvider } from './ui/ToastProvider'
import { TOAST_MS, useToast } from './ui/toast-context'
import { I18nProvider } from './i18n'
import { fakeSession, stubAuth } from './test-auth'

const admin = () => stubAuth(fakeSession('admin')).auth

it('lands on the inbox in Vietnamese and syncs <html lang>', () => {
  render(<App auth={admin()} />)
  expect(location.pathname).toBe('/inbox')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hộp thư')
  expect(document.documentElement.lang).toBe('vi')
})

it('opens a deep link and moves between tabs with history', () => {
  history.replaceState(null, '', '/pages')
  render(<App auth={admin()} />)
  const heading = screen.getByRole('heading', { level: 1 })
  expect(heading.textContent).toBe('Trang Facebook')

  fireEvent.click(screen.getByRole('link', { name: 'Chatbot' }))
  expect(location.pathname).toBe('/chatbot')
  expect(heading.textContent).toBe('Chatbot')
  expect(document.activeElement).toBe(heading)

  // What the browser does on Back: restore the previous URL, then fire popstate.
  act(() => {
    history.replaceState(null, '', '/pages')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(heading.textContent).toBe('Trang Facebook')
})

it('keeps the Dataset tab disabled', () => {
  render(<App auth={admin()} />)
  const dataset = screen.getByRole('link', { name: /Dữ liệu/ })
  expect(dataset.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(dataset)
  expect(location.pathname).toBe('/inbox')
})

it('switches language and remembers it', () => {
  render(<App auth={admin()} />)
  fireEvent.click(screen.getByRole('button', { name: 'EN' }))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Inbox')
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('um-lang')).toBe('en')
})

it('shows neutral status until data arrives, and real values once passed', () => {
  const auth = admin()
  const { rerender } = render(<App auth={auth} />)
  expect(screen.getAllByText('Chưa thiết lập')).toHaveLength(3)
  rerender(<App auth={auth} status={{ webhook: 'OK', ai: 'OpenAI', botOn: false }} />)
  expect(screen.getByText('OpenAI')).toBeTruthy()
  expect(screen.getByText('Tạm dừng')).toBeTruthy()
})

it('dismisses toasts after a timeout', () => {
  vi.useFakeTimers()
  function Trigger() {
    const toast = useToast()
    return <button onClick={() => toast({ title: 'Saved' })}>go</button>
  }
  render(
    <I18nProvider>
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    </I18nProvider>,
  )
  fireEvent.click(screen.getByText('go'))
  expect(screen.getByText('Saved')).toBeTruthy()
  act(() => {
    vi.advanceTimersByTime(TOAST_MS)
  })
  expect(screen.queryByText('Saved')).toBeNull()
  vi.useRealTimers()
})
