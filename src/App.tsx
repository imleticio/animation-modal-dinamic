import { useState, type FormEvent } from 'react'
import DynamicIsland from './DynamicIsland'

/* ── shared login form used inside both islands ── */
function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage(`Acceso validado para ${username}.`)
    setPassword('')
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
        Iniciar sesión
      </h1>

      <form onSubmit={handleSubmit} className="mt-auto space-y-4">
        <label className="block text-sm">
          <span className="text-slate-200">Usuario</span>
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="tu_usuario"
            className="mt-2 w-full rounded-xl border border-white/20 bg-slate-900/55 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/30 transition-shadow duration-200"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-200">Contraseña</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            className="mt-2 w-full rounded-xl border border-white/20 bg-slate-900/55 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/30 transition-shadow duration-200"
          />
        </label>

        <button
          type="submit"
          className="mt-3 w-full rounded-xl border border-cyan-200/40 bg-cyan-300/15 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition-all duration-200 hover:bg-cyan-200/20 hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.3)]"
        >
          Entrar
        </button>
      </form>

      {message && (
        <p className="text-center text-xs text-cyan-100/80">{message}</p>
      )}
    </>
  )
}

/* ═════════════════════════════════════════════════ */

export default function App() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* ambient glows */}
      <div className="pointer-events-none absolute -top-20 left-[18%] h-64 w-64 rounded-full bg-cyan-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 right-[15%] h-72 w-72 rounded-full bg-blue-500/35 blur-3xl" />

      {/* ── header with island on the right ── */}
      <header className="relative z-30 flex items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold tracking-widest uppercase text-slate-300">
          Dynamic&nbsp;Island
        </span>
        {/* Ejemplo 1: botón personalizado con borde cyan */}
        <DynamicIsland
          trigger={
            <button className="rounded-full border border-cyan-400/50 bg-cyan-500/15 px-5 py-2 text-sm font-semibold tracking-wider text-cyan-200 transition hover:bg-cyan-400/25">
              LOGIN
            </button>
          }
        >
          <LoginForm />
        </DynamicIsland>
      </header>

      {/* ── center island ── */}
      <div className="relative z-20 flex min-h-[calc(100vh-80px)] items-center justify-center px-4 py-10">
        {/* Ejemplo 2: botón grande con gradiente */}
        <DynamicIsland
          trigger={
            <button className="rounded-2xl bg-linear-to-r from-blue-500 to-cyan-400 px-8 py-3 text-base font-bold tracking-wide text-white shadow-lg shadow-cyan-500/25 transition hover:shadow-cyan-400/40 hover:scale-105">
              ABRIR PANEL
            </button>
          }
        >
          <LoginForm />
        </DynamicIsland>
      </div>
      <div>
        {/* Ejemplo 3: usando solo triggerLabel (fallback sin estilos) */}
        <DynamicIsland triggerLabel="hola">
          <LoginForm />
        </DynamicIsland>
      </div>
    </main>
  )
}
