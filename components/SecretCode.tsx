"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { isSecretCode, nonsenseLine } from "@/lib/prank";

const MAX_LINES = 80;
const PRANK_SECONDS = 15;

/** A joke: typing the secret code shows a fake "hacking" screen. Purely cosmetic and client-side. */
export function SecretCode() {
  const [value, setValue] = useState("");
  const [miss, setMiss] = useState(false);
  const [active, setActive] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSecretCode(value)) {
      setMiss(false);
      setValue("");
      setActive(true);
    } else {
      setMiss(true);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2" aria-label="Secret code">
        <label htmlFor="secret-code" className="flex items-center gap-1.5 text-xs text-muted">
          <KeyRound className="size-3.5" aria-hidden />
          Got a secret code?
        </label>
        <input
          id="secret-code"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMiss(false);
          }}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          className="input !w-40 !py-1.5"
          placeholder="Type it here"
        />
        <button type="submit" className="btn-secondary px-3 py-1.5">
          Enter
        </button>
        {miss && <span className="text-xs text-muted">Nope. Try again.</span>}
      </form>
      {active && <HackingScreen onClose={() => setActive(false)} />}
    </>
  );
}

function HackingScreen({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = setInterval(
      () => setLines((prev) => [...prev, nonsenseLine(Math.random)].slice(-MAX_LINES)),
      reduce ? 200 : 45
    );
    const end = setTimeout(() => setDone(true), PRANK_SECONDS * 1000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearInterval(tick);
      clearTimeout(end);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hacking the Pentagon (a joke)"
      className="fixed inset-0 z-50 flex flex-col bg-black p-4 font-mono text-green-400 sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-wider sm:text-4xl">
            {done ? "Just kidding." : "Hacking the Pentagon"}
            {!done && <span className="motion-safe:animate-pulse">...</span>}
          </h2>
          <p className="mt-1 text-xs text-green-600">
            {done ? "Nothing was hacked. It is only a joke screen." : "This is a joke. Press Esc to bail out."}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-lg border border-green-700 px-3 py-1.5 text-xs text-green-300 hover:bg-green-900/40 focus-visible:outline-2 focus-visible:outline-green-400"
        >
          <X className="size-4" aria-hidden />
          {done ? "Back to the dashboard" : "Exit"}
        </button>
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col justify-end overflow-hidden text-xs leading-5 sm:text-sm" aria-hidden>
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre opacity-90">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
