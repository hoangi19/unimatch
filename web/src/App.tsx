import { readEnv } from './env'

// Placeholder until the app shell lands.
export default function App({ env = readEnv() }) {
  return (
    <main className="mx-auto max-w-xl p-8 font-sans text-slate-900">
      <h1 className="text-2xl font-semibold text-violet-700">UniMatch Console</h1>
      <p className="mt-2 text-slate-600">Skeleton build. The admin console is on its way.</p>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Supabase URL</dt>
        <dd>{env.supabaseUrl ?? 'not configured'}</dd>
        <dt className="font-medium">Publishable key</dt>
        <dd>{env.hasPublishableKey ? 'configured' : 'not configured'}</dd>
      </dl>
      <p className="mt-6 text-sm">
        <a className="text-violet-700 underline" href="/demo/">Open the design demo</a>
      </p>
    </main>
  )
}
