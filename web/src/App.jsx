import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CreateSession from './pages/CreateSession.jsx';
import JoinSession from './pages/JoinSession.jsx';
import PreferenceForm from './pages/PreferenceForm.jsx';
import Lobby from './pages/Lobby.jsx';
import ConsensusView from './pages/ConsensusView.jsx';
import JobMonitor from './pages/JobMonitor.jsx';
import TicketView from './pages/TicketView.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateSession />} />
        <Route path="/s/:shareToken" element={<JoinSession />} />
        <Route path="/s/:shareToken/preferences" element={<PreferenceForm />} />
        <Route path="/s/:shareToken/lobby" element={<Lobby />} />
        <Route path="/s/:shareToken/consensus" element={<ConsensusView />} />
        <Route path="/s/:shareToken/jobs/:jobId" element={<JobMonitor />} />
        <Route path="/s/:shareToken/ticket" element={<TicketView />} />
      </Routes>
    </BrowserRouter>
  );
}
