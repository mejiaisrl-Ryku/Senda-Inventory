import React, { useState, FormEvent, useMemo } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { teamApi } from "../api";
import { Spinner } from "./shared/Spinner";
import { useLanguage } from "../context/LanguageContext";

// Decode a JWT payload without verifying the signature — used only for display.
function decodeInviteToken(token: string): { restaurantName?: string; email?: string } | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    return JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// ── Shared input class (matches SuperAdminLogin) ──────────────────────────────
const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";

// Re-enable after Stripe self-serve onboarding. Mirrors the backend flag in
// authController.register (SELF_SERVE_SIGNUP_ENABLED env var) — flip both
// together. Invite links (/register?token=...) are unaffected either way.
const SELF_SERVE_SIGNUP_ENABLED = false;

export function Register() {
  const { register, loginWithSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();

  // Invite-mode detection
  const inviteToken = searchParams.get("token") ?? "";
  const isInviteMode = Boolean(inviteToken);
  const inviteData = useMemo(
    () => (isInviteMode ? decodeInviteToken(inviteToken) : null),
    [isInviteMode, inviteToken]
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState(inviteData?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t.auth.passwordsNoMatch);
      return;
    }
    if (password.length < 8) {
      setError(t.auth.passwordTooShort);
      return;
    }

    setLoading(true);
    try {
      if (isInviteMode) {
        const data = await teamApi.registerViaInvite({ token: inviteToken, name, email, password });
        // Use the tokens/user from the invite response directly — no extra login call.
        // This preserves the groupId and isBranch flags that were embedded during
        // registration, rather than overwriting them with a fresh token from login().
        loginWithSession(data.user, data.token, data.refreshToken);
        navigate("/");
      } else {
        await register(name, email, password, restaurantName);
        navigate("/");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? t.auth.registrationFailed);
    } finally {
      setLoading(false);
    }
  }

  // Self-serve registration is closed — invitation required. The token flow
  // below is untouched; only the tokenless visit gets this notice.
  if (!isInviteMode && !SELF_SERVE_SIGNUP_ENABLED) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-8">
            <img src={process.env.PUBLIC_URL + '/kyru-logo-vertical.svg'} alt="Kyru" className="object-contain" style={{ width: '140px', height: 'auto' }} />
          </div>
          <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-[12px] p-6">
            <h1 className="text-[18px] font-semibold text-white">{t.auth.inviteOnlyTitle}</h1>
            <p className="text-[13px] text-[#555] mt-2 leading-relaxed">
              {t.auth.inviteOnlyBody}{" "}
              <a href="mailto:israel@kyruadvisory.com" className="text-[#3dbf8a] hover:text-[#35a87a] font-medium transition-colors">
                israel@kyruadvisory.com
              </a>{" "}
              {t.auth.inviteOnlyOr}{" "}
              <a href="https://kyruadvisory.com" className="text-[#3dbf8a] hover:text-[#35a87a] font-medium transition-colors">
                kyruadvisory.com
              </a>.
            </p>
            <Link
              to="/login"
              className="block text-center mt-5 py-2.5 rounded-[8px] border border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#444] text-sm transition-colors"
            >
              {t.auth.backToSignIn}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src={process.env.PUBLIC_URL + '/kyru-logo-vertical.svg'} alt="Kyru" className="object-contain" style={{ width: '140px', height: 'auto' }} />
        </div>

        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-[12px] p-6">
          <div className="mb-5">
            {isInviteMode ? (
              <>
                <h1 className="text-[18px] font-semibold text-white">{t.auth.acceptInvitation}</h1>
                {inviteData?.restaurantName ? (
                  <p className="text-[13px] text-[#555] mt-1">
                    {t.auth.joiningAs.replace("{name}", "")}{" "}
                    <span className="font-semibold" style={{ color: "#3dbf8a" }}>
                      {inviteData.restaurantName}
                    </span>
                  </p>
                ) : (
                  <p className="text-[13px] text-[#555] mt-1">{t.auth.completeSetup}</p>
                )}
              </>
            ) : (
              <>
                <h1 className="text-[18px] font-semibold text-white">{t.auth.createAccount}</h1>
                <p className="text-[13px] text-[#555] mt-1">{t.auth.setupRestaurant}</p>
              </>
            )}
          </div>

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Your name */}
            <div>
              <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                {t.auth.yourName}
              </label>
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="María García"
                className={inputCls}
              />
            </div>

            {/* Restaurant name — hidden in invite mode */}
            {!isInviteMode && (
              <div>
                <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                  {t.auth.restaurantName}
                </label>
                <input
                  type="text"
                  required
                  autoComplete="organization"
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                  placeholder="La Milagrosa"
                  className={inputCls}
                />
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                {t.auth.emailAddress}
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                readOnly={isInviteMode && Boolean(inviteData?.email)}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.com"
                className={inputCls + (isInviteMode && inviteData?.email ? " opacity-60 cursor-not-allowed" : "")}
              />
              {isInviteMode && inviteData?.email && (
                <p className="mt-1 text-[11px] text-[#444]">{t.auth.inviteSentTo} {inviteData.email}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                {t.auth.password}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.auth.minChars}
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

            {/* Confirm password */}
            <div>
              <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                {t.auth.confirmPassword}
              </label>
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className={inputCls}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Spinner size="sm" />}
              {loading
                ? isInviteMode ? t.auth.joining : t.auth.creating
                : isInviteMode ? t.auth.joinTeam : t.auth.createAccount}
            </button>

            {!isInviteMode && (
              <p className="text-center text-[13px] text-[#555] pt-1">
                {t.auth.haveAccount}{" "}
                <Link to="/login" className="text-[#3dbf8a] hover:text-[#35a87a] font-medium transition-colors">
                  {t.auth.signIn}
                </Link>
              </p>
            )}
          </form>
        </div>

      </div>
    </div>
  );
}
