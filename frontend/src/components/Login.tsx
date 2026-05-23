import React, { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { authApi } from "../api";
import { Spinner } from "./shared/Spinner";
import { useLanguage } from "../context/LanguageContext";

const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      await authApi.forgotPassword(forgotEmail);
      setForgotSent(true);
    } catch {
      setForgotError("Something went wrong. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <polygon points="20,2 35.6,11 35.6,29 20,38 4.4,29 4.4,11" fill="#3dbf8a" />
            <text x="20" y="27" textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="700"
              fontFamily="Inter, system-ui, sans-serif">K</text>
          </svg>
          <div className="flex flex-col gap-[3px]">
            <span className="text-white font-bold text-[18px] leading-none tracking-tight">kyru</span>
            <span className="text-[10px] font-semibold leading-none tracking-[0.16em]" style={{ color: "#3dbf8a" }}>
              ADVISORY
            </span>
          </div>
        </div>

        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-[12px] p-6">

          {/* ── Forgot password view ── */}
          {showForgot ? (
            <>
              <div className="mb-5">
                <h1 className="text-[18px] font-semibold text-white">{t.auth.resetPassword}</h1>
                <p className="text-[13px] text-[#555] mt-1">Enter your email and we'll send a reset link</p>
              </div>

              {forgotSent ? (
                <div className="space-y-4">
                  <div className="px-3 py-2.5 rounded-[8px] bg-[#3dbf8a]/10 border border-[#3dbf8a]/20 text-[#3dbf8a] text-[13px]">
                    If an account exists for <strong>{forgotEmail}</strong>, a reset link has been sent.
                  </div>
                  <button
                    onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
                    className="w-full py-2.5 rounded-[8px] border border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#444] text-sm transition-colors"
                  >
                    ← {t.auth.backToLogin}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgot} className="space-y-3">
                  {forgotError && (
                    <div className="px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
                      {forgotError}
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                      {t.auth.emailAddress}
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="you@restaurant.com"
                      className={inputCls}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {forgotLoading && <Spinner size="sm" />}
                    {forgotLoading ? "Sending…" : t.auth.sendResetLink}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowForgot(false); setForgotError(""); }}
                    className="w-full py-2 text-[13px] text-[#555] hover:text-[#888] transition-colors"
                  >
                    ← {t.auth.backToLogin}
                  </button>
                </form>
              )}
            </>
          ) : (
            /* ── Sign in view ── */
            <>
              <div className="mb-5">
                <h1 className="text-[18px] font-semibold text-white">{t.auth.signIn}</h1>
                <p className="text-[13px] text-[#555] mt-1">{t.auth.signInTo}</p>
              </div>

              {error && (
                <div className="mb-4 px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                    {t.auth.emailAddress}
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@restaurant.com"
                    className={inputCls}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em]">
                      {t.auth.password}
                    </label>
                    <button
                      type="button"
                      onClick={() => { setShowForgot(true); setForgotEmail(email); setForgotError(""); setForgotSent(false); }}
                      className="text-[11px] text-[#555] hover:text-[#3dbf8a] transition-colors"
                    >
                      {t.auth.forgotPassword}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={inputCls + " pr-10"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-[#444] hover:text-[#888] transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
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
                  {loading ? t.auth.signingIn : t.auth.signIn}
                </button>

                <p className="text-center text-[13px] text-[#555] pt-1">
                  {t.auth.noAccount}{" "}
                  <Link to="/register" className="text-[#3dbf8a] hover:text-[#35a87a] font-medium transition-colors">
                    {t.auth.createAccount}
                  </Link>
                </p>
              </form>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
