import React, { createContext, useContext, useState, useCallback } from "react";
import { Lang, Translations, translations } from "../i18n/translations";

// ── Language detection ─────────────────────────────────────────────────────────

const LS_KEY = "kyru-lang";

function detectLanguage(): Lang {
  const saved = localStorage.getItem(LS_KEY) as Lang | null;
  if (saved === "en" || saved === "es") return saved;
  const browser = navigator.language ?? "";
  return browser.toLowerCase().startsWith("es") ? "es" : "en";
}

// ── Context ────────────────────────────────────────────────────────────────────

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLanguage);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(LS_KEY, l);
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}

// ── Toggle component (reusable) ────────────────────────────────────────────────

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  return (
    <div className={`flex items-center ${className ?? ""}`}>
      <button
        onClick={() => setLang("en")}
        className={`px-2 py-0.5 text-[11px] font-semibold rounded-l-md border border-r-0 transition-colors ${
          lang === "en"
            ? "bg-[#3dbf8a] border-[#3dbf8a] text-white"
            : "bg-transparent border-[#333] text-[#555] hover:text-[#888]"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLang("es")}
        className={`px-2 py-0.5 text-[11px] font-semibold rounded-r-md border transition-colors ${
          lang === "es"
            ? "bg-[#3dbf8a] border-[#3dbf8a] text-white"
            : "bg-transparent border-[#333] text-[#555] hover:text-[#888]"
        }`}
      >
        ES
      </button>
    </div>
  );
}
