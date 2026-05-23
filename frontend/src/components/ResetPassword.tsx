import React, { useState, FormEvent } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { authApi } from "../api";
import { Spinner } from "./shared/Spinner";
import { useLanguage } from "../context/LanguageContext";

const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const token = params.get("token") ?? "";

  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [showPw, setShowPw]           = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [done, setDone]               = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-[#555] text-[13px]">{t.auth.invalidResetLink}</p>
          <button
            onClick={() => navigate("/login")}
            className="mt-4 text-[#3dbf8a] text-[13px] hover:underline"
          >
            {t.auth.backToSignIn}
          </button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError(t.auth.passwordsNoMatch); return; }
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? t.auth.resetFailed);
    } finally {
      setLoading(false);
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

          {done ? (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-[#3dbf8a]/10 border border-[#3dbf8a]/20 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-[#3dbf8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h1 className="text-[18px] font-semibold text-white">{t.auth.passwordUpdated}</h1>
                <p className="text-[13px] text-[#555] mt-1">{t.auth.signInNewPassword}</p>
              </div>
              <button
                onClick={() => navigate("/login")}
                className="w-full py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] text-white text-sm font-semibold transition-colors"
              >
                {t.auth.signIn}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <h1 className="text-[18px] font-semibold text-white">{t.auth.chooseNewPassword}</h1>
                <p className="text-[13px] text-[#555] mt-1">{t.auth.mustBeChars}</p>
              </div>

              {error && (
                <div className="mb-4 px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                {/* New password */}
                <div>
                  <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                    {t.auth.newPassword}
                  </label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.auth.minChars}
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

                {/* Confirm password */}
                <div>
                  <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                    {t.auth.confirmPassword}
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirm ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={t.auth.repeatPassword}
                      className={inputCls + " pr-10"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-[#444] hover:text-[#888] transition-colors"
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                    >
                      {showConfirm ? (
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
                  {loading ? t.common.saving : t.auth.setNewPassword}
                </button>

                <p className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="text-[13px] text-[#555] hover:text-[#888] transition-colors"
                  >
                    {t.auth.backToSignIn}
                  </button>
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
