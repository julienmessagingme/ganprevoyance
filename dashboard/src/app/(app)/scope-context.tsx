"use client";

import { createContext, useContext } from "react";

/**
 * Contexte client exposant le scope école courant. Posé par le layout
 * serveur autour de `children`, il évite de threader `slug` à travers
 * toutes les pages serveurs juste pour le repasser aux composants client.
 */
interface ScopeValue {
  slug: string;
}

const ScopeContext = createContext<ScopeValue>({ slug: "" });

export function ScopeProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <ScopeContext.Provider value={{ slug }}>{children}</ScopeContext.Provider>
  );
}

export function useScope(): ScopeValue {
  return useContext(ScopeContext);
}
