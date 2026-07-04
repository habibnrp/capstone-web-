import { Navigate } from "react-router";

export default function AdminRoute({ children }: { children: JSX.Element }) {
  try {
    const raw = localStorage.getItem("fm_user");
    const user = raw ? JSON.parse(raw) : null;
    const role = String(user?.role || "user").toLowerCase();
    if (role !== "admin") {
      return <Navigate to="/dashboard" replace />;
    }
  } catch {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
