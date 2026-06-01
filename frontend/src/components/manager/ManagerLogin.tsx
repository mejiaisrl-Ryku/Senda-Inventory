import React, { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useManager } from "../../context/ManagerContext";
import { Spinner } from "../shared/Spinner";

const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";

export function ManagerLogin() {
  const { login } = useManager();
  const navigate  = useNavigate();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/super-admin", { replace: true });
    } catch (err: any) {
      const msg: string =
        err?.message === "Access restricted to Kyru Managers only"
          ? "Access restricted to Kyru Managers only"
          : (err?.response?.data?.error ?? err?.message ?? "Login failed.");
      setError(msg);
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img
            src={process.env.PUBLIC_URL + '/kyru-logo-vertical.svg'}
            alt="Kyru"
            className="object-contain"
            style={{ width: '140px', height: 'auto' }}
          />
        </div>

        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-[12px] p-6">
          <div className="mb-5">
            <h1 className="text-[18px] font-semibold text-white">Kyru Manager</h1>
            <p className="text-[13px] text-[#555] mt-1">Internal access only</p>
          </div>

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="manager@kyruadvisory.com"
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-[#444] hover:text-[#888] transition-colors"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Spinner size="sm" />}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[12px] text-[#444]">
          <Link to="/login" className="hover:text-[#666] transition-colors">
            ← Back to main login
          </Link>
        </p>
      </div>
    </div>
  );
}
