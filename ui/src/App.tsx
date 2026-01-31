import { Routes, Route } from 'react-router-dom';
import { Sidebar } from '@/components/layout';
import { ToastContainer } from '@/components/ui/Toast';
import { Dashboard } from '@/pages/Dashboard';
import { Agents } from '@/pages/Agents';
import { Providers } from '@/pages/Providers';
import { Channels } from '@/pages/Channels';
import { Tasks } from '@/pages/Tasks';
import { Skills } from '@/pages/Skills';
import { Tools } from '@/pages/Tools';
import { Memory } from '@/pages/Memory';
import { Settings } from '@/pages/Settings';
import { Chat } from '@/pages/Chat';
import { Logs } from '@/pages/Logs';
import { Sessions } from '@/pages/Sessions';
import { Metrics } from '@/pages/Metrics';

function App() {
  return (
    <div className="flex min-h-screen bg-[#0a0a0f] overflow-hidden">
      <Sidebar />
      <div className="flex-1 ml-64 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/sessions" element={<Sessions />} />
        </Routes>
      </div>
      <ToastContainer />
    </div>
  );
}

export default App;
