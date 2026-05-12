import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import TraceExplorer from './pages/TraceExplorer'
import Analytics from './pages/Analytics'

type Page = 'dashboard' | 'traces' | 'analytics'

const NAV: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'traces',    label: 'Traces' },
  { id: 'analytics', label: 'Analytics' },
]

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 flex items-center gap-8 h-14">
          <span className="font-bold text-gray-900 tracking-tight">
            ◈ Agent Analytics
          </span>
          <div className="flex gap-1">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  page === n.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {page === 'dashboard'  && <Dashboard />}
        {page === 'traces'     && <TraceExplorer />}
        {page === 'analytics'  && <Analytics />}
      </main>
    </div>
  )
}
