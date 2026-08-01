import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CreateSession from './pages/CreateSession.jsx';
import JoinSession from './pages/JoinSession.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateSession />} />
        <Route path="/s/:shareToken" element={<JoinSession />} />
      </Routes>
    </BrowserRouter>
  );
}
