import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Overview } from "./pages/Overview";
import { Project } from "./pages/Project";
import { Settings } from "./pages/Settings";
import { Tokens } from "./pages/Tokens";
import { Workflow } from "./pages/Workflow";

export function App() {
  return <Shell><Routes>
    <Route path="/" element={<Overview />} />
    <Route path="/projects/:id" element={<Project />} />
    <Route path="/projects/:projectId/workflows/:id" element={<Workflow />} />
    <Route path="/workflows/:id" element={<Workflow />} />
    <Route path="/tokens" element={<Tokens />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Shell>;
}
