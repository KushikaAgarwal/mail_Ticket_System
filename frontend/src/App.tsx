import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./pages/AuthContext";
import { Layout } from "./components/Layout";
import Loginpage from "./pages/Loginpage";
import Dashboard from "./pages/Dashboard";
import TicketsList from "./pages/TicketsList";
import TicketDetail from "./pages/TicketDetail";
import AgentExtension from "./pages/AgentExtension";
import TicketTrack from "./pages/TicketTrack";
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Loginpage />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/tickets"
            element={
              <PrivateRoute>
                <TicketsList />
              </PrivateRoute>
            }
          />
          <Route
            path="/tickets/:taskId"
            element={
              <PrivateRoute>
                <TicketDetail />
              </PrivateRoute>
            }
          />
          <Route path="/track/:id" element={<TicketTrack />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          <Route
  path="/agent"
  element={
    <PrivateRoute>
      <AgentExtension />
    </PrivateRoute>
  }
/>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
