"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ApiRequestError, apiClient } from "@/lib/api-client";
import { useLocale, useT } from "@/lib/i18n";
import type { components } from "@/types/api";

type TokenPairResponse = components["schemas"]["TokenPairResponse"];
type ClientInfoResponse = components["schemas"]["ClientInfoResponse"];

/** Google Identity Services, as much of it as this page uses. */
interface GoogleId {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void; ux_mode?: "popup" }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisLoading: Promise<GoogleId> | null = null;

function loadGis(): Promise<GoogleId> {
  gisLoading ??= new Promise((resolve, reject) => {
    const done = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in didn't load")));
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = done;
    script.onerror = () => {
      gisLoading = null;
      reject(new Error("Google sign-in didn't load"));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

/**
 * "Continue with Google" (DESIGN.md §10, ease-of-use plan B5): Google's own
 * button (its brand rules ask for it), shown only when the API has a Google
 * client id (GET /meta/client). The ID token goes to POST /auth/google, which
 * signs in, links the account with that email, or makes a new one.
 * `extra` carries Register's workspace name or an invitation's token.
 */
export function GoogleSignIn({
  text = "continue_with",
  extra,
  onSession,
  onError,
}: {
  text?: "continue_with" | "signup_with" | "signin_with";
  extra?: { tenant_name?: string; invitation_token?: string; locale?: string };
  onSession: (data: TokenPairResponse) => void;
  onError: (message: string) => void;
}) {
  const { data: meta } = useSWR("meta:client", () => apiClient.get<ClientInfoResponse>("/meta/client"), { revalidateOnFocus: false });
  const clientId = meta?.google_client_id_web ?? null;
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // The latest props, for the callback Google keeps from the first render.
  const t = useT();
  const locale = useLocale();
  const latest = useRef({ extra, onSession, onError, t });
  latest.current = { extra, onSession, onError, t };

  useEffect(() => {
    if (!clientId || !box.current) return;
    let cancelled = false;
    loadGis()
      .then((gis) => {
        if (cancelled || !box.current) return;
        gis.initialize({
          client_id: clientId,
          ux_mode: "popup",
          callback: ({ credential }) => {
            if (!credential) return;
            const { extra: more, onSession: ok, onError: bad, t: tr } = latest.current;
            apiClient
              .post<TokenPairResponse>("/auth/google", {}, { id_token: credential, ...more })
              .then(ok)
              .catch((err: unknown) => bad(err instanceof ApiRequestError && err.message ? err.message : tr("auth.google.failed")));
          },
        });
        gis.renderButton(box.current, { type: "standard", theme: "outline", size: "large", shape: "rectangular", text, logo_alignment: "center", locale, width: box.current.offsetWidth || 320 });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, text, locale]);

  if (!clientId || failed) return null;
  return (
    <div className="flex flex-col gap-3.5">
      <div ref={box} aria-label={t("auth.google.label")} className="flex min-h-10 w-full justify-center" />
      <div className="flex items-center gap-3 text-xs text-ink-muted" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        {t("auth.google.orEmail")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
