import { Outlet, useNavigate, useLocation } from "react-router";
import { LayoutDashboard, Database, Settings, Droplets, LogOut, Menu, X, CloudRain } from "lucide-react";
import { Button } from "./ui/button";
import { useEffect, useMemo, useState } from "react";

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const userRole = String(currentUser?.role || "user").toLowerCase();
  const isAdmin = userRole === "admin";

  const menuItems = [
    { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { path: "/data", label: "Data", icon: Database },
    { path: "/prediction", label: "Prediction", icon: CloudRain },
    ...(isAdmin ? [{ path: "/admin", label: "Admin Panel", icon: Settings }] : []),
  ];

  useEffect(() => {
    const loadUser = () => {
      try {
        const raw = localStorage.getItem("fm_user");
        setCurrentUser(raw ? JSON.parse(raw) : null);
      } catch {
        setCurrentUser(null);
      }
    };

    loadUser();
    window.addEventListener("storage", loadUser);
    return () => window.removeEventListener("storage", loadUser);
  }, []);

  const userName = currentUser?.name || "Guest User";
  const roleLabel = isAdmin ? "Admin" : "User";
  const userInitials = useMemo(() => {
    const parts = String(userName).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "GU";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }, [userName]);

  const handleLogout = () => {
    localStorage.removeItem("fm_token");
    localStorage.removeItem("fm_user");
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar - Desktop */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 shadow-sm hidden lg:block z-20">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                <Droplets className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Flood Monitor</h1>
                <p className="text-xs text-gray-500">Railway System</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Logout */}
          <div className="p-4 border-t border-gray-200">
            <Button
              onClick={handleLogout}
              variant="outline"
              className="w-full justify-start gap-3 text-gray-700 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
            >
              <LogOut className="w-5 h-5" />
              <span>Logout</span>
            </Button>
          </div>
        </div>
      </aside>

      {/* Sidebar - Mobile */}
      {sidebarOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 shadow-lg z-40 lg:hidden">
            <div className="flex flex-col h-full">
              {/* Header with Close */}
              <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <Droplets className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="font-bold text-gray-900">Flood Monitor</h1>
                    <p className="text-xs text-gray-500">Railway System</p>
                  </div>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Navigation */}
              <nav className="flex-1 p-4 space-y-1">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <button
                      key={item.path}
                      onClick={() => {
                        navigate(item.path);
                        setSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-600"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Logout */}
              <div className="p-4 border-t border-gray-200">
                <Button
                  onClick={handleLogout}
                  variant="outline"
                  className="w-full justify-start gap-3 text-gray-700 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Logout</span>
                </Button>
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Main Content */}
      <div className="lg:ml-64">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 px-4 lg:px-8 py-4 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-gray-600 hover:text-gray-900"
              >
                <Menu className="w-6 h-6" />
              </button>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {menuItems.find(item => item.path === location.pathname)?.label || "Dashboard"}
                </h2>
                <p className="text-sm text-gray-500">Real-time flood monitoring and management</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium text-gray-900">{userName}</p>
                <p className="text-xs text-gray-500">{roleLabel}</p>
              </div>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white font-medium">{userInitials}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
