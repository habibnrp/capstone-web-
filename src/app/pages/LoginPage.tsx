import { useState } from "react";
import { useNavigate } from "react-router";
import { Droplets, Mail, Lock } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupStep, setSignupStep] = useState<"details" | "otp">("details");
  const [otp, setOtp] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "").replace(/\/api$/, "");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!email || !password) {
      setErrorMsg("Email and password are required");
      return;
    }
    fetch(`${API_BASE}/api/monitoring/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Login failed');
        // store token and user
        if (body.token) localStorage.setItem('fm_token', body.token);
        if (body.user) localStorage.setItem('fm_user', JSON.stringify(body.user));
        navigate('/dashboard');
      })
      .catch((err) => setErrorMsg(err.message || 'Login failed'));
  };

  const validateKaiEmail = (value: string) => {
    return /@kai\.id$/i.test(value);
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email.trim()) {
      setErrorMsg("Email is required");
      return;
    }
    if (!validateKaiEmail(email)) {
      setErrorMsg("Email must end with @kai.id");
      return;
    }
    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match");
      return;
    }

    if (signupStep !== 'details') {
      return;
    }

    // Request OTP from backend
    fetch(`${API_BASE}/api/monitoring/signup/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Signup failed');
        setSuccessMsg('OTP sent to your email. Enter the code to complete registration.');
        setSignupStep('otp');
        setOtp('');
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Signup failed');
      });
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!otp.trim()) {
      setErrorMsg("OTP is required");
      return;
    }

    fetch(`${API_BASE}/api/monitoring/signup/verify-otp/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'OTP verification failed');
        setSuccessMsg('Signup successful — you can now sign in.');
        setMode('login');
        setSignupStep('details');
        setPassword('');
        setConfirmPassword('');
        setOtp('');
      })
      .catch((err) => setErrorMsg(err.message || 'OTP verification failed'));
  };

  const resetSignupFlow = () => {
    setSignupStep('details');
    setOtp('');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-gray-50 p-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("https://images.unsplash.com/photo-1709745491084-614cd7aee4fd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmbG9vZCUyMHdhdGVyJTIwbW9uaXRvcmluZyUyMHNlbnNvcnxlbnwxfHx8fDE3NzQ5NTg2Njd8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }} />
      </div>

      {/* Login Card */}
      <Card className="w-full max-w-md shadow-2xl border-0 bg-white/95 backdrop-blur-sm relative z-10">
        <CardHeader className="space-y-4 text-center pb-6">
          {/* Logo */}
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Droplets className="w-12 h-12 text-white" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-center gap-4">
              <button
                className={`px-3 py-1 rounded-md ${mode === 'login' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
                onClick={() => { setMode('login'); resetSignupFlow(); }}
              >
                Sign In
              </button>
              <button
                className={`px-3 py-1 rounded-md ${mode === 'signup' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
                onClick={() => { setMode('signup'); resetSignupFlow(); }}
              >
                Sign Up
              </button>
            </div>
            <CardTitle className="text-3xl font-bold text-gray-900 mt-3">
              Flood Monitoring System
            </CardTitle>
            <CardDescription className="text-base mt-2 text-gray-600">
              Railway Operations Management
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={mode === 'login' ? handleLogin : (signupStep === 'details' ? handleSignup : handleVerifyOtp)} className="space-y-5">
            {errorMsg && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
            )}
            {successMsg && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{successMsg}</div>
            )}

            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-700">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  id="email"
                  type="text"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-11 h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-700">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-11 h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            {mode === 'signup' && (
              <>
                {signupStep === 'details' ? (
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-gray-700">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="Confirm your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-11 h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        required
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="otp" className="text-gray-700">Email OTP</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <Input
                        id="otp"
                        type="text"
                        inputMode="numeric"
                        placeholder="Enter the code sent to your email"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        className="pl-11 h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        required
                      />
                    </div>
                  </div>
                )}
              </>
            )}


            {/* Login Button */}
            <Button 
              type="submit" 
              className="w-full h-12 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md"
            >
              {mode === 'login' ? 'Sign In' : signupStep === 'details' ? 'Send OTP' : 'Verify & Create Account'}
            </Button>

            {mode === 'signup' && signupStep === 'otp' && (
              <Button
                type="button"
                variant="outline"
                className="w-full h-12"
                onClick={() => {
                  setSignupStep('details');
                  setOtp('');
                  setSuccessMsg(null);
                }}
              >
                Back to details
              </Button>
            )}

            {/* Additional Options */}
            <div className="text-center text-sm text-gray-500">
              <a href="#" className="hover:text-blue-600 transition-colors">
                Forgot password?
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="absolute bottom-4 text-center text-sm text-gray-500">
        <p>© 2026 Railway Flood Monitoring System. All rights reserved.</p>
      </div>
    </div>
  );
}
