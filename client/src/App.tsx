import { Sidebar } from './components/layout/Sidebar';
import { ThreeCanvas } from './components/viewer/ThreeCanvas';

function App() {
  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col font-sans">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center gap-3">
        <img src="/favicon/favicon.svg" alt="stack3d logo" className="h-6 w-6" />
        <h1 className="text-xl font-bold tracking-tight">
          stack3d
        </h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col">
          <ThreeCanvas />
        </main>
      </div>
    </div>
  )
}

export default App
