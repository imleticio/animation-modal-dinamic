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
      <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
        Iniciar sesión
      </h1>

      <form onSubmit={handleSubmit} className="mt-auto space-y-4">
        <label className="block text-sm">
          <span className="text-slate-600">Usuario</span>
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="tu_usuario"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow duration-200"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Contraseña</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow duration-200"
          />
        </label>

        <button
          type="submit"
          className="mt-3 w-full rounded-xl bg-linear-to-r from-blue-500 to-cyan-400 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition-all duration-200 hover:shadow-cyan-400/30 hover:scale-[1.02]"
        >
          Entrar
        </button>
      </form>

      {message && (
        <p className="text-center text-xs text-slate-600">{message}</p>
      )}
    </>
  )
}

/* ═════════════════════════════════════════════════ */

export default function App() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-slate-100">
      {/* ambient glows */}
      

      {/* ── header with island on the right ── */}
      <header className="relative z-30 flex items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold tracking-widest uppercase text-slate-300">
       
        </span>
        {/* Ejemplo 1: botón personalizado con borde cyan */}
        <DynamicIsland
          trigger={
            <button className="rounded-full border bg-black px-5 py-2 text-sm font-semibold  text-white transition hover:bg-gray-900">
              PRUEBA
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
            <button className="rounded-2xl border bg-black px-8 py-3 text-base font-bold  text-white tracking-wider shadow-lg transition hover:shadow-cyan-400/40 hover:scale-105">
              ABRIR PANEL
            </button>
          }
        >
          
          <LoginForm />
        </DynamicIsland>
      </div>
      <div>
        {/* Ejemplo 3: usando solo triggerLabel (fallback sin estilos) */}
        <DynamicIsland
         trigger={
            <button className="rounded-full border bg-black px-5 py-2 text-sm font-semibold  text-white transition hover:bg-gray-900">
              PRUEBA
            </button>
          }>
          <LoginForm />
        </DynamicIsland>
      </div>
    </main>
  )
}
