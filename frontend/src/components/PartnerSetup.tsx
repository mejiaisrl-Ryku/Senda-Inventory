import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { partnerSetupApi } from "../api";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "./shared/Spinner";

// ── localStorage key used to resume setup if the admin navigates away ─────────
export const PARTNER_SETUP_TOKEN_KEY = "partnerSetupToken";

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";

const labelCls =
  "block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5";

// ── Invite status type ────────────────────────────────────────────────────────

type InviteStatus =
  | "loading"    // validating token with server
  | "valid"      // token OK — show the form
  | "EXPIRED"    // token existed but 72 h window passed
  | "ACCEPTED"   // token already used (redirect to login)
  | "INVALID";   // token not found or malformed

// ── Sub-screens ───────────────────────────────────────────────────────────────

function FullPageSpinner() {
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

/** Expired — no login link (admin must contact their administrator). */
function ExpiredScreen() {
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-[16px] font-semibold text-white mb-2">Invite expired</h2>
        <p className="text-[13px] text-[#666] leading-relaxed">
          This invite link has expired. Please contact your administrator to send a new one.
        </p>
      </div>
    </div>
  );
}

/** Invalid / not found — generic message with no sensitive info. */
function InvalidScreen() {
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-[16px] font-semibold text-white mb-2">Invalid invite link</h2>
        <p className="text-[13px] text-[#666] mb-6 leading-relaxed">
          This link is invalid or has been revoked. Please use the exact link from your invitation email.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center justify-center w-full py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] text-white text-[13px] font-semibold transition-colors"
        >
          Go to sign in
        </Link>
      </div>
    </div>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
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
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PartnerSetup() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const { loginWithSession } = useAuth();

  // Invite state machine
  const [status, setStatus] = useState<InviteStatus>("loading");
  const [invite, setInvite] = useState<{
    email: string;
    firstName: string;
    lastName: string;
  } | null>(null);

  // Form state
  const [restaurantName, setRestaurantName] = useState("");
  const [logo, setLogo]                     = useState<string | null>(null);
  const [logoPreview, setLogoPreview]       = useState<string | null>(null);
  const [password, setPassword]             = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw]                 = useState(false);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [formError, setFormError]           = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Validate token on mount ────────────────────────────────────────────────

  useEffect(() => {
    if (!token) {
      localStorage.removeItem(PARTNER_SETUP_TOKEN_KEY);
      setStatus("INVALID");
      return;
    }

    partnerSetupApi
      .validate(token)
      .then((data) => {
        // Token is valid — persist it so ProtectedRoutes can redirect here
        // if the admin navigates away before completing setup.
        localStorage.setItem(PARTNER_SETUP_TOKEN_KEY, token);
        setInvite(data);
        setStatus("valid");
      })
      .catch((err: any) => {
        const code: string = err?.response?.data?.code ?? "INVALID";

        localStorage.removeItem(PARTNER_SETUP_TOKEN_KEY);

        if (code === "ACCEPTED") {
          // Account already exists — send straight to login.
          navigate("/login", { replace: true });
          return;
        }

        setStatus(code === "EXPIRED" ? "EXPIRED" : "INVALID");
      });
  }, [token, navigate]);

  // ── Logo upload ────────────────────────────────────────────────────────────

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      setFormError("Logo file must be under 2.5 MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setFormError("Please upload an image file (PNG, JPG, WebP, etc.).");
      return;
    }
    setFormError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogo(dataUrl);
      setLogoPreview(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setLogo(null);
    setLogoPreview(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!restaurantName.trim()) {
      setFormError("Restaurant name is required.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await partnerSetupApi.complete({
        token,
        restaurantName: restaurantName.trim(),
        password,
        logo: logo ?? null,
      });

      // Clear the pending-setup marker before logging in.
      localStorage.removeItem(PARTNER_SETUP_TOKEN_KEY);

      loginWithSession(data.user, data.token, data.refreshToken);
      navigate("/", { replace: true });
    } catch (err: any) {
      const code: string = err?.response?.data?.code ?? "";
      const msg: string  = err?.response?.data?.error ?? "Setup failed. Please try again.";

      // If the server tells us the invite is now accepted/expired mid-submit,
      // handle those cases gracefully too.
      if (code === "ACCEPTED") {
        localStorage.removeItem(PARTNER_SETUP_TOKEN_KEY);
        navigate("/login", { replace: true });
        return;
      }
      if (code === "EXPIRED") {
        localStorage.removeItem(PARTNER_SETUP_TOKEN_KEY);
        setStatus("EXPIRED");
        return;
      }

      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (status === "loading")   return <FullPageSpinner />;
  if (status === "EXPIRED")   return <ExpiredScreen />;
  if (status === "INVALID")   return <InvalidScreen />;
  if (status === "ACCEPTED")  return <FullPageSpinner />; // transient — navigate fires in useEffect

  // status === "valid"
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      <div className="w-full max-w-[480px]">

        {/* Brand */}
        <div className="flex justify-center mb-8">
          <img src="/kyru-logo-vertical.svg" alt="Kyru" className="h-20 w-auto object-contain" />
        </div>

        {/* Card */}
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-8 shadow-2xl">

          <div className="mb-6">
            <h1 className="text-[20px] font-bold text-white leading-tight">
              Welcome, {invite!.firstName}!
            </h1>
            <p className="text-[13px] text-[#555] mt-1">
              Set up your restaurant to get started with kyru.
            </p>
            <p className="text-[12px] text-[#444] mt-2">
              Signing in as <span className="text-[#888]">{invite!.email}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>

            {formError && (
              <div className="px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
                {formError}
              </div>
            )}

            {/* Restaurant name */}
            <div>
              <label className={labelCls}>
                Restaurant name <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                placeholder="La Milagrosa"
                maxLength={255}
                className={inputCls}
              />
            </div>

            {/* Logo upload */}
            <div>
              <label className={labelCls}>
                Restaurant logo <span className="text-[#444]">(optional)</span>
              </label>

              {logoPreview ? (
                <div className="flex items-center gap-3">
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="w-14 h-14 rounded-[8px] object-contain bg-[#111] border border-[#2a2a2a]"
                  />
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="text-[12px] text-[#3dbf8a] hover:text-[#35a87a] transition-colors"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={removeLogo}
                      className="text-[12px] text-[#555] hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-6 rounded-[8px] border border-dashed border-[#2a2a2a] hover:border-[#3dbf8a]/50 text-[#444] hover:text-[#888] transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[12px]">Click to upload logo</span>
                  <span className="text-[11px] text-[#333]">PNG, JPG, WebP · max 2.5 MB</span>
                </button>
              )}

              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleLogoChange}
              />
            </div>

            <div className="border-t border-[#1a1a1a]" />

            {/* Password */}
            <div>
              <label className={labelCls}>
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-[#444] hover:text-[#888] transition-colors"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  <EyeIcon visible={showPw} />
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div>
              <label className={labelCls}>
                Confirm password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-[#444] hover:text-[#888] transition-colors"
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  <EyeIcon visible={showConfirm} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 mt-2"
            >
              {submitting && <Spinner size="sm" />}
              {submitting ? "Setting up…" : "Create my restaurant"}
            </button>

          </form>
        </div>

        <p className="text-center text-[12px] text-[#333] mt-5">
          Already have an account?{" "}
          <Link to="/login" className="text-[#3dbf8a] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
