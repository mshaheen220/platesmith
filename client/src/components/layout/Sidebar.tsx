export function Sidebar() {
  return (
    <aside className="w-96 bg-gray-800 p-6 border-r border-gray-700 flex flex-col">
      <h2 className="text-2xl font-bold mb-6 text-white">Controls</h2>
      <div className="space-y-8">
        <div>
          <h3 className="text-lg font-semibold text-gray-200 mb-2">Global Settings</h3>
          <p className="text-sm text-gray-400">Project dimensions will go here.</p>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-200 mb-2">Layers</h3>
          <p className="text-sm text-gray-400">Layer list and controls will go here.</p>
        </div>
      </div>
    </aside>
  );
}