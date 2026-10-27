export const reactStarter: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'kalpa-react-starter',
      version: '0.1.0',
      private: true,
      main: '/src/main.tsx',
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'lucide-react': '^0.460.0',
      },
    },
    null,
    2
  ),
  'tailwind.config.js': `module.exports = {
  theme: {
    extend: {},
  },
  plugins: [],
};
`,
  'src/styles.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  background: #090912;
  color: #f4f4fa;
  font-family: system-ui, -apple-system, sans-serif;
}
`,
  'src/main.tsx': `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
`,
  'src/App.tsx': `import React, { useState } from 'react';

interface Task {
  id: number;
  title: string;
  done: boolean;
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: 1, title: 'Design mobile-first layout', done: true },
    { id: 2, title: 'Wire interactive state in src/App.tsx', done: false },
    { id: 3, title: 'Test live reload in Kalpa preview', done: false },
  ]);
  const [draft, setDraft] = useState('');

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setTasks((prev) => [...prev, { id: Date.now(), title: draft.trim(), done: false }]);
    setDraft('');
  };

  const toggle = (id: number) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  return (
    <div className="min-h-screen p-6 sm:p-10 max-w-xl mx-auto space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-violet-400 font-medium">React + TypeScript</p>
        <h1 className="text-2xl font-bold tracking-tight">Focus Checklist</h1>
      </header>

      <form onSubmit={addTask} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task..."
          className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
        >
          Add
        </button>
      </form>

      <ul className="space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            onClick={() => toggle(task.id)}
            className="flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 cursor-pointer hover:bg-white/[0.07] transition-colors"
          >
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => {}}
              className="h-4 w-4 accent-violet-500"
            />
            <span className={task.done ? 'line-through text-slate-500 text-sm' : 'text-sm text-slate-100'}>
              {task.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
`,
};
