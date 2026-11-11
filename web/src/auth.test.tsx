import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { authState, signInError } from './auth'
import { EMAIL_KEY } from './Login'
import { fakeSession, stubAuth } from './test-auth'

describe('authState', () => {
  it('needs the admin role in app_metadata', () => {
    expect(authState(undefined)).toBe('loading')
    expect(authState(null)).toBe('signedOut')
    expect(authState(fakeSession())).toBe('noAccess')
    expect(authState(fakeSession('viewer'))).toBe('noAccess')
    expect(authState(fakeSession('admin'))).toBe('admin')
  })
})

describe('signInError', () => {
  it('maps Supabase auth errors to a message kind', () => {
    expect(signInError({ status: 400, code: 'invalid_credentials' })).toBe('wrong')
    expect(signInError({ status: 429, code: 'over_request_rate_limit' })).toBe('rateLimit')
    expect(signInError({ status: 0 })).toBe('network')
    expect(signInError({ status: 503 })).toBe('network')
  })
})

const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
}

describe('route guard', () => {
  it('shows login for any path when signed out, then returns to that path', async () => {
    history.replaceState(null, '', '/pages')
    const { auth, calls, emit } = stubAuth(null)
    render(<App auth={auth} />)
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(location.pathname).toBe('/pages')

    fill(' admin@unimatch.test ', 'secret')
    expect(calls.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@unimatch.test', password: 'secret' })
    expect(await screen.findByRole('button', { name: 'Đang đăng nhập…' })).toBeTruthy()
    emit('SIGNED_IN', fakeSession('admin'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trang Facebook')
  })

  it('keeps the user on login with a clear error when the password is wrong', async () => {
    const { auth } = stubAuth(null, () => ({ error: { status: 400, code: 'invalid_credentials' } }))
    render(<App auth={auth} />)
    fill('admin@unimatch.test', 'wrong')
    expect((await screen.findByRole('alert')).textContent).toContain('Email hoặc mật khẩu không đúng')
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeTruthy()
  })

  it('shows network and rate-limit errors', async () => {
    const { auth } = stubAuth(null, () => ({ error: { status: 429 } }))
    render(<App auth={auth} />)
    fill('admin@unimatch.test', 'x')
    expect((await screen.findByRole('alert')).textContent).toContain('quá nhiều lần')
  })

  it('validates fields inline before calling Supabase', () => {
    const { auth, calls } = stubAuth(null)
    render(<App auth={auth} />)
    fill('', '')
    expect(screen.getByText('Nhập email của bạn.')).toBeTruthy()
    expect(screen.getByText('Nhập mật khẩu.')).toBeTruthy()
    fill('not-an-email', 'x')
    expect(screen.getByText('Email không hợp lệ.')).toBeTruthy()
    expect(calls.signInWithPassword).not.toHaveBeenCalled()
  })

  it('toggles password visibility and remembers the email', () => {
    localStorage.setItem(EMAIL_KEY, 'admin@unimatch.test')
    const { auth } = stubAuth(null)
    render(<App auth={auth} />)
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('admin@unimatch.test')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

    const password = screen.getByLabelText('Mật khẩu') as HTMLInputElement
    expect(password.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }))
    expect(password.type).toBe('text')
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('checkbox'))
    fill('admin@unimatch.test', 'x')
    expect(localStorage.getItem(EMAIL_KEY)).toBeNull()
  })

  it('blocks a signed-in non-admin and lets them sign out', () => {
    const { auth, calls } = stubAuth(fakeSession())
    render(<App auth={auth} />)
    expect(screen.getByText('Không có quyền vào trang quản trị')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    expect(calls.signOut).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeTruthy()
  })

  it('signs an admin out from the account menu', () => {
    const { auth, calls } = stubAuth(fakeSession('admin'))
    render(<App auth={auth} />)
    fireEvent.click(screen.getByText('Đăng xuất'))
    expect(calls.signOut).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeTruthy()
  })

  it('returns to login when the session ends elsewhere', () => {
    const { auth, emit } = stubAuth(fakeSession('admin'))
    render(<App auth={auth} />)
    emit('SIGNED_OUT', null)
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeTruthy()
  })
})
